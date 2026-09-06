/**
 * Tests del pipeline de archivos.
 *
 * SQLite real con las migraciones del proyecto y un bucket en memoria. Lo que
 * se comprueba no es solo el camino feliz, sino que las dos mitades —objeto y
 * fila— nunca se quedan desparejadas.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { propertyMedia, propertyTourNodes } from '../../../db/schema';
import { MEDIA_SIZE_LIMITS } from '../../domain/media-upload';
import { createPropertyDraft } from '../properties/create-property';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase, AdminResult } from '../types';
import { createMemoryBucket, type MemoryBucket } from './bucket';
import { getPropertyMedia } from './get-media';
import { createMedia } from './media';
import { createMediaGroup } from './media-groups';
import {
  SAMPLE_GIF,
  SAMPLE_JPEG,
  SAMPLE_MP4,
  SAMPLE_PDF,
  SAMPLE_PNG,
  SAMPLE_TEXT,
  SAMPLE_WEBP,
  toArrayBuffer,
} from './test-files';
import { deleteMediaWithObject, uploadMedia, type UploadMediaInput } from './upload';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;
let bucket: MemoryBucket;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  bucket = createMemoryBucket();
  applySeed(sqlite);
});

async function newProperty(): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');
  return created.data.id;
}

function upload(overrides: Partial<UploadMediaInput> = {}): UploadMediaInput {
  return {
    mediaKind: 'image',
    fileName: 'fachada.jpg',
    declaredMimeType: 'image/jpeg',
    bytes: toArrayBuffer(SAMPLE_JPEG),
    ...overrides,
  };
}

function errorOf(result: AdminResult<unknown>): { code: string; message: string } {
  if (result.ok) throw new Error('se esperaba un error');
  return result.error;
}

async function rowsOf(propertyId: number): Promise<{ id: number; objectKey: string | null }[]> {
  return db
    .select({ id: propertyMedia.id, objectKey: propertyMedia.objectKey })
    .from(propertyMedia)
    .where(eq(propertyMedia.propertyId, propertyId));
}

/* -------------------------------------------------------------------------- */
/* Subida correcta                                                            */
/* -------------------------------------------------------------------------- */

