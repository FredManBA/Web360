/**
 * Cliente de la API del recorrido 360.
 *
 * `fetch` se inyecta para poder probarlo sin navegador ni red. Los mensajes de
 * error son los que ve el administrador: nunca vuelve el cuerpo crudo, ni SQL,
 * ni codigos internos.
 */

import type { ApiMediaView } from './media-editor-state';
import type { ApiTourLink, ApiTourNode, ApiTourView } from './tour-editor-state';

export type ApiOutcome<T> = { ok: true; data: T } | { ok: false; message: string };

/** `null` cuando ya hay una peticion del mismo tipo en vuelo. */
export type GuardedOutcome<T> = ApiOutcome<T> | null;

const MESSAGES = {
  forbidden: 'No tienes acceso al panel administrativo.',
  load: 'No pudimos cargar el recorrido.',
  loadPanoramas: 'No pudimos cargar los panoramas disponibles.',

  saveNode: 'No pudimos guardar el punto.',
  nodeMissing: 'Este punto ya no existe.',

  saveLink: 'No pudimos guardar el salto.',
  linkMissing: 'Este salto ya no existe.',

  notPanorama: 'Solo un panorama 360° puede ser un punto del recorrido.',
  otherProperty: 'Ese panorama pertenece a otra propiedad.',
  panoramaUsed: 'Ese panorama ya es un punto del recorrido.',
  linkInvalid: 'Ese salto no es posible: revisa el origen y el destino.',
  linkDuplicate: 'Ya existe un salto entre esos dos puntos.',
} as const;

interface ApiErrorBody {
  error?: { code?: string };
}

async function messageFor(response: Response, fallback: string): Promise<string> {
  if (response.status === 403) return MESSAGES.forbidden;

  let code: string | undefined;
  try {
    code = ((await response.json()) as ApiErrorBody).error?.code;
  } catch {
    code = undefined;
  }

  if (code === 'tour_node_not_found') return MESSAGES.nodeMissing;
  if (code === 'tour_link_not_found') return MESSAGES.linkMissing;
  if (code === 'tour_media_not_panorama') return MESSAGES.notPanorama;
  if (code === 'tour_media_property_mismatch') return MESSAGES.otherProperty;
  if (code === 'tour_media_in_use') return MESSAGES.panoramaUsed;
  if (code === 'tour_link_invalid') return MESSAGES.linkInvalid;
  if (code === 'tour_link_duplicate') return MESSAGES.linkDuplicate;

  return fallback;
}

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

export interface TourApi {
  load: () => Promise<ApiOutcome<ApiTourView>>;
  /** Los panoramas salen del listado de multimedia; no hay endpoint aparte. */
  loadPanoramas: () => Promise<ApiOutcome<ApiMediaView>>;

  createNode: (propertyMediaId: number) => Promise<GuardedOutcome<ApiTourNode>>;
  updateNode: (nodeId: number, patch: unknown) => Promise<ApiOutcome<unknown>>;
  setStart: (nodeId: number, isStart: boolean) => Promise<ApiOutcome<unknown>>;
  deleteNode: (nodeId: number) => Promise<ApiOutcome<unknown>>;

  createLink: (input: {
    fromNodeId: number;
    toNodeId: number;
    yaw: number;
    pitch: number;
  }) => Promise<GuardedOutcome<ApiTourLink>>;
  updateLink: (linkId: number, patch: unknown) => Promise<ApiOutcome<unknown>>;
  deleteLink: (linkId: number) => Promise<ApiOutcome<unknown>>;
}

/** Guarda contra el doble envio, igual que en el resto del panel. */
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

/** URL del panorama dentro del panel. Va protegida por el mismo guardia. */
export function panoramaUrl(propertyId: number, mediaId: number): string {
  return `/api/admin/properties/${propertyId}/media/${mediaId}/file`;
}

export function createTourApi(propertyId: number, fetchFn: typeof fetch = fetch): TourApi {
  const base = `/api/admin/properties/${propertyId}`;

  const nodeGuard = createGuard();
  const linkGuard = createGuard();

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
      return send<ApiTourView>(
        `${base}/tour`,
        { headers: { accept: 'application/json' } },
        MESSAGES.load,
      );
    },

    loadPanoramas() {
      return send<ApiMediaView>(
        `${base}/media`,
        { headers: { accept: 'application/json' } },
        MESSAGES.loadPanoramas,
      );
    },

    createNode(propertyMediaId) {
      return nodeGuard(() =>
        send<ApiTourNode>(
          `${base}/tour/nodes`,
          { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ propertyMediaId }) },
          MESSAGES.saveNode,
        ),
      );
    },

    updateNode(nodeId, patch) {
      return send(
        `${base}/tour/nodes/${nodeId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) },
        MESSAGES.saveNode,
      );
    },

    setStart(nodeId, isStart) {
      // Ruta propia porque el cambio de punto inicial tiene que ser atomico.
      return send(
        `${base}/tour/nodes/${nodeId}/start`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ isStart }) },
        MESSAGES.saveNode,
      );
    },

    deleteNode(nodeId) {
      /*
       * DELETE no lleva cuerpo, pero Astro protege las peticiones que
       * modifican datos y rechaza como formulario cross-site las que llegan
       * sin `content-type`. Por eso se envia igualmente.
       */
      return send(
        `${base}/tour/nodes/${nodeId}`,
        { method: 'DELETE', headers: JSON_HEADERS },
        MESSAGES.saveNode,
      );
    },

    createLink(input) {
      return linkGuard(() =>
        send<ApiTourLink>(
          `${base}/tour/links`,
          { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
          MESSAGES.saveLink,
        ),
      );
    },

    updateLink(linkId, patch) {
      return send(
        `${base}/tour/links/${linkId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) },
        MESSAGES.saveLink,
      );
    },

    deleteLink(linkId) {
      // Mismo motivo que en `deleteNode` para el `content-type`.
      return send(
        `${base}/tour/links/${linkId}`,
        { method: 'DELETE', headers: JSON_HEADERS },
        MESSAGES.saveLink,
      );
    },
  };
}

export { MESSAGES as TOUR_API_MESSAGES };
