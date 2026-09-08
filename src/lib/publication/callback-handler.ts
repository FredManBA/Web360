/**
 * Endpoint de confirmacion de un build.
 *
 * Quien lo llama no es una persona con navegador: es el proceso que ha
 * construido y desplegado el sitio. Por eso NO va detras de Cloudflare
 * Access. Access presenta un login en el borde, y un proceso automatico no
 * tiene con que responderlo; ponerlo detras obligaria a inventar una segunda
 * credencial de servicio o a dejar el flujo sin cerrar. La credencial es el
 * token de la peticion, que es un secreto de 256 bits que solo existe entre
 * quien la creo y quien la ejecuta.
 *
 * Consecuencias de esa decision, todas asumidas aqui:
 *
 * - el token viaja en una CABECERA, no en la ruta. Las URLs acaban en logs de
 *   proxies y de servidores; los cuerpos y las cabeceras, no;
 * - no se emite ninguna cabecera CORS. Esto no es para un navegador, asi que
 *   ningun origen ajeno necesita poder leerlo;
 * - el cuerpo solo dice si el build fue bien. Nunca sobre que propiedad ni a
 *   que estado: eso ya lo decidio el admin al pedirlo, y aceptarlo aqui
 *   convertiria el endpoint en "pon esta propiedad como quieras";
 * - las respuestas no distinguen un token inexistente de uno ya usado, y el
 *   token no se registra en ningun log, tampoco al fallar.
 */

import type { AdminDatabase } from '../admin/types';
import { finalizePublication, type PublicationOutcome } from './publication';

/** Cabecera que lleva el token. */
export const CALLBACK_TOKEN_HEADER = 'x-publication-token';

/** Una confirmacion no necesita mas que esto. */
export const MAX_BODY_BYTES = 4 * 1024;

/** Motivo de fallo que se acepta del ejecutor. Se recorta antes de guardarlo. */
export const MAX_REASON_LENGTH = 500;

export interface CallbackContext {
  request: Request;
  db: AdminDatabase;
  now?: Date;
}

export type PublicCallbackCode = 'invalid_request' | 'callback_invalid' | 'server_error';

const HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function success(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: HEADERS });
}

function failure(code: PublicCallbackCode, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: { code } }), { status, headers: HEADERS });
}

/** Lee el resultado del cuerpo. Solo `ok` y, si fallo, un motivo corto. */
function readOutcome(body: unknown): PublicationOutcome | null {
  if (typeof body !== 'object' || body === null) return null;

  const payload = body as { ok?: unknown; error?: unknown };
  if (typeof payload.ok !== 'boolean') return null;

  if (payload.ok) return { ok: true };

  if (payload.error === undefined || payload.error === null) return { ok: false };
  if (typeof payload.error !== 'string') return null;

  return { ok: false, error: payload.error.slice(0, MAX_REASON_LENGTH) };
}

export async function handlePublicationCallback(ctx: CallbackContext): Promise<Response> {
  const { request } = ctx;

  if (request.method !== 'POST') return failure('invalid_request', 405);

  const token = request.headers.get(CALLBACK_TOKEN_HEADER);
  if (token === null || token.length === 0) return failure('callback_invalid', 404);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return failure('invalid_request', 415);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return failure('invalid_request', 400);
  }

  if (raw.length > MAX_BODY_BYTES) return failure('invalid_request', 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return failure('invalid_request', 400);
  }

  const outcome = readOutcome(body);
  if (outcome === null) return failure('invalid_request', 422);

  let result;
  try {
    result = await finalizePublication(ctx.db, token, outcome, ctx.now);
  } catch (error) {
    // Nunca se filtra el detalle, y el token no aparece en el log.
    console.error('[publicacion] no se pudo cerrar la peticion:', error);
    return failure('server_error', 500);
  }

  if (!result.ok) {
    return result.error.code === 'publication_link_invalid'
      ? failure('callback_invalid', 404)
      : failure('server_error', 500);
  }

  /*
   * Se devuelve lo justo para que el ejecutor sepa que se registro. El estado
   * editorial resultante no es un secreto: es exactamente lo que el sitio que
   * acaba de desplegar ya muestra.
   */
  return success({
    requestId: result.data.request.id,
    status: result.data.request.status,
    publicationStatus: result.data.publicationStatus,
  });
}
