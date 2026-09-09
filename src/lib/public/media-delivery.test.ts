/**
 * Tests de la entrega publica de multimedia.
 *
 * Contra SQLite real y un bucket en memoria. Lo que se comprueba sobre todo es
 * lo que NO se sirve: un archivo de un borrador, de una propiedad oculta o de
 * otra propiedad no puede salir por esta puerta.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties } from '../../db/schema';
import { createMemoryBucket, type MemoryBucket } from '../admin/media/bucket';
import { createMedia, setMediaRoles } from '../admin/media/media';
import { createPropertyDraft } from '../admin/properties/create-property';
import { updateProperty } from '../admin/properties/update-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import { createTourNode } from '../admin/tour/nodes';
import { uploadMedia } from '../admin/media/upload';
import { SAMPLE_JPEG, SAMPLE_PDF, toArrayBuffer } from '../admin/media/test-files';
import type { AdminBatchDatabase } from '../admin/types';
import type { CommercialStatus, PublicationStatus } from '../domain/vocabularies';
import { PUBLIC_MEDIA_CACHE_CONTROL, servePublicMedia } from './media-delivery';

/** Lectura de fuentes para las comprobaciones estructurales. */
function readSource(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

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

async function setStatus(
  propertyId: number,
  publicationStatus: PublicationStatus,
  commercialStatus: CommercialStatus = 'available',
): Promise<void> {
  await db
    .update(properties)
    .set({ publicationStatus, commercialStatus })
    .where(eq(properties.id, propertyId));
}

/** Sube una imagen real y devuelve el id de su fila. */
async function uploadImage(propertyId: number, name = 'fachada.jpg'): Promise<number> {
  const result = await uploadMedia(db, bucket, propertyId, {
    mediaKind: 'image',
    fileName: name,
    declaredMimeType: 'image/jpeg',
    bytes: toArrayBuffer(SAMPLE_JPEG),
  });

  if (!result.ok) throw new Error('setup: imagen');
  return result.data.id;
}

/** Propiedad publicada y visible, con una imagen dentro. */
async function publishedWithImage(): Promise<{ propertyId: number; mediaId: number }> {
  const propertyId = await newProperty();
  const mediaId = await uploadImage(propertyId);

  await upsertPropertyTranslation(db, propertyId, {
    locale: 'es',
    slug: 'lote-publicado',
    title: 'Lote publicado',
  });
  await setStatus(propertyId, 'published');

  return { propertyId, mediaId };
}

function serve(mediaId: number, ifNoneMatch?: string): Promise<Response> {
  return servePublicMedia({
    mediaId,
    db,
    bucket,
    ...(ifNoneMatch === undefined ? {} : { ifNoneMatch }),
  });
}

/* -------------------------------------------------------------------------- */
/* Lo que si se sirve                                                         */
/* -------------------------------------------------------------------------- */

describe('archivos de una propiedad publicada', () => {
  it('se sirven con su tipo real y cacheables', async () => {
    const { mediaId } = await publishedWithImage();

    const response = await serve(mediaId);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe(PUBLIC_MEDIA_CACHE_CONTROL);

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBe(SAMPLE_JPEG.byteLength);
  });

  it('el navegador no adivina el tipo: estos bytes los subio alguien', async () => {
    const { mediaId } = await publishedWithImage();

    const response = await serve(mediaId);

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('el cacheo publico es distinto del del admin', () => {
    // El admin responde `no-store`; esto es contenido ya publicado.
    expect(PUBLIC_MEDIA_CACHE_CONTROL).toContain('public');
    expect(PUBLIC_MEDIA_CACHE_CONTROL).not.toContain('no-store');
  });

  it('llevan ETag y responden 304 si el navegador ya lo tiene', async () => {
    const { mediaId } = await publishedWithImage();

    const first = await serve(mediaId);
    const etag = first.headers.get('etag');
    expect(etag).not.toBeNull();

    const second = await serve(mediaId, etag ?? undefined);

    expect(second.status).toBe(304);
    expect(second.headers.get('cache-control')).toBe(PUBLIC_MEDIA_CACHE_CONTROL);
  });

  it('un ETag distinto vuelve a descargar', async () => {
    const { mediaId } = await publishedWithImage();

    const response = await serve(mediaId, '"otro"');

    expect(response.status).toBe(200);
  });

  it('tambien sirve documentos', async () => {
    const propertyId = await newProperty();

    const uploaded = await uploadMedia(db, bucket, propertyId, {
      mediaKind: 'document',
      fileName: 'plano.pdf',
      declaredMimeType: 'application/pdf',
      bytes: toArrayBuffer(SAMPLE_PDF),
    });
    if (!uploaded.ok) throw new Error('setup');

    await setStatus(propertyId, 'published');

    const response = await serve(uploaded.data.id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });

  it('una vendida que se publica a proposito sigue sirviendo su media', async () => {
    const { propertyId, mediaId } = await publishedWithImage();

    await updateProperty(db, propertyId, { showWhenSold: true });
    await setStatus(propertyId, 'published', 'sold');

    expect((await serve(mediaId)).status).toBe(200);
  });

  it('una reservada sigue siendo escaparate', async () => {
    const { propertyId, mediaId } = await publishedWithImage();
    await setStatus(propertyId, 'published', 'reserved');

    expect((await serve(mediaId)).status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Lo que NO se sirve                                                         */
/* -------------------------------------------------------------------------- */

describe('archivos que no deben salir', () => {
  it('un borrador no sirve nada', async () => {
    const propertyId = await newProperty();
    const mediaId = await uploadImage(propertyId);

    const response = await serve(mediaId);

    expect(response.status).toBe(404);
  });

  it('tampoco en revision, aprobada ni archivada', async () => {
    for (const status of ['in_review', 'approved', 'archived'] as const) {
      const propertyId = await newProperty();
      const mediaId = await uploadImage(propertyId, `${status}.jpg`);
      await setStatus(propertyId, status);

      expect((await serve(mediaId)).status).toBe(404);
    }
  });

  it('una vendida oculta no filtra sus fotos', async () => {
    const { propertyId, mediaId } = await publishedWithImage();

    // Publicada, pero oculta por la regla comercial.
    await setStatus(propertyId, 'published', 'sold');

    expect((await serve(mediaId)).status).toBe(404);
  });

  it('un archivo inexistente responde igual que uno prohibido', async () => {
    const { mediaId } = await publishedWithImage();

    const missing = await serve(999_999);
    const draftProperty = await newProperty();
    const hidden = await serve(await uploadImage(draftProperty, 'oculta.jpg'));

    // No se distingue entre "no existe" y "no es publico": decirlo seria filtrar.
    expect(missing.status).toBe(404);
    expect(hidden.status).toBe(404);
    expect(await missing.text()).toBe(await hidden.text());

    // Y el que si es publico sigue funcionando.
    expect((await serve(mediaId)).status).toBe(200);
  });

  it('un video de YouTube no se sirve como archivo', async () => {
    const propertyId = await newProperty();

    const created = await createMedia(db, propertyId, {
      mediaKind: 'video',
      sourceProvider: 'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });
    if (!created.ok) throw new Error('setup');

    await setStatus(propertyId, 'published');

    expect((await serve(created.data.id)).status).toBe(404);
  });

  it('si el objeto ya no esta en R2, no se sirve un cuerpo vacio', async () => {
    const { mediaId } = await publishedWithImage();
    bucket.objects.clear();

    expect((await serve(mediaId)).status).toBe(404);
  });

  it('un identificador que no es un entero positivo no llega ni a consultar', async () => {
    for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 10]) {
      expect((await serve(id)).status).toBe(404);
    }
  });

  it('un 404 no se cachea: la propiedad puede publicarse manana', async () => {
    const response = await serve(999_999);

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

/* -------------------------------------------------------------------------- */
/* Superficie de ataque                                                       */
/* -------------------------------------------------------------------------- */

describe('no se puede pedir un objeto arbitrario', () => {
  it('la clave de R2 sale de la base, nunca de la peticion', () => {
    const source = readSource('src/lib/public/media-delivery.ts');

    // La firma solo acepta un identificador numerico.
    expect(source).toContain('mediaId: number');
    expect(source).not.toContain('objectKey: string');
    expect(source).toContain('propertyMedia.objectKey');
  });

  it('la visibilidad se comprueba en la misma consulta', () => {
    const source = readSource('src/lib/public/media-delivery.ts');

    expect(source).toContain('isPubliclyVisible');
    expect(source).toContain('innerJoin(properties');
  });

  it('la ruta publica solo recibe el identificador', () => {
    const route = readSource('src/pages/media/[id].ts');

    expect(route).toContain('mediaId: Number(params.id)');
    expect(route).not.toContain('objectKey');
    expect(route).not.toContain('searchParams');
  });

  it('no reutiliza el endpoint del admin y este sigue protegido', () => {
    const source = readSource('src/lib/public/media-delivery.ts');
    const admin = readSource('src/lib/admin/http/media-handlers.ts');

    // Puertas separadas: la publica no pasa por el guardia del admin.
    expect(source).not.toContain('requireAdminAccess');
    expect(source).not.toContain('/api/admin');

    // Y la del admin sigue exigiendo sesion y respondiendo `no-store`.
    expect(admin).toContain('handleGetMediaFile');
    expect(admin).toContain("'cache-control': 'no-store'");
  });

  it('un archivo de otra propiedad no se cuela cambiando el numero', async () => {
    const published = await publishedWithImage();

    const otherProperty = await newProperty();
    const otherMedia = await uploadImage(otherProperty, 'ajena.jpg');

    // La segunda propiedad sigue en borrador: su id no sirve de nada.
    expect((await serve(otherMedia)).status).toBe(404);
    expect((await serve(published.mediaId)).status).toBe(200);
  });

  it('marcar un rol no cambia quien puede verlo', async () => {
    const propertyId = await newProperty();
    const mediaId = await uploadImage(propertyId);

    await setMediaRoles(db, propertyId, mediaId, { isHero: true, isCatalogCover: true });

    // Sigue siendo un borrador.
    expect((await serve(mediaId)).status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* Panoramas del recorrido                                                    */
/* -------------------------------------------------------------------------- */

describe('los panoramas del recorrido pasan por la misma puerta', () => {
  /** Un panorama de verdad, subido como lo hace el panel. */
  async function uploadPanorama(propertyId: number): Promise<number> {
    const result = await uploadMedia(db, bucket, propertyId, {
      mediaKind: 'panorama',
      fileName: 'entrada.jpg',
      declaredMimeType: 'image/jpeg',
      bytes: toArrayBuffer(SAMPLE_JPEG),
    });

    if (!result.ok) throw new Error('setup: panorama');
    return result.data.id;
  }

  it('el de una propiedad publicada se sirve', async () => {
    const propertyId = await newProperty();
    const mediaId = await uploadPanorama(propertyId);

    await upsertPropertyTranslation(db, propertyId, {
      locale: 'es',
      slug: 'lote-publicado',
      title: 'Lote publicado',
    });
    await setStatus(propertyId, 'published');

    const response = await serve(mediaId);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(PUBLIC_MEDIA_CACHE_CONTROL);
  });

  it('el de un borrador no, aunque tenga un punto del recorrido colgado', async () => {
    const propertyId = await newProperty();
    const mediaId = await uploadPanorama(propertyId);

    const node = await createTourNode(db, propertyId, { propertyMediaId: mediaId });
    if (!node.ok) throw new Error('setup: punto');

    // Montar el recorrido no publica nada: la propiedad sigue en borrador.
    expect((await serve(mediaId)).status).toBe(404);
  });

  it('el de una vendida y oculta tampoco', async () => {
    const propertyId = await newProperty();
    const mediaId = await uploadPanorama(propertyId);

    await upsertPropertyTranslation(db, propertyId, {
      locale: 'es',
      slug: 'lote-vendido',
      title: 'Lote vendido',
    });
    await setStatus(propertyId, 'published', 'sold');

    expect((await serve(mediaId)).status).toBe(404);
  });

  it('probar numeros cercanos no descubre el panorama de otra propiedad', async () => {
    const hidden = await newProperty();
    const secret = await uploadPanorama(hidden);

    const { mediaId } = await publishedWithImage();

    // La imagen publicada si sale; el panorama del borrador, no.
    expect((await serve(mediaId)).status).toBe(200);
    expect((await serve(secret)).status).toBe(404);
  });
});
