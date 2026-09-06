/**
 * Coordinador de guardado del editor.
 *
 * Un unico punto que orquesta todo lo que la API escribe por separado:
 *
 *   core        -> PATCH  /api/admin/properties/:id
 *   es          -> PUT    /api/admin/properties/:id/translations/es
 *   en          -> PUT    /api/admin/properties/:id/translations/en
 *   group:<id>  -> PATCH  /api/admin/properties/:id/feature-groups/:groupId
 *   feature:<id>-> PATCH  /api/admin/properties/:id/features/:featureId
 *
 * Los tres primeros existen desde que se abre el editor; los de
 * caracteristicas se registran y se dan de baja segun se crean o se eliminan.
 * No hay un segundo sistema de autosave: todo pasa por aqui.
 *
 * No se finge atomicidad entre puertos: cada uno lleva su propio estado, y un
 * fallo parcial deja limpios los que si se guardaron.
 *
 * Autosave y boton manual usan EXACTAMENTE este mismo camino; el boton solo
 * consume el debounce pendiente y ejecuta una ronda ya.
 *
 * Reglas que importan:
 *
 * - las escrituras se serializan: nunca hay dos rondas a la vez;
 * - lo que cambie durante una escritura sigue sucio, y una respuesta vieja no
 *   lo marca como guardado;
 * - un fallo NO reintenta solo: espera a un cambio del usuario o al boton, de
 *   modo que no se bombardea la API.
 */

/**
 * Clave de un puerto.
 *
 * Los tres fijos del editor son `core`, `es` y `en`. Las caracteristicas
 * anaden claves dinamicas con la forma `group:<id>` y `feature:<id>`, que se
 * registran cuando el servidor devuelve el id real.
 */
export type SaveGroup = string;

/** Puertos fijos del editor: siempre presentes y siempre en este orden. */
export const SAVE_GROUPS: readonly SaveGroup[] = ['core', 'es', 'en'];

export function groupPortKey(groupId: number): SaveGroup {
  return `group:${groupId}`;
}

export function featurePortKey(featureId: number): SaveGroup {
  return `feature:${featureId}`;
}

export type GroupState = 'clean' | 'dirty' | 'saving' | 'error';

/** Estado global, con los mismos textos que ya usaba el editor. */
export type GlobalSaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface GroupFieldError {
  field: string;
  message: string;
}

export type PersistResult =
  { ok: true } | { ok: false; errors?: GroupFieldError[]; message?: string };

/**
 * Puerto de un grupo.
 *
 * El puerto es quien conoce la forma de sus datos, asi que tambien es quien
 * toma la instantanea y decide que marcar como persistido al terminar. El
 * coordinador solo orquesta.
 */
export interface SaveGroupPort {
  /** ¿Hay algo pendiente de guardar? */
  isDirty: () => boolean;
  /** Errores locales que impiden enviar este grupo. Vacio = se puede enviar. */
  validate: () => GroupFieldError[];
  /** Toma instantanea, escribe y, si va bien, marca esa instantanea como persistida. */
  persist: () => Promise<PersistResult>;
}

export interface SaveCoordinatorOptions {
  /** Puertos iniciales. Los dinamicos se anaden despues con `register`. */
  ports: Record<SaveGroup, SaveGroupPort>;
  /** Se llama cada vez que cambia algo observable por la UI. */
  onChange: (snapshot: CoordinatorSnapshot) => void;
  /** Errores a mostrar tras una ronda. */
  onErrors: (errors: GroupFieldError[]) => void;
  /** Se llama antes de cada ronda, para limpiar errores previos. */
  onRoundStart?: () => void;
  debounceMs?: number;
}

export interface CoordinatorSnapshot {
  groups: Record<SaveGroup, GroupState>;
  global: GlobalSaveState;
  /** Cierto si queda trabajo sin persistir (para `beforeunload`). */
  hasPendingWork: boolean;
}

/** Un segundo tras el ultimo cambio: ni por tecla ni tan tarde que moleste. */
export const DEFAULT_DEBOUNCE_MS = 1000;

export interface SaveCoordinator {
  /** El usuario cambio algo en ese grupo. Reinicia el debounce. */
  notifyChange: (group: SaveGroup) => void;
  /** Guardado manual: consume el debounce y ejecuta una ronda ahora. */
  saveNow: () => Promise<void>;
  /** Da de alta un puerto dinamico; sustituye al anterior si la clave existia. */
  register: (group: SaveGroup, port: SaveGroupPort) => void;
  /** Da de baja un puerto: su estado deja de contar para el estado global. */
  unregister: (group: SaveGroup) => void;
  /** Claves registradas ahora mismo, en orden de registro. */
  registered: () => SaveGroup[];
  snapshot: () => CoordinatorSnapshot;
  /** Cancela cualquier debounce pendiente. */
  dispose: () => void;
}

