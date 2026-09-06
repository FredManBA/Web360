/**
 * Cliente de la API de caracteristicas.
 *
 * `fetch` se inyecta para poder probarlo sin navegador ni red. Los mensajes
 * de error son los que ve el administrador: nunca vuelve el cuerpo crudo, ni
 * SQL, ni codigos internos.
 */

import type { ApiFeaturesView } from './feature-editor-state';

export type ApiOutcome<T> = { ok: true; data: T } | { ok: false; message: string };

/** `null` cuando ya hay una peticion del mismo tipo en vuelo. */
export type GuardedOutcome<T> = ApiOutcome<T> | null;

const MESSAGES = {
  forbidden: 'No tienes acceso al panel administrativo.',
  featureMissing: 'Esta característica ya no existe.',
  groupMissing: 'Este grupo ya no existe.',
  mismatch: 'El grupo seleccionado no pertenece a esta propiedad.',
  saveFeature: 'No pudimos guardar la característica.',
  saveGroup: 'No pudimos guardar el grupo.',
  load: 'No pudimos cargar las características.',
  reorder: 'No pudimos cambiar el orden.',
  // El estado cambio por debajo: recargar es lo unico honesto que ofrecer.
  orderConflict: 'El orden ha cambiado. Vuelve a cargar la página para continuar.',
} as const;

interface ApiErrorBody {
  error?: { code?: string };
}

/**
 * Traduce la respuesta de error a un mensaje comprensible.
 *
 * `fallback` distingue si el contexto es un grupo o una caracteristica.
 */
async function messageFor(response: Response, fallback: string): Promise<string> {
  if (response.status === 403) return MESSAGES.forbidden;

  let code: string | undefined;
  try {
    code = ((await response.json()) as ApiErrorBody).error?.code;
  } catch {
    code = undefined;
  }

  if (code === 'feature_not_found') return MESSAGES.featureMissing;
  if (code === 'feature_group_not_found') return MESSAGES.groupMissing;
  if (code === 'feature_group_property_mismatch') return MESSAGES.mismatch;
  if (code === 'feature_order_conflict') return MESSAGES.orderConflict;

  return fallback;
}

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

/** Lo que devuelve la API tras escribir una caracteristica. */
export interface FeatureRecordView {
  id: number;
  groupId: number | null;
  sortOrder: number;
}

export interface FeatureApi {
  load: () => Promise<ApiOutcome<ApiFeaturesView>>;
  createGroup: () => Promise<GuardedOutcome<{ id: number; sortOrder: number }>>;
  updateGroup: (groupId: number, patch: unknown) => Promise<ApiOutcome<unknown>>;
  deleteGroup: (groupId: number) => Promise<ApiOutcome<unknown>>;
  createFeature: (
    groupId: number | null,
  ) => Promise<GuardedOutcome<{ id: number; sortOrder: number; groupId: number | null }>>;
  updateFeature: (featureId: number, patch: unknown) => Promise<ApiOutcome<FeatureRecordView>>;
  deleteFeature: (featureId: number) => Promise<ApiOutcome<unknown>>;
  /** Reordena TODOS los grupos de la propiedad en una sola peticion. */
  reorderGroups: (groupIds: readonly number[]) => Promise<ApiOutcome<unknown>>;
  /** Reordena un ambito completo: un grupo, o `null` para "Sin grupo". */
  reorderFeatures: (
    groupId: number | null,
    featureIds: readonly number[],
  ) => Promise<ApiOutcome<unknown>>;
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

export function createFeatureApi(propertyId: number, fetchFn: typeof fetch = fetch): FeatureApi {
  const base = `/api/admin/properties/${propertyId}`;

  const groupGuard = createGuard();
  const featureGuard = createGuard();

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
      return send<ApiFeaturesView>(
        `${base}/features`,
        { headers: { accept: 'application/json' } },
        MESSAGES.load,
      );
    },

    createGroup() {
      return groupGuard(() =>
        send<{ id: number; sortOrder: number }>(
          `${base}/feature-groups`,
          { method: 'POST', headers: JSON_HEADERS, body: '{}' },
          MESSAGES.saveGroup,
        ),
      );
    },

    updateGroup(groupId, patch) {
      return send(
        `${base}/feature-groups/${groupId}`,
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
        `${base}/feature-groups/${groupId}`,
        { method: 'DELETE', headers: JSON_HEADERS },
        MESSAGES.saveGroup,
      );
    },

    createFeature(groupId) {
      return featureGuard(() =>
        send<{ id: number; sortOrder: number; groupId: number | null }>(
          `${base}/features`,
          { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ groupId }) },
          MESSAGES.saveFeature,
        ),
      );
    },

    updateFeature(featureId, patch) {
      return send<FeatureRecordView>(
        `${base}/features/${featureId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) },
        MESSAGES.saveFeature,
      );
    },

    deleteFeature(featureId) {
      // Mismo motivo que en `deleteGroup` para el `content-type`.
      return send(
        `${base}/features/${featureId}`,
        { method: 'DELETE', headers: JSON_HEADERS },
        MESSAGES.saveFeature,
      );
    },

    /*
     * El orden viaja entero en una sola peticion. Nada de un PATCH por
     * elemento: dos escrituras sueltas pueden dejar el intercambio a medias.
     */
    reorderGroups(groupIds) {
      return send(
        `${base}/feature-groups/order`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ groupIds }) },
        MESSAGES.reorder,
      );
    },

    reorderFeatures(groupId, featureIds) {
      return send(
        `${base}/features/order`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ groupId, featureIds }) },
        MESSAGES.reorder,
      );
    },
  };
}

export { MESSAGES as FEATURE_API_MESSAGES };
