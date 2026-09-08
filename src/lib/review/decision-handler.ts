/**
 * Endpoint de la decision del reviewer.
 *
 * Publico a proposito: el reviewer no tiene cuenta y la credencial es el
 * token de la URL. No comparte guardia ni formato de respuesta con el panel,
 * igual que el formulario de contacto: alli los codigos son detallados porque
 * quien los lee es el admin; aqui son cuatro y ni una pista mas.
 *
 * El token nunca se registra, ni al fallar.
 */

import type { AdminDatabase } from '../admin/types';
import { decideReview, REVIEW_DECISIONS, type ReviewDecision } from './review';

/** Un formulario de revision no tiene por que ser mas grande que esto. */
export const MAX_BODY_BYTES = 8 * 1024;

export interface DecisionContext {
  request: Request;
  token: string;
  db: AdminDatabase;
  now?: Date;
}

export type PublicDecisionCode = 'invalid_request' | 'link_invalid' | 'server_error';

const HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function success(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: HEADERS });
}

function failure(code: PublicDecisionCode, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: { code } }), { status, headers: HEADERS });
}

/**
 * Rechaza escrituras de otro origen.
 *
 * La pagina de revision es del propio sitio. Si el navegador manda `Origin`,
 * tiene que coincidir; cuando no la manda (curl, tests) no hay nada que
 * comprobar, y el token sigue siendo la credencial.
 */
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;

  return origin !== new URL(request.url).origin;
}

function isDecision(value: unknown): value is ReviewDecision {
  return REVIEW_DECISIONS.includes(value as ReviewDecision);
}

export async function handleReviewDecision(ctx: DecisionContext): Promise<Response> {
  const { request } = ctx;

  if (request.method !== 'POST') return failure('invalid_request', 405);
  if (crossOrigin(request)) return failure('invalid_request', 403);

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

  const payload = body as { decision?: unknown; comment?: unknown };
  if (!isDecision(payload.decision)) return failure('invalid_request', 422);

  const comment = typeof payload.comment === 'string' ? payload.comment : null;

  let result;
  try {
    result = await decideReview(ctx.db, ctx.token, payload.decision, comment, ctx.now);
  } catch (error) {
    /*
     * Nunca se filtra el detalle, y el token no aparece en el log: solo el
     * fallo, para poder enterarse de que algo va mal.
     */
    console.error('[revision] no se pudo registrar la decision:', error);
    return failure('server_error', 500);
  }

  if (!result.ok) {
    // Enlace muerto y decision mal formada son los dos unicos casos.
    return result.error.code === 'review_link_invalid'
      ? failure('link_invalid', 404)
      : failure('invalid_request', 422);
  }

  return success({ decision: result.data.decision });
}
