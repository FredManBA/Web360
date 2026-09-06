/**
 * Cliente de la API de multimedia.
 *
 * `fetch` se inyecta para poder probarlo sin navegador ni red. Los mensajes de
 * error son los que ve el administrador: nunca vuelve el cuerpo crudo, ni SQL,
 * ni codigos internos.
 *
 * La subida es la unica llamada que no es JSON: los bytes viajan en un
 * `FormData`, y el navegador pone por su cuenta el `content-type` con su
 * boundary. Por eso ahi NO se fijan cabeceras a mano.
 */

import type { ApiMedia, ApiMediaView } from './media-editor-state';

export type ApiOutcome<T> = { ok: true; data: T } | { ok: false; message: string };

/** `null` cuando ya hay una peticion del mismo tipo en vuelo. */
export type GuardedOutcome<T> = ApiOutcome<T> | null;

const MESSAGES = {
  forbidden: 'No tienes acceso al panel administrativo.',
  load: 'No pudimos cargar los archivos.',

  saveGroup: 'No pudimos guardar el grupo.',
  groupMissing: 'Este grupo ya no existe.',

  saveMedia: 'No pudimos guardar el archivo.',
  mediaMissing: 'Este archivo ya no existe.',
  mismatch: 'El grupo seleccionado no pertenece a esta propiedad.',

  upload: 'No pudimos subir el archivo.',
  storage: 'El almacenamiento no respondió. Vuelve a intentarlo.',

  roleConflict: 'Este tipo de archivo no admite ese papel.',
  inUse: 'No se puede eliminar: el recorrido 360° usa este panorama.',
  youtube: 'No pudimos añadir el vídeo.',
} as const;

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Traduce la respuesta de error a un mensaje comprensible.
 *
 * Para los rechazos de subida se usa el mensaje del servidor: ya viene
 * redactado para el administrador y dice exactamente que fallaba (el tipo, el
 * contenido o el tamano con su limite).
 */
async function messageFor(response: Response, fallback: string): Promise<string> {
  if (response.status === 403) return MESSAGES.forbidden;

  let body: ApiErrorBody;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = {};
  }

  const code = body.error?.code;

  if (code === 'media_upload_rejected' && typeof body.error?.message === 'string') {
    return body.error.message;
  }

  if (code === 'media_upload_failed') return MESSAGES.storage;
  if (code === 'media_not_found') return MESSAGES.mediaMissing;
  if (code === 'media_group_not_found') return MESSAGES.groupMissing;
  if (code === 'media_group_property_mismatch') return MESSAGES.mismatch;
  if (code === 'media_role_conflict') return MESSAGES.roleConflict;
  if (code === 'media_in_use') return MESSAGES.inUse;

  return fallback;
}

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

export interface MediaRecordView {
  id: number;
  groupId: number | null;
  sortOrder: number;
}

export interface YoutubeInput {
  youtubeVideoId: string;
  groupId: number | null;
  titleEs?: string;
  titleEn?: string;
}

export interface UploadInput {
  file: File;
  mediaKind: string;
  groupId: number | null;
}

export interface MediaApi {
  load: () => Promise<ApiOutcome<ApiMediaView>>;

  createGroup: () => Promise<GuardedOutcome<{ id: number; sortOrder: number }>>;
  updateGroup: (groupId: number, patch: unknown) => Promise<ApiOutcome<unknown>>;
  deleteGroup: (groupId: number) => Promise<ApiOutcome<unknown>>;

  /** Sube UN archivo. La cola de varios la lleva la UI. */
  upload: (input: UploadInput) => Promise<ApiOutcome<ApiMedia>>;
  createYoutube: (input: YoutubeInput) => Promise<GuardedOutcome<ApiMedia>>;

  updateMedia: (mediaId: number, patch: unknown) => Promise<ApiOutcome<MediaRecordView>>;
  setRoles: (
    mediaId: number,
    roles: { isHero?: boolean; isCatalogCover?: boolean },
  ) => Promise<ApiOutcome<unknown>>;
  deleteMedia: (mediaId: number) => Promise<ApiOutcome<unknown>>;
}

