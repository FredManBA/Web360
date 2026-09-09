/**
 * Entrega publica de multimedia.
 *
 * Es la unica parte del sitio publico que se ejecuta en el Worker: sirve los
 * archivos de R2 sin hacer publico el bucket.
 *
 * Como se protege, que es lo que importa aqui:
 *
 * - la URL solo lleva el identificador de la FILA, nunca una clave de R2. Una
 *   clave arbitraria no tiene por donde entrar;
 * - la clave se lee de la base y se comprueba, en la misma consulta, que su
 *   propiedad esta publicada y es visible. Se reutiliza `isPubliclyVisible`,
 *   que es la misma regla que decide el catalogo;
 * - un archivo de un borrador, de una propiedad archivada o de una vendida y
 *   oculta responde 404, igual que uno inexistente. No se distingue entre
 *   "no existe" y "no es publico": decirlo seria filtrar;
 * - cuando la version desplegada trae manifiesto, ademas tiene que estar en
 *   el. La base dice si el archivo PUEDE ser publico; el manifiesto, si
 *   pertenece a la version que el visitante esta viendo.
 *
 * No comparte nada con el endpoint del admin: aquel exige sesion y responde
 * `no-store`; este es abierto y cacheable. Son dos puertas distintas a
 * proposito.
 */

import { eq } from 'drizzle-orm';

import { properties, propertyMedia } from '../../db/schema';
import { releaseAllowsMedia, type ReleaseManifest } from '../publication/release';
import type { MediaBucket } from '../admin/media/bucket';
import type { AdminDatabase } from '../admin/types';
import { isPubliclyVisible } from '../domain/visibility';

export interface PublicMediaRequest {
  /** Identificador de la fila, tal como viaja en la URL publica. */
  mediaId: number;
  db: AdminDatabase;
  bucket: MediaBucket;
  /** Cabecera `If-None-Match` del navegador, si la manda. */
  ifNoneMatch?: string | null;
  /**
   * Manifiesto de la version desplegada, cuando la hay.
   *
   * ACOTA lo que la base permite, nunca lo amplia: sirve para que el HTML
   * desplegado y los archivos que se sirven pertenezcan a la misma version.
   * Sin manifiesto (`null` o ausente) decide la base, como siempre.
   */
  release?: ReleaseManifest | null;
}

/**
 * Cuanto puede guardarse un archivo publicado.
 *
 * Una hora en el navegador y un dia en el borde: los archivos de una ficha
 * publicada cambian poco, y el `ETag` permite revalidar barato cuando cambian.
 * La invalidacion fina llegara con el flujo de publicacion.
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
   * Primero la version desplegada: si su HTML no referencia este archivo, no
   * hay nada que servir y ni siquiera hace falta consultar la base.
   */
  if (!releaseAllowsMedia(request.release ?? null, mediaId)) return notFound();

  /*
   * Una sola consulta con el estado de la propiedad al lado: asi no hay forma
   * de servir el archivo sin haber mirado si su propiedad es publica.
   */
  const rows = await db
    .select({
      objectKey: propertyMedia.objectKey,
      mimeType: propertyMedia.mimeType,

      publicationStatus: properties.publicationStatus,
      commercialStatus: properties.commercialStatus,
      showWhenSold: properties.showWhenSold,
    })
    .from(propertyMedia)
    .innerJoin(properties, eq(propertyMedia.propertyId, properties.id))
    .where(eq(propertyMedia.id, mediaId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return notFound();

  if (
    !isPubliclyVisible({
      publicationStatus: row.publicationStatus,
      commercialStatus: row.commercialStatus,
      showWhenSold: row.showWhenSold,
    })
  ) {
    return notFound();
  }

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
