import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

import { getDb } from '../../db/client';
import { serveSiteMedia } from '../../lib/public/site-media-delivery';

/*
 * Se ejecuta en el Worker porque hay que mirar la configuracion para saber
 * que objeto sirve cada hueco. Es la segunda —y ultima— ruta publica que no
 * se prerenderiza; el resto del sitio sigue siendo estatico.
 */
export const prerender = false;

export const GET: APIRoute = ({ params, request }) =>
  serveSiteMedia({
    slot: params.slot ?? '',
    db: getDb(env),
    bucket: env.MEDIA,
    ifNoneMatch: request.headers.get('if-none-match'),
  });
