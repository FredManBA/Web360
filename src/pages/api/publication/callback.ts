import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

import { getDb } from '../../../db/client';
import { handlePublicationCallback } from '../../../lib/publication/callback-handler';

export const prerender = false;

/**
 * Confirmacion del build.
 *
 * Fuera de `/api/admin/*` a proposito: quien llama es un proceso, no una
 * persona, y no puede pasar por el login de Access. Su credencial es el token
 * de la peticion, que viaja en la cabecera `x-publication-token`.
 */
export const POST: APIRoute = (context) =>
  handlePublicationCallback({ request: context.request, db: getDb(env) });
