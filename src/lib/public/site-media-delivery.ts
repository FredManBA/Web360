/**
 * Entrega publica de la media global.
 *
 * Puerta distinta de `/media/[id]`, y a proposito. Aquella sirve archivos de
 * una propiedad y su regla es "¿esa propiedad es publica?"; esta sirve cuatro
 * imagenes del sitio y su regla es mucho mas simple: solo existen esos cuatro
 * nombres. Mezclarlas obligaria a que una sola funcion respondiera a dos
 * preguntas distintas, y ahi es donde aparecen los agujeros.
 *
 * Lo que hace segura esta ruta es lo que NO acepta:
 *
 * - solo cuatro valores posibles en la URL. Cualquier otro es 404 antes de
 *   tocar la base;
 * - la clave del objeto NUNCA llega desde el cliente: se lee de
 *   `site_settings`. No hay forma de pedir "dame este otro archivo del
 *   bucket", porque la URL no lleva ninguna clave;
 * - un hueco vacio responde 404 sobrio, igual que uno inexistente.
 *
 * Es cacheable: son imagenes de marca, cambian poco, y la URL publica lleva
 * una version que cambia cuando se reemplazan.
 */

import { isSiteMediaSlot, type SiteMediaSlot } from '../domain/site-media';
import { readSiteMediaKey } from '../admin/settings/site-media';
import type { MediaBucket } from '../admin/media/bucket';
import type { AdminDatabase } from '../admin/types';

export interface SiteMediaRequest {
  /** Lo que venga en la URL. Se valida contra los cuatro huecos conocidos. */
  slot: string;
  db: AdminDatabase;
  bucket: MediaBucket;
  ifNoneMatch?: string | null;
}

/**
 * Cuanto puede guardarse una imagen del sitio.
 *
 * Mas que la multimedia de una ficha: el logo y el favicon cambian muy de
 * tarde en tarde, y cuando cambian la URL publica estrena version.
 */
export const SITE_MEDIA_CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800';

/** Un 404 sobrio: ni pistas sobre lo que hay detras, ni cache. */
function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Que no se cachee: el hueco puede llenarse manana.
      'cache-control': 'no-store',
    },
  });
}

export async function serveSiteMedia(request: SiteMediaRequest): Promise<Response> {
  const { slot, db, bucket } = request;

  // Un nombre que no es de los cuatro no llega ni a consultar la base.
  if (!isSiteMediaSlot(slot)) return notFound();

  const key = await readSiteMediaKey(db, slot as SiteMediaSlot);
  if (key === null) return notFound();

  const object = await bucket.get(key);
  if (object === null || object.body === null) return notFound();

  const etag = object.httpEtag ?? null;

  // Si el navegador ya la tiene, se le ahorra la descarga.
  if (etag !== null && request.ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': SITE_MEDIA_CACHE_CONTROL },
    });
  }

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'content-length': String(object.size),
      'cache-control': SITE_MEDIA_CACHE_CONTROL,
      ...(etag === null ? {} : { etag }),
    },
  });
}
