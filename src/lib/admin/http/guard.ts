/**
 * Guardia temporal de la API administrativa.
 *
 * ATENCION: todavia NO hay autenticacion real. Cloudflare Access llegara en
 * una fase posterior. Hasta entonces la API esta CERRADA por defecto y solo
 * se abre con una variable explicita de desarrollo.
 *
 * `/api/admin/*` no es seguro por el hecho de no estar enlazado desde ninguna
 * parte: sin esta guardia, cualquiera que adivine la URL podria editar el
 * catalogo.
 *
 * EL DESPLIEGUE PRODUCTIVO NO DEBE DEFINIR `ADMIN_DEV_BYPASS`.
 */

import { jsonError } from './responses';

export interface AdminHttpEnv {
  /** Solo para desarrollo local y tests. Cualquier valor distinto de la
   *  cadena "true" mantiene la API cerrada. */
  ADMIN_DEV_BYPASS?: string | undefined;
}

/** Metodos que modifican datos y por tanto exigen comprobacion de origen. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isDevBypassEnabled(env: AdminHttpEnv): boolean {
  return env.ADMIN_DEV_BYPASS === 'true';
}

/**
 * Comprueba el acceso administrativo.
 *
 * Devuelve `null` si la peticion puede continuar, o la respuesta de rechazo.
 *
 * Se responde 403 y no 401 a proposito: 401 significa "autenticate y vuelve a
 * intentarlo", lo que implica anunciar un metodo de autenticacion en
 * `WWW-Authenticate`. Aqui no existe ninguno todavia, asi que el acceso esta
 * simplemente prohibido.
 */
export function requireAdminAccess(env: AdminHttpEnv): Response | null {
  if (isDevBypassEnabled(env)) return null;

  return jsonError(
    'forbidden',
    'Acceso administrativo no disponible: falta configurar la autenticacion.',
    403,
  );
}

/**
 * Rechaza escrituras cross-origin evidentes.
 *
 * El panel es same-origin, asi que si el navegador envia `Origin` debe
 * coincidir con el de la peticion. Cuando no hay cabecera `Origin` (curl,
 * tests, llamadas servidor a servidor) no hay nada que comprobar.
 *
 * No se emite ninguna cabecera CORS: estos endpoints no son publicos.
 */
export function requireSameOrigin(request: Request): Response | null {
  if (!MUTATING_METHODS.has(request.method)) return null;

  const origin = request.headers.get('origin');
  if (origin === null) return null;

  if (origin !== new URL(request.url).origin) {
    return jsonError('forbidden', 'Peticion cross-origin rechazada.', 403);
  }

  return null;
}

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

/**
 * Lee el cuerpo JSON.
 *
 * Solo se admite `application/json`; los formularios multipart llegaran con
 * las subidas de archivos, en otra fase.
 *
 * `allowEmpty` sirve para endpoints como `archive`, que no necesitan cuerpo.
 */
export async function readJsonBody(
  request: Request,
  options: { allowEmpty?: boolean } = {},
): Promise<JsonBodyResult> {
  const raw = await request.text();

  if (raw.trim().length === 0) {
    if (options.allowEmpty === true) return { ok: true, value: {} };
    return {
      ok: false,
      response: jsonError('invalid_json', 'El cuerpo de la peticion esta vacio.', 400),
    };
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return {
      ok: false,
      response: jsonError(
        'unsupported_media_type',
        'El cuerpo debe enviarse como application/json.',
        415,
      ),
    };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, response: jsonError('invalid_json', 'El JSON no es valido.', 400) };
  }
}

/** El identificador de la ruta debe ser un entero positivo. */
export function parseRouteId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