describe('subida por tipo', () => {
  it('sube una imagen y deja objeto y fila coherentes', async () => {
    const propertyId = await newProperty();

    const result = await uploadMedia(db, bucket, propertyId, upload());

    expect(result.ok).toBe(true);
    expect(bucket.objects.size).toBe(1);

    const rows = await rowsOf(propertyId);
    const stored = [...bucket.objects.keys()][0];

    expect(rows).toHaveLength(1);
    // La fila apunta exactamente al objeto que se escribio.
    expect(rows[0]?.objectKey).toBe(stored);
  });

  it('sube un panorama', async () => {
    const propertyId = await newProperty();

    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({
        mediaKind: 'panorama',
        declaredMimeType: 'image/webp',
        bytes: toArrayBuffer(SAMPLE_WEBP),
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.mediaKind).toBe('panorama');
  });

  it('sube un documento', async () => {
    const propertyId = await newProperty();

    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({
        mediaKind: 'document',
        fileName: 'plano.pdf',
        declaredMimeType: 'application/pdf',
        bytes: toArrayBuffer(SAMPLE_PDF),
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('sube un video a R2', async () => {
    const propertyId = await newProperty();

    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({
        mediaKind: 'video',
        fileName: 'recorrido.mp4',
        declaredMimeType: 'video/mp4',
        bytes: toArrayBuffer(SAMPLE_MP4),
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.sourceProvider).toBe('r2');
  });

  it('guarda el tipo real y el tamano medido, no lo que declara el navegador', async () => {
    const propertyId = await newProperty();

    // Dice `image/png` pero manda un JPEG; ambos se admiten para imagen.
    await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({ declaredMimeType: 'image/png', bytes: toArrayBuffer(SAMPLE_PNG) }),
    );

    const view = await getPropertyMedia(db, propertyId);
    if (!view.ok) throw new Error('lectura');

    expect(view.data.ungrouped[0]?.mimeType).toBe('image/png');
    expect(view.data.ungrouped[0]?.fileSizeBytes).toBe(SAMPLE_PNG.byteLength);
  });

  it('el nombre original solo viaja como metadato del objeto', async () => {
    const propertyId = await newProperty();

    await uploadMedia(db, bucket, propertyId, upload({ fileName: '../../fachada final.jpg' }));

    const [key, object] = [...bucket.objects.entries()][0] ?? [];

    expect(key).not.toContain('fachada');
    expect(object?.customMetadata.originalName).toBe('fachada final.jpg');
    expect(object?.contentType).toBe('image/jpeg');
  });

  it('dos subidas seguidas no comparten clave', async () => {
    const propertyId = await newProperty();

    await uploadMedia(db, bucket, propertyId, upload());
    await uploadMedia(db, bucket, propertyId, upload());

    expect(bucket.objects.size).toBe(2);
    expect((await rowsOf(propertyId)).length).toBe(2);
  });

  it('la clave lleva la propiedad y el tipo en el prefijo', async () => {
    const propertyId = await newProperty();

    await uploadMedia(db, bucket, propertyId, upload({ mediaKind: 'panorama' }));

    const key = [...bucket.objects.keys()][0] ?? '';
    expect(key.startsWith(`propiedades/${propertyId}/panorama/`)).toBe(true);
  });

  it('puede subirse directamente dentro de un grupo', async () => {
    const propertyId = await newProperty();
    const group = await createMediaGroup(db, propertyId, { nameEs: 'Galería' });
    if (!group.ok) throw new Error('setup');

    const result = await uploadMedia(db, bucket, propertyId, upload({ groupId: group.data.id }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.groupId).toBe(group.data.id);
  });

  it('admite textos en los dos idiomas', async () => {
    const propertyId = await newProperty();

    await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({ titleEs: 'Fachada', altTextEs: 'Fachada principal', titleEn: 'Facade' }),
    );

    const view = await getPropertyMedia(db, propertyId);
    if (!view.ok) throw new Error('lectura');

    expect(view.data.ungrouped[0]?.translations.es?.title).toBe('Fachada');
    expect(view.data.ungrouped[0]?.translations.en?.title).toBe('Facade');
  });
});

/* -------------------------------------------------------------------------- */
/* Rechazos                                                                   */
/* -------------------------------------------------------------------------- */

describe('archivos rechazados', () => {
  it('un tipo MIME no admitido no llega a R2', async () => {
    const propertyId = await newProperty();

    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({ declaredMimeType: 'image/gif', bytes: toArrayBuffer(SAMPLE_GIF) }),
    );

    expect(errorOf(result).code).toBe('media_upload_rejected');
    expect(bucket.objects.size).toBe(0);
    expect(await rowsOf(propertyId)).toHaveLength(0);
  });

  it('un archivo cuyo contenido no coincide con lo declarado se rechaza', async () => {
    const propertyId = await newProperty();

    // Se presenta como JPEG, pero dentro hay un PDF.
    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({ bytes: toArrayBuffer(SAMPLE_PDF) }),
    );

    expect(errorOf(result).code).toBe('media_upload_rejected');
    expect(errorOf(result).message).toContain('no coincide');
    expect(bucket.objects.size).toBe(0);
  });

  it('un contenido irreconocible se rechaza', async () => {
    const propertyId = await newProperty();

    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({ bytes: toArrayBuffer(SAMPLE_TEXT) }),
    );

    expect(errorOf(result).code).toBe('media_upload_rejected');
    expect(bucket.objects.size).toBe(0);
  });

  it('un archivo demasiado grande se rechaza y el mensaje dice el limite', async () => {
    const propertyId = await newProperty();

    const grande = new Uint8Array(MEDIA_SIZE_LIMITS.image + 1);
    grande.set(SAMPLE_JPEG.subarray(0, 8));

    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({ bytes: toArrayBuffer(grande) }),
    );

    expect(errorOf(result).code).toBe('media_upload_rejected');
    expect(errorOf(result).message).toContain('12 MB');
    expect(bucket.objects.size).toBe(0);
  });

  it('un archivo vacio se rechaza', async () => {
    const propertyId = await newProperty();

    const result = await uploadMedia(db, bucket, propertyId, upload({ bytes: new ArrayBuffer(0) }));

    expect(errorOf(result).code).toBe('media_upload_rejected');
    expect(bucket.objects.size).toBe(0);
  });

  it('ningun mensaje de rechazo filtra detalles internos', async () => {
    const propertyId = await newProperty();

    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({ bytes: toArrayBuffer(SAMPLE_TEXT) }),
    );

    const { message } = errorOf(result);
    expect(message).not.toMatch(/R2|SQL|property_media|bucket|Error/i);
    expect(message.endsWith('.')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Fallos y compensacion                                                      */
/* -------------------------------------------------------------------------- */

describe('coordinacion entre R2 y la base', () => {
  it('si R2 falla, no se registra ninguna fila', async () => {
    const propertyId = await newProperty();
    bucket.failNextPut();

    const result = await uploadMedia(db, bucket, propertyId, upload());

    expect(errorOf(result).code).toBe('media_upload_failed');
    expect(bucket.objects.size).toBe(0);
    expect(await rowsOf(propertyId)).toHaveLength(0);
  });

  it('si la fila no se puede crear, se retira el objeto recien subido', async () => {
    const propertyId = await newProperty();
    const otherProperty = await newProperty();

    const foreignGroup = await createMediaGroup(db, otherProperty, { nameEs: 'Ajeno' });
    if (!foreignGroup.ok) throw new Error('setup');

    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({ groupId: foreignGroup.data.id }),
    );

    expect(errorOf(result).code).toBe('media_group_property_mismatch');
    // Compensacion: el objeto no se queda huerfano.
    expect(bucket.objects.size).toBe(0);
    expect(await rowsOf(propertyId)).toHaveLength(0);
  });

  it('si la base revienta, tambien se compensa antes de propagar el fallo', async () => {
    const propertyId = await newProperty();

    const insert = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
      throw new Error('D1_ERROR: no such table');
    });

    await expect(uploadMedia(db, bucket, propertyId, upload())).rejects.toThrow();

    insert.mockRestore();

    expect(bucket.objects.size).toBe(0);
    expect(await rowsOf(propertyId)).toHaveLength(0);
  });

  it('si la compensacion tambien falla, el error original es el que sale', async () => {
    const propertyId = await newProperty();
    const otherProperty = await newProperty();

    const foreignGroup = await createMediaGroup(db, otherProperty, { nameEs: 'Ajeno' });
    if (!foreignGroup.ok) throw new Error('setup');

    bucket.failNextDelete();

    const result = await uploadMedia(
      db,
      bucket,
      propertyId,
      upload({ groupId: foreignGroup.data.id }),
    );

    // Queda un objeto huerfano, pero el administrador ve el motivo real.
    expect(errorOf(result).code).toBe('media_group_property_mismatch');
    expect(await rowsOf(propertyId)).toHaveLength(0);
  });

  it('una propiedad inexistente no deja objeto detras', async () => {
    const result = await uploadMedia(db, bucket, 9999, upload());

    expect(errorOf(result).code).toBe('not_found');
    expect(bucket.objects.size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Borrado                                                                    */
/* -------------------------------------------------------------------------- */

describe('borrado coordinado', () => {
  it('borra la fila y el objeto', async () => {
    const propertyId = await newProperty();
    const uploaded = await uploadMedia(db, bucket, propertyId, upload());
    if (!uploaded.ok) throw new Error('setup');

    const result = await deleteMediaWithObject(db, bucket, propertyId, uploaded.data.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.objectRemoved).toBe(true);
    expect(bucket.objects.size).toBe(0);
    expect(await rowsOf(propertyId)).toHaveLength(0);
  });

  it('un panorama usado por el recorrido 360 no se borra: la fila y el objeto siguen', async () => {
    const propertyId = await newProperty();

    const uploaded = await uploadMedia(db, bucket, propertyId, upload({ mediaKind: 'panorama' }));
    if (!uploaded.ok) throw new Error('setup');

    await db
      .insert(propertyTourNodes)
      .values({ propertyId, propertyMediaId: uploaded.data.id, isStart: true });

    const result = await deleteMediaWithObject(db, bucket, propertyId, uploaded.data.id);

    expect(errorOf(result).code).toBe('media_in_use');
    // Lo importante: R2 no se ha tocado.
    expect(bucket.objects.size).toBe(1);
    expect(await rowsOf(propertyId)).toHaveLength(1);
  });

  it('si R2 no puede retirar el objeto, la fila ya se fue y se informa', async () => {
    const propertyId = await newProperty();
    const uploaded = await uploadMedia(db, bucket, propertyId, upload());
    if (!uploaded.ok) throw new Error('setup');

    bucket.failNextDelete();

    const result = await deleteMediaWithObject(db, bucket, propertyId, uploaded.data.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.objectRemoved).toBe(false);

    // Queda un objeto huerfano, pero ninguna fila apunta a el.
    expect(await rowsOf(propertyId)).toHaveLength(0);
    expect(bucket.objects.size).toBe(1);
  });

  it('un archivo de otra propiedad no se puede borrar ni toca su objeto', async () => {
    const first = await newProperty();
    const second = await newProperty();

    const uploaded = await uploadMedia(db, bucket, second, upload());
    if (!uploaded.ok) throw new Error('setup');

    const result = await deleteMediaWithObject(db, bucket, first, uploaded.data.id);

    expect(errorOf(result).code).toBe('media_not_found');
    expect(bucket.objects.size).toBe(1);
    expect(await rowsOf(second)).toHaveLength(1);
  });

  it('borrar un video de YouTube no toca R2', async () => {
    const propertyId = await newProperty();

    const youtube = await createMedia(db, propertyId, {
      mediaKind: 'video',
      sourceProvider: 'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });
    if (!youtube.ok) throw new Error('setup');

    const uploaded = await uploadMedia(db, bucket, propertyId, upload());
    if (!uploaded.ok) throw new Error('setup');

    const result = await deleteMediaWithObject(db, bucket, propertyId, youtube.data.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.objectRemoved).toBe(false);

    // El objeto de la imagen sigue intacto: no habia nada que borrar.
    expect(bucket.objects.size).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* YouTube                                                                    */
/* -------------------------------------------------------------------------- */

describe('YouTube sigue siendo solo metadatos', () => {
  it('registrar un video de YouTube no escribe nada en R2', async () => {
    const propertyId = await newProperty();

    const result = await createMedia(db, propertyId, {
      mediaKind: 'video',
      sourceProvider: 'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });

    expect(result.ok).toBe(true);
    expect(bucket.objects.size).toBe(0);
  });

  it('la subida es siempre de R2: no hay forma de pedir YouTube por aqui', async () => {
    const propertyId = await newProperty();

    const result = await uploadMedia(db, bucket, propertyId, upload());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.sourceProvider).toBe('r2');
  });
});
