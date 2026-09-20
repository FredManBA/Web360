/** Entrega por ID: solo media de propiedades published; los borradores dan 404. */
import { eq } from 'drizzle-orm';

import { properties, media } from '../../db/schema';
import type { MediaBucket } from '../admin/media/bucket';
import type { AdminDatabase } from '../admin/types';

export interface PublicMediaRequest {
  /** Identificador de la fila, tal como viaja en la URL publica. */
  mediaId: number;
  db: AdminDatabase;
  bucket: MediaBucket;
  /** Cabecera `If-None-Match` del navegador, si la manda. */
  ifNoneMatch?: string | null;
}

/**
 * Cuanto puede guardarse un archivo publicado.
 *
 * Una hora en el navegador y un dia en el borde: los archivos de una ficha
 * publicada cambian poco, y el `ETag` permite revalidar barato cuando cambian.
 */
export const PUBLIC_MEDIA_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

/** Un 404 sobrio: ni JSON del admin, ni pistas sobre lo que hay detras. */
function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Que no se cachee un 404: la propiedad puede publicarse manana.
      'cache-control': 'no-store',
    },
  });
}

/**
 * Sirve un archivo publico.
 *
 * Devuelve 404 en todos los casos en que no deba verse, sin distinguirlos.
 */
export async function servePublicMedia(request: PublicMediaRequest): Promise<Response> {
  const { mediaId, db, bucket } = request;

  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) return notFound();

  /*
   * Una sola consulta con el estado de la propiedad al lado: asi no hay forma
   * de servir el archivo sin haber mirado si su propiedad es publica.
   */
  const rows = await db
    .select({
      objectKey: media.objectKey,
      mimeType: media.mimeType,

      status: properties.status,
    })
    .from(media)
    .innerJoin(properties, eq(media.propertyId, properties.id))
    .where(eq(media.id, mediaId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return notFound();

  if (row.status !== 'published') return notFound();

  // Un video de YouTube no tiene objeto: se enlaza, no se sirve.
  if (row.objectKey === null) return notFound();

  const object = await bucket.get(row.objectKey);
  if (object === null || object.body === null) return notFound();

  const etag = object.httpEtag ?? null;

  // Si el navegador ya lo tiene, se le ahorra la descarga.
  if (etag !== null && request.ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': PUBLIC_MEDIA_CACHE_CONTROL },
    });
  }

  return new Response(object.body, {
    headers: {
      'content-type':
        object.httpMetadata?.contentType ?? row.mimeType ?? 'application/octet-stream',
      'content-length': String(object.size),
      'cache-control': PUBLIC_MEDIA_CACHE_CONTROL,
      /*
       * Estos bytes los subio una persona y se sirven desde el propio
       * dominio. `nosniff` obliga al navegador a creerse el `content-type`
       * declarado en vez de adivinarlo: sin el, un archivo cuidadosamente
       * preparado podria interpretarse como HTML y ejecutarse como si fuera
       * del sitio. La subida ya comprueba el contenido; esto es la segunda
       * cerradura.
       */
      'x-content-type-options': 'nosniff',
      ...(etag === null ? {} : { etag }),
    },
  });
}
