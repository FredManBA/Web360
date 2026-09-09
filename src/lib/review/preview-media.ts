/**
 * Entrega de archivos durante la revision.
 *
 * Es una puerta APARTE de `/media/[id]`, no una relajacion de aquella. La
 * publica solo sirve propiedades publicamente visibles y sigue igual de
 * estrecha; esta sirve archivos de un borrador, y por eso exige mas:
 *
 * - un token valido, resuelto con las mismas reglas que la vista previa;
 * - que el archivo pertenezca EXACTAMENTE a la propiedad que ese token
 *   autoriza. Un id de otra propiedad responde 404, aunque el token sea
 *   perfectamente valido;
 * - la clave del objeto sale de la base, nunca de la peticion.
 *
 * Y `no-store` siempre: un borrador no se queda en la cache de nadie.
 */

import { eq } from 'drizzle-orm';

import { propertyMedia } from '../../db/schema';
import type { AdminDatabase } from '../admin/types';
import type { MediaBucket } from '../admin/media/bucket';
import { resolveReviewToken } from './review';

export interface ReviewMediaRequest {
  token: string;
  mediaId: number;
  db: AdminDatabase;
  bucket: MediaBucket;
  now?: Date;
}

/** Un 404 sobrio: ni pistas sobre el token ni sobre lo que hay detras. */
function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function serveReviewMedia(request: ReviewMediaRequest): Promise<Response> {
  const { mediaId, db, bucket } = request;

  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) return notFound();

  const resolved = await resolveReviewToken(db, request.token, request.now ?? new Date());
  if (resolved === null) return notFound();

  const rows = await db
    .select({
      propertyId: propertyMedia.propertyId,
      objectKey: propertyMedia.objectKey,
      mimeType: propertyMedia.mimeType,
    })
    .from(propertyMedia)
    .where(eq(propertyMedia.id, mediaId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return notFound();

  /*
   * La comprobacion que sostiene todo esto: el archivo tiene que ser de la
   * propiedad que el token autoriza. Sin ella, cualquier reviewer con un
   * enlace valido podria pasear por la multimedia del catalogo entero.
   */
  if (row.propertyId !== resolved.propertyId) return notFound();

  // Un video de YouTube no tiene objeto: se enlaza, no se sirve.
  if (row.objectKey === null) return notFound();

  const object = await bucket.get(row.objectKey);
  if (object === null || object.body === null) return notFound();

  return new Response(object.body, {
    headers: {
      'content-type':
        object.httpMetadata?.contentType ?? row.mimeType ?? 'application/octet-stream',
      'content-length': String(object.size),
      // Un borrador no se cachea en ninguna parte, ni siquiera un rato.
      'cache-control': 'no-store',
      // Y no se indexa aunque alguien enlace el archivo suelto.
      'x-robots-tag': 'noindex, nofollow',
      /*
       * Estos bytes los subio una persona y se sirven desde el propio
       * dominio. `nosniff` obliga al navegador a creerse el `content-type`
       * declarado en vez de adivinarlo: sin el, un archivo cuidadosamente
       * preparado podria interpretarse como HTML y ejecutarse como si fuera
       * del sitio. La subida ya comprueba el contenido; esto es la segunda
       * cerradura.
       */
      'x-content-type-options': 'nosniff',
    },
  });
}

/** Ruta de un archivo dentro de una revision concreta. */
export function reviewMediaUrl(token: string, mediaId: number): string {
  return `/review/${encodeURIComponent(token)}/media/${mediaId}`;
}