/**
 * Guarda contra el doble envio: mientras hay una peticion en vuelo, las
 * siguientes devuelven `null` sin llegar a la red.
 */
function createGuard() {
  let busy = false;

  return async <T>(run: () => Promise<ApiOutcome<T>>): Promise<GuardedOutcome<T>> => {
    if (busy) return null;
    busy = true;

    try {
      return await run();
    } finally {
      busy = false;
    }
  };
}

export function createMediaApi(propertyId: number, fetchFn: typeof fetch = fetch): MediaApi {
  const base = `/api/admin/properties/${propertyId}`;

  const groupGuard = createGuard();
  const youtubeGuard = createGuard();

  async function send<T>(url: string, init: RequestInit, fallback: string): Promise<ApiOutcome<T>> {
    try {
      const response = await fetchFn(url, init);

      if (!response.ok) return { ok: false, message: await messageFor(response, fallback) };

      const body = (await response.json()) as { data?: T };
      return { ok: true, data: body.data as T };
    } catch {
      // Fallo de red: mensaje generico, sin exponer el detalle.
      return { ok: false, message: fallback };
    }
  }

  return {
    load() {
      return send<ApiMediaView>(
        `${base}/media`,
        { headers: { accept: 'application/json' } },
        MESSAGES.load,
      );
    },

    createGroup() {
      return groupGuard(() =>
        send<{ id: number; sortOrder: number }>(
          `${base}/media-groups`,
          { method: 'POST', headers: JSON_HEADERS, body: '{}' },
          MESSAGES.saveGroup,
        ),
      );
    },

    updateGroup(groupId, patch) {
      return send(
        `${base}/media-groups/${groupId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) },
        MESSAGES.saveGroup,
      );
    },

    deleteGroup(groupId) {
      /*
       * DELETE no lleva cuerpo, pero Astro protege las peticiones que
       * modifican datos y rechaza como formulario cross-site las que llegan
       * sin `content-type`. Por eso se envia igualmente.
       */
      return send(
        `${base}/media-groups/${groupId}`,
        { method: 'DELETE', headers: JSON_HEADERS },
        MESSAGES.saveGroup,
      );
    },

    upload({ file, mediaKind, groupId }) {
      const form = new FormData();
      form.set('file', file);
      form.set('mediaKind', mediaKind);
      if (groupId !== null) form.set('groupId', String(groupId));

      /*
       * Sin cabeceras propias: el navegador tiene que poner el `content-type`
       * con su boundary. Y manda `Origin`, que es lo que exige la proteccion
       * de formularios de Astro.
       */
      return send<ApiMedia>(
        `${base}/media/upload`,
        { method: 'POST', body: form },
        MESSAGES.upload,
      );
    },

    createYoutube(input) {
      return youtubeGuard(() =>
        send<ApiMedia>(
          `${base}/media`,
          {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
              mediaKind: 'video',
              sourceProvider: 'youtube',
              youtubeVideoId: input.youtubeVideoId,
              groupId: input.groupId,
              ...(input.titleEs === undefined ? {} : { titleEs: input.titleEs }),
              ...(input.titleEn === undefined ? {} : { titleEn: input.titleEn }),
            }),
          },
          MESSAGES.youtube,
        ),
      );
    },

    updateMedia(mediaId, patch) {
      return send<MediaRecordView>(
        `${base}/media/${mediaId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) },
        MESSAGES.saveMedia,
      );
    },

    setRoles(mediaId, roles) {
      // Ruta propia porque el intercambio de rol tiene que ser atomico.
      return send(
        `${base}/media/${mediaId}/roles`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(roles) },
        MESSAGES.saveMedia,
      );
    },

    deleteMedia(mediaId) {
      // Mismo motivo que en `deleteGroup` para el `content-type`.
      return send(
        `${base}/media/${mediaId}`,
        { method: 'DELETE', headers: JSON_HEADERS },
        MESSAGES.saveMedia,
      );
    },
  };
}

export { MESSAGES as MEDIA_API_MESSAGES };
