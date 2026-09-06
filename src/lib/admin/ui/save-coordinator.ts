/**
 * Coordinador de guardado del editor.
 *
 * Un unico punto que orquesta los tres grupos que la API escribe por separado:
 *
 *   core -> PATCH  /api/admin/properties/:id
 *   es   -> PUT    /api/admin/properties/:id/translations/es
 *   en   -> PUT    /api/admin/properties/:id/translations/en
 *
 * No se finge atomicidad entre ellos: cada grupo lleva su propio estado, y un
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

export type SaveGroup = 'core' | 'es' | 'en';

export const SAVE_GROUPS: readonly SaveGroup[] = ['core', 'es', 'en'];

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
  snapshot: () => CoordinatorSnapshot;
  /** Cancela cualquier debounce pendiente. */
  dispose: () => void;
}

export function createSaveCoordinator(options: SaveCoordinatorOptions): SaveCoordinator {
  const { ports, onChange, onErrors, onRoundStart } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const states: Record<SaveGroup, GroupState> = { core: 'clean', es: 'clean', en: 'clean' };

  /** Grupos que volvieron a cambiar mientras se estaban guardando. */
  const dirtyAgain = new Set<SaveGroup>();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  /** Un cambio llego durante la ronda: hay que repetir al terminar. */
  let rerun = false;

  const globalState = (): GlobalSaveState => {
    const values = SAVE_GROUPS.map((group) => states[group]);

    // Una escritura activa manda sobre lo demas: es lo que esta pasando ahora.
    if (values.includes('saving')) return 'saving';
    if (values.includes('error')) return 'error';
    if (values.includes('dirty')) return 'dirty';
    return 'saved';
  };

  const snapshot = (): CoordinatorSnapshot => ({
    groups: { ...states },
    global: globalState(),
    hasPendingWork: SAVE_GROUPS.some((group) => states[group] !== 'clean'),
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
      // Se intentan los grupos con cambios y los que fallaron antes.
      const candidates = SAVE_GROUPS.filter(
        (group) => states[group] === 'dirty' || states[group] === 'error',
      );

      const errors: GroupFieldError[] = [];

      for (const group of candidates) {
        const port = ports[group];

        if (!port.isDirty()) {
          states[group] = 'clean';
          continue;
        }

        /*
         * Validacion local antes de enviar. Un grupo invalido no bloquea a
         * los demas: se marca y se continua con el siguiente.
         */
        const localErrors = port.validate();
        if (localErrors.length > 0) {
          states[group] = 'error';
          errors.push(...localErrors);
          continue;
        }

        states[group] = 'saving';
        dirtyAgain.delete(group);
        emit();

        const result = await port.persist();

        if (result.ok) {
          /*
           * Solo queda limpio si nadie lo toco durante la escritura. El puerto
           * ya marco como persistida SU instantanea, asi que lo escrito
           * despues sigue pendiente.
           */
          states[group] = dirtyAgain.has(group) ? 'dirty' : 'clean';
          dirtyAgain.delete(group);
        } else {
          states[group] = 'error';
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
      const stillPending = SAVE_GROUPS.some((group) => states[group] === 'dirty');
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
      if (states[group] === 'saving') {
        // Cambio durante la escritura: no puede marcarse como guardado.
        dirtyAgain.add(group);
      } else {
        states[group] = ports[group].isDirty() ? 'dirty' : 'clean';
      }

      emit();
      scheduleRound();
    },

    async saveNow(): Promise<void> {
      // El boton consume el debounce y usa el mismo camino que el autosave.
      clearTimer();

      for (const group of SAVE_GROUPS) {
        if (states[group] === 'clean' && ports[group].isDirty()) states[group] = 'dirty';
      }

      await runRound();
    },

    snapshot,

    dispose(): void {
      clearTimer();
    },
  };
}
