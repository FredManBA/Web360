/**
 * Subida y borrado de archivos en R2.
 *
 * Aqui se coordinan las dos mitades que antes iban por separado: el objeto en
 * el bucket y su fila en la base. El orden esta elegido para que ningun fallo
 * deje una referencia rota:
 *
 * - al subir, primero R2 y despues la fila; si la fila falla se borra el
 *   objeto recien subido, de modo que no queda basura;
 * - al borrar, primero la fila y despues el objeto; si la fila se niega (un
 *   panorama en uso por el recorrido 360) no se toca R2.
 *
 * Lo peor que puede pasar es un objeto huerfano en el bucket, que no rompe
 * nada. Lo contrario —una fila apuntando a un objeto inexistente— si.
 *
 * YouTube no pasa por aqui en ningun momento: sigue siendo solo metadatos.
 */

import {
  buildObjectKey,
  checkUpload,
  MEDIA_SIZE_LIMITS,
  sanitizeFileName,
  type UploadProblem,
} from '../../domain/media-upload';
import type { MediaKind } from '../../domain/vocabularies';
import { fail, ok, type AdminBatchDatabase, type AdminResult } from '../types';
import type { MediaBucket } from './bucket';
import { createMedia, deleteMedia, loadMediaRow, type MediaRecord, type MediaTexts } from './media';

export interface UploadMediaInput extends MediaTexts {
  groupId?: number | null;
  mediaKind: MediaKind;
  /** Nombre con el que llego el archivo. Solo se usa como metadato en R2. */
  fileName: string;
  /** Tipo que declara el navegador. Se comprueba contra los bytes. */
  declaredMimeType: string;
  bytes: ArrayBuffer;
}

/** Mensajes de rechazo, en el idioma del panel. */
const UPLOAD_MESSAGES: Record<UploadProblem, string> = {
  empty_file: 'El archivo está vacío.',
  mime_not_allowed: 'Ese tipo de archivo no se admite aquí.',
  content_unrecognized: 'No reconocemos el contenido del archivo.',
  content_mismatch: 'El contenido del archivo no coincide con su tipo.',
  too_large: 'El archivo supera el tamaño máximo permitido.',
};

/** El primero es el mas explicativo: se informa de ese. */
function uploadFailure<T>(problem: UploadProblem, mediaKind: MediaKind): AdminResult<T> {
  const limit = Math.round(MEDIA_SIZE_LIMITS[mediaKind] / (1024 * 1024));

  const message =
    problem === 'too_large'
      ? `${UPLOAD_MESSAGES.too_large} El máximo para este tipo es de ${limit} MB.`
      : UPLOAD_MESSAGES[problem];

  return fail({ code: 'media_upload_rejected', message, field: 'file' });
}

/**
 * Sube el archivo y registra sus metadatos.
 *
 * Solo escribe en R2 cuando el contenido ya ha pasado todas las
 * comprobaciones, y solo crea la fila cuando el objeto esta escrito.
 */
export async function uploadMedia(
  db: AdminBatchDatabase,
  bucket: MediaBucket,
  propertyId: number,
  input: UploadMediaInput,
): Promise<AdminResult<MediaRecord>> {
  const bytes = new Uint8Array(input.bytes);

  const { problems, detectedMimeType } = checkUpload({
    mediaKind: input.mediaKind,
    declaredMimeType: input.declaredMimeType,
    bytes,
  });

  const firstProblem = problems[0];
  if (firstProblem !== undefined) return uploadFailure(firstProblem, input.mediaKind);

  // `checkUpload` solo deja pasar el archivo si reconocio su contenido.
  if (detectedMimeType === null) return uploadFailure('content_unrecognized', input.mediaKind);

  /*
   * La clave sale de un UUID, nunca del nombre original: ese nombre lo elige
   * quien sube y podria traer rutas o colisiones.
   */
  const objectKey = buildObjectKey(
    propertyId,
    input.mediaKind,
    detectedMimeType,
    crypto.randomUUID(),
  );

  try {
    await bucket.put(objectKey, input.bytes, {
      httpMetadata: { contentType: detectedMimeType },
      customMetadata: {
        propertyId: String(propertyId),
        mediaKind: input.mediaKind,
        originalName: sanitizeFileName(input.fileName),
      },
    });
  } catch {
    // Sin objeto no hay fila: no se registra nada.
    return fail({
      code: 'media_upload_failed',
      message: 'No pudimos guardar el archivo. Vuelve a intentarlo.',
      field: 'file',
    });
  }

  let created: AdminResult<MediaRecord>;

  try {
    created = await createMedia(db, propertyId, {
      groupId: input.groupId ?? null,
      mediaKind: input.mediaKind,
      sourceProvider: 'r2',
      objectKey,
      mimeType: detectedMimeType,
      fileSizeBytes: bytes.length,

      titleEs: input.titleEs,
      altTextEs: input.altTextEs,
      captionEs: input.captionEs,
      titleEn: input.titleEn,
      altTextEn: input.altTextEn,
      captionEn: input.captionEn,
    });
  } catch (error) {
    // La base fallo de forma inesperada: se retira lo que si llego a subirse.
    await compensate(bucket, objectKey);
    throw error;
  }

  if (!created.ok) {
    await compensate(bucket, objectKey);
    return created;
  }

  return created;
}

/**
 * Retira el objeto recien subido cuando la fila no llego a crearse.
 *
 * Un fallo aqui no se propaga: el error que importa es el que provoco la
 * compensacion, y taparlo con otro solo confundiria.
 */
async function compensate(bucket: MediaBucket, objectKey: string): Promise<void> {
  try {
    await bucket.delete(objectKey);
  } catch {
    // Queda un objeto huerfano en el bucket; no rompe ninguna referencia.
  }
}

export interface DeletedMedia {
  id: number;
  /** Falso cuando la fila no tenia objeto (YouTube) o R2 no pudo retirarlo. */
  objectRemoved: boolean;
}

/**
 * Borra la fila y, si procede, el objeto.
 *
 * La fila va primero a proposito: si la base se niega —el `RESTRICT` del
 * recorrido 360— el objeto sigue donde estaba y nada queda a medias.
 */
export async function deleteMediaWithObject(
  db: AdminBatchDatabase,
  bucket: MediaBucket,
  propertyId: number,
  mediaId: number,
): Promise<AdminResult<DeletedMedia>> {
  const found = await loadMediaRow(db, propertyId, mediaId);
  if (!found.ok) return found;

  const { objectKey } = found.data;

  const deleted = await deleteMedia(db, propertyId, mediaId);
  if (!deleted.ok) return deleted;

  // Un video de YouTube no tiene objeto que retirar.
  if (objectKey === null) return ok({ id: mediaId, objectRemoved: false });

  try {
    await bucket.delete(objectKey);
  } catch {
    /*
     * La fila ya no existe, asi que no hay referencia rota: solo un objeto
     * huerfano. Se informa para que quede constancia, sin fallar la operacion
     * que el administrador pidio.
     */
    return ok({ id: mediaId, objectRemoved: false });
  }

  return ok({ id: mediaId, objectRemoved: true });
}
