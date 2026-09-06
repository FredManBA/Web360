/**
 * Creacion de borradores desde el panel.
 *
 * No hay modal ni asistente previo: se crea la propiedad vacia por la API y
 * se entra directamente al editor. El codigo lo genera el servidor.
 */

export type CreatePropertyOutcome = { ok: true; id: number } | { ok: false; message: string };

/** Se devuelve `null` cuando ya hay una creacion en curso. */
export type CreatePropertyResult = CreatePropertyOutcome | null;

export interface PropertyCreator {
  readonly busy: boolean;
  create: () => Promise<CreatePropertyResult>;
}

const GENERIC_ERROR = 'No pudimos crear la propiedad.';
const FORBIDDEN_ERROR = 'No tienes acceso al panel administrativo.';

/**
 * Crea el borrador, garantizando que dos clics seguidos no generen dos
 * propiedades: mientras hay una peticion en vuelo, las siguientes llamadas
 * devuelven `null` sin llegar a la red.
 *
 * `fetchFn` se inyecta para poder probarlo sin navegador.
 */
export function createPropertyCreator(fetchFn: typeof fetch = fetch): PropertyCreator {
  let inFlight = false;

  return {
    get busy(): boolean {
      return inFlight;
    },

    async create(): Promise<CreatePropertyResult> {
      if (inFlight) return null;
      inFlight = true;

      try {
        const response = await fetchFn('/api/admin/properties', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: '{}',
        });

        if (!response.ok) {
          return { ok: false, message: response.status === 403 ? FORBIDDEN_ERROR : GENERIC_ERROR };
        }

        const body = (await response.json()) as { data?: { id?: number } };
        const id = body.data?.id;

        if (typeof id !== 'number') return { ok: false, message: GENERIC_ERROR };

        return { ok: true, id };
      } catch {
        // Fallo de red: mensaje generico, sin exponer el detalle.
        return { ok: false, message: GENERIC_ERROR };
      } finally {
        inFlight = false;
      }
    },
  };
}

/** Ruta del editor de una propiedad. */
export function editorPath(id: number): string {
  return `/admin/propiedades/${id}`;
}