export function createSaveCoordinator(options: SaveCoordinatorOptions): SaveCoordinator {
  const { onChange, onErrors, onRoundStart } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  /*
   * `Map` y no un objeto: conserva el orden de registro, de modo que las
   * rondas recorren siempre core, es, en y despues las caracteristicas en el
   * orden en que aparecieron. Nada de orden dependiente del azar.
   */
  const ports = new Map<SaveGroup, SaveGroupPort>(Object.entries(options.ports));
  const states = new Map<SaveGroup, GroupState>();
  for (const key of ports.keys()) states.set(key, 'clean');

  /** Puertos que volvieron a cambiar mientras se estaban guardando. */
  const dirtyAgain = new Set<SaveGroup>();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  /** Un cambio llego durante la ronda: hay que repetir al terminar. */
  let rerun = false;

  const stateOf = (group: SaveGroup): GroupState => states.get(group) ?? 'clean';

  const globalState = (): GlobalSaveState => {
    const values = [...states.values()];

    // Una escritura activa manda sobre lo demas: es lo que esta pasando ahora.
    if (values.includes('saving')) return 'saving';
    if (values.includes('error')) return 'error';
    if (values.includes('dirty')) return 'dirty';
    return 'saved';
  };

  const snapshot = (): CoordinatorSnapshot => ({
    groups: Object.fromEntries(states),
    global: globalState(),
    hasPendingWork: [...states.values()].some((state) => state !== 'clean'),
  });

  const emit = (): void => {
    onChange(snapshot());
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const runRound = async (): Promise<void> => {
    if (running) {
      rerun = true;
      return;
    }

    running = true;
    rerun = false;
    onRoundStart?.();

    try {
      // Se intentan los puertos con cambios y los que fallaron antes.
      const candidates = [...states.keys()].filter(
        (group) => stateOf(group) === 'dirty' || stateOf(group) === 'error',
      );

      const errors: GroupFieldError[] = [];

      for (const group of candidates) {
        const port = ports.get(group);
        // Pudo darse de baja mientras se recorria la lista.
        if (port === undefined) continue;

        if (!port.isDirty()) {
          states.set(group, 'clean');
          continue;
        }

        /*
         * Validacion local antes de enviar. Un puerto invalido no bloquea a
         * los demas: se marca y se continua con el siguiente.
         */
        const localErrors = port.validate();
        if (localErrors.length > 0) {
          states.set(group, 'error');
          errors.push(...localErrors);
          continue;
        }

        states.set(group, 'saving');
        dirtyAgain.delete(group);
        emit();

        const result = await port.persist();

        // La entidad pudo eliminarse durante la escritura.
        if (!ports.has(group)) {
          dirtyAgain.delete(group);
          continue;
        }

        if (result.ok) {
          /*
           * Solo queda limpio si nadie lo toco durante la escritura. El puerto
           * ya marco como persistida SU instantanea, asi que lo escrito
           * despues sigue pendiente.
           */
          states.set(group, dirtyAgain.has(group) ? 'dirty' : 'clean');
          dirtyAgain.delete(group);
        } else {
          states.set(group, 'error');
          dirtyAgain.delete(group);
          if (result.errors !== undefined) errors.push(...result.errors);
          if (result.message !== undefined) {
            errors.push({ field: group, message: result.message });
          }
        }

        emit();
      }

      if (errors.length > 0) onErrors(errors);
    } finally {
      running = false;
      emit();
    }

    /*
     * Si llegaron cambios durante la ronda, se hace otra con el estado mas
     * reciente. Es una sola repeticion por cambio: un fallo por si solo no
     * genera reintentos.
     */
    if (rerun) {
      rerun = false;
      const stillPending = [...states.values()].includes('dirty');
      if (stillPending) await runRound();
    }
  };

  const scheduleRound = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void runRound();
    }, debounceMs);
  };

  return {
    notifyChange(group: SaveGroup): void {
      const port = ports.get(group);
      // Un cambio de algo no registrado no puede guardarse: se ignora.
      if (port === undefined) return;

      if (stateOf(group) === 'saving') {
        // Cambio durante la escritura: no puede marcarse como guardado.
        dirtyAgain.add(group);
      } else {
        states.set(group, port.isDirty() ? 'dirty' : 'clean');
      }

      emit();
      scheduleRound();
    },

    async saveNow(): Promise<void> {
      // El boton consume el debounce y usa el mismo camino que el autosave.
      clearTimer();

      for (const [group, port] of ports) {
        if (stateOf(group) === 'clean' && port.isDirty()) states.set(group, 'dirty');
      }

      await runRound();
    },

    register(group: SaveGroup, port: SaveGroupPort): void {
      ports.set(group, port);
      states.set(group, port.isDirty() ? 'dirty' : 'clean');
      emit();
    },

    unregister(group: SaveGroup): void {
      ports.delete(group);
      states.delete(group);
      dirtyAgain.delete(group);
      emit();
    },

    registered(): SaveGroup[] {
      return [...ports.keys()];
    },

    snapshot,

    dispose(): void {
      clearTimer();
    },
  };
}
