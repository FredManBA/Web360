import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

import { getDb } from '../../../../db/client';
import { serveReviewMedia } from '../../../../lib/review/preview-media';

export const prerender = false;

/**
 * Archivos de una propiedad en revision.
 *
 * Aparte de `/media/[id]`, que sigue sirviendo solo lo publicamente visible.
 * Aqui hace falta un token valido Y que el archivo sea de esa propiedad.
 */
export const GET: APIRoute = (context) =>
  serveReviewMedia({
    token: context.params.token ?? '',
    mediaId: Number(context.params.mediaId),
    db: getDb(env),
    bucket: env.MEDIA,
  });
