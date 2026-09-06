/**
 * Guardia de la API administrativa.
 *
 * La decision de acceso vive en `src/lib/admin/auth/authorize.ts`; aqui solo
 * se traduce a HTTP. Pasan unicamente el bypass de desarrollo (que exige a la
 * vez build DEV y la variable) y un JWT de Cloudflare Access verificado.
 *
 * `/api/admin/*` no es seguro por el hecho de no estar enlazado desde ninguna
 * parte: sin esta guardia, cualquiera que adivine la URL podria editar el
 * catalogo.
 *
 * EL DESPLIEGUE PRODUCTIVO NO DEBE DEFINIR `ADMIN_DEV_BYPASS`. Aunque se
 * definiera, una build productiva lo ignora.
 */

import type { JWTVerifyGetKey } from 'jose';

import { authorizeAdminRequest, type AdminAuthEnv, type AdminAuthResult } from '../auth/authorize';
import { jsonError } from './responses';

export type AdminHttpEnv = AdminAuthEnv;

/** Metodos que modifican datos y por tanto exigen comprobacion de origen. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Respuesta unica de rechazo.
 *
 * No distingue publicamente entre "falta configuracion", "falta token",
 * "firma invalida" o "token caducado": decirlo ayudaria a sondear el
 * despliegue. El detalle se queda en el servidor.
 */
export function adminForbiddenResponse(): Response {
  return jsonError('forbidden', 'Acceso administrativo denegado.', 403);
}

export interface AdminAuthCheck {
  /** Respuesta de rechazo, o `null` si la peticion puede continuar. */
  denied: Response | null;
  result: AdminAuthResult;
}

/**
 * Comprueba el acceso administrativo.
 *
 * Se responde 403 y no 401 a proposito: 401 significa "autenticate y vuelve a
 * intentarlo", lo que implica anunciar un metodo en `WWW-Authenticate`. Aqui
 * no hay ninguno que anunciar, porque el login lo presenta Cloudflare Access
 * en el borde, antes de llegar al Worker.
 */
export async function requireAdminAccess(
  request: Request,
  env: AdminHttpEnv,
  options: { keyResolver?: JWTVerifyGetKey } = {},
): Promise<AdminAuthCheck> {
  const result = await authorizeAdminRequest(request, env, options);
  return { denied: result.ok ? null : adminForbiddenResponse(), result };
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

/* -------------------------------------------------------------------------- */
/* Cuerpo multipart                                                           */
/* -------------------------------------------------------------------------- */

export type MultipartResult = { ok: true; form: FormData } | { ok: false; response: Response };

/**
 * Lee un formulario multipart.
 *
 * Es el unico cuerpo que no es JSON en toda la API administrativa, y existe
 * porque subir bytes en JSON obligaria a codificarlos en base64: un tercio mas
 * de peso y una copia extra en memoria del Worker.
 */
export async function readMultipartForm(request: Request): Promise<MultipartResult> {
  const contentType = request.headers.get('content-type') ?? '';

  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return {
      ok: false,
      response: jsonError(
        'unsupported_media_type',
        'El archivo debe enviarse como multipart/form-data.',
        415,
      ),
    };
  }

  try {
    return { ok: true, form: await request.formData() };
  } catch {
    return {
      ok: false,
      response: jsonError('invalid_json', 'No se pudo leer el formulario.', 400),
    };
  }
}
