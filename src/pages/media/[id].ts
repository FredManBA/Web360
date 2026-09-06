import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

import { getDb } from '../../db/client';
import { servePublicMedia } from '../../lib/public/media-delivery';

/*
 * Unica ruta publica que se ejecuta en el Worker: necesita consultar D1 para
 * saber si el archivo pertenece a una propiedad publicada y visible. El resto
 * del sitio publico sigue prerenderizado.
 */
export const prerender = false;

export const GET: APIRoute = ({ params, request }) =>
  servePublicMedia({
    mediaId: Number(params.id),
    db: getDb(env),
    bucket: env.MEDIA,
    ifNoneMatch: request.headers.get('if-none-match'),
  });
