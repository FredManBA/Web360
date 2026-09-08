import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

import { getDb } from '../../../../db/client';
import { handleReviewDecision } from '../../../../lib/review/decision-handler';

export const prerender = false;

/**
 * Decision del reviewer.
 *
 * Publico por diseno: el reviewer no tiene cuenta. La credencial es el token
 * de la URL, y sin uno valido esto no hace nada.
 */
export const POST: APIRoute = (context) =>
  handleReviewDecision({
    request: context.request,
    token: context.params.token ?? '',
    db: getDb(env),
  });
