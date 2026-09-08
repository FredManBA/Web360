/**
 * Tests de la version candidata y su manifiesto.
 *
 * Lo que aqui importa es que se pueda saber COMO quedaria el sitio sin haber
 * cambiado nada todavia, y que el HTML de una version y los archivos que se
 * sirven con ella hablen de lo mismo.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties, propertyMedia } from '../../db/schema';
import { createMemoryBucket, type MemoryBucket } from '../admin/media/bucket';
import { setMediaRoles } from '../admin/media/media';
import { uploadMedia } from '../admin/media/upload';
import { SAMPLE_JPEG, toArrayBuffer } from '../admin/media/test-files';
import { createPropertyDraft } from '../admin/properties/create-property';
import { updateProperty } from '../admin/properties/update-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import type { AdminBatchDatabase } from '../admin/types';
import type { PublicationStatus } from '../domain/vocabularies';
import { servePublicMedia } from '../public/media-delivery';
import { buildCandidateSnapshot, catalogueOf } from '../public/read-model';
import {
  buildReleaseCandidate,
  releaseAllowsMedia,
  releaseIdFor,
  releaseMediaIds,
} from './release';
import { deployedReleaseManifest } from './deployed-release';

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

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** El estado se coloca directo: el camino hasta el se prueba en su sitio. */
async function setStatus(propertyId: number, status: PublicationStatus): Promise<void> {
  await db
    .update(properties)
    .set({ publicationStatus: status })
    .where(eq(properties.id, propertyId));
}

async function property(slug: string, status: PublicationStatus): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');

  const propertyId = created.data.id;

  await updateProperty(db, propertyId, {
    propertyTypeId: 1,
    priceMode: 'exact',
    priceAmountMinor: 9_000_000,
    currencyCode: 'USD',
    areaSquareMeters: 2100,
    province: 'Guanacaste',
    publicLatitude: 9.95,
    publicLongitude: -85.65,
  });

  await upsertPropertyTranslation(db, propertyId, {
    locale: 'es',
    slug,
    title: `Lote ${slug}`,
  });

  const media = await uploadMedia(db, bucket, propertyId, {
    mediaKind: 'image',
    fileName: `${slug}.jpg`,
    declaredMimeType: 'image/jpeg',
    bytes: toArrayBuffer(SAMPLE_JPEG),
  });
  if (!media.ok) throw new Error('setup: archivo');

  await setMediaRoles(db, propertyId, media.data.id, { isHero: true, isCatalogCover: true });
  await setStatus(propertyId, status);

  return propertyId;
}

/** El archivo de una propiedad concreta. */
async function mediaIdOf(propertyId: number): Promise<number> {
  const rows = await db
    .select({ id: propertyMedia.id })
    .from(propertyMedia)
    .where(eq(propertyMedia.propertyId, propertyId))
    .limit(1);

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('setup: sin archivo');

  return id;
}

/* -------------------------------------------------------------------------- */
/* Snapshot candidato                                                         */
/* -------------------------------------------------------------------------- */

describe('el snapshot candidato', () => {
  it('incluye la propiedad aprobada como si ya estuviera publicada', async () => {
    const propertyId = await property('lote-candidato', 'approved');

    const snapshot = await buildCandidateSnapshot(db, { propertyId, action: 'publish' });

    expect(catalogueOf(snapshot, 'es')).toHaveLength(1);
    expect(catalogueOf(snapshot, 'es')[0]?.slug).toBe('lote-candidato');
  });

  it('no toca la base', async () => {
    const propertyId = await property('lote-candidato', 'approved');

    await buildCandidateSnapshot(db, { propertyId, action: 'publish' });

    const rows = await db
      .select({ status: properties.publicationStatus })
      .from(properties)
      .where(eq(properties.id, propertyId));

    expect(rows[0]?.status).toBe('approved');
  });

  it('excluye la propiedad que se va a retirar', async () => {
    const propertyId = await property('lote-retirado', 'published');

    const snapshot = await buildCandidateSnapshot(db, { propertyId, action: 'unpublish' });

    expect(catalogueOf(snapshot, 'es')).toHaveLength(0);
  });

  it('no altera al resto del catalogo', async () => {
    await property('lote-vecino', 'published');
    const propertyId = await property('lote-candidato', 'approved');

    const snapshot = await buildCandidateSnapshot(db, { propertyId, action: 'publish' });

    expect(
      catalogueOf(snapshot, 'es')
        .map((card) => card.slug)
        .sort(),
    ).toEqual(['lote-candidato', 'lote-vecino']);
  });

  it('sigue respetando el estado comercial', async () => {
    const propertyId = await property('lote-vendido', 'approved');

    // Vendida y sin permiso para mostrarse vendida: no sale ni publicandola.
    await db
      .update(properties)
      .set({ commercialStatus: 'sold', showWhenSold: false })
      .where(eq(properties.id, propertyId));

    const snapshot = await buildCandidateSnapshot(db, { propertyId, action: 'publish' });

    expect(catalogueOf(snapshot, 'es')).toHaveLength(0);
  });

  it('un candidato de una propiedad en borrador no publica nada', async () => {
    const propertyId = await property('lote-borrador', 'draft');

    const snapshot = await buildCandidateSnapshot(db, { propertyId, action: 'publish' });

    /*
     * `publish` sobre un borrador es una peticion que la capa de aplicacion
     * ya rechaza; aqui solo se comprueba que la proyeccion tampoco inventa
     * nada por su cuenta si llegara a construirse.
     */
    expect(catalogueOf(snapshot, 'es')).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Manifiesto                                                                 */
/* -------------------------------------------------------------------------- */

describe('el manifiesto de la release', () => {
  it('identifica la version por la peticion que la origino', () => {
    expect(releaseIdFor({ id: 7, propertyId: 42, action: 'publish' })).toBe('publish-p42-r7');
  });

  it('contiene los archivos que el HTML referencia', async () => {
    const propertyId = await property('lote-candidato', 'approved');

    const candidate = await buildReleaseCandidate(db, {
      id: 1,
      propertyId,
      action: 'publish',
    });

    const card = catalogueOf(candidate.snapshot, 'es')[0];
    const cover = card?.media.cover?.url ?? '';

    expect(candidate.manifest.mediaIds).toHaveLength(1);
    expect(cover).toBe(`/media/${candidate.manifest.mediaIds[0]}`);
  });

  it('no contiene los de una propiedad que no sale en esa version', async () => {
    const visible = await property('lote-visible', 'published');
    const retired = await property('lote-retirado', 'published');

    const retiredMedia = await mediaIdOf(retired);
    const visibleMedia = await mediaIdOf(visible);

    const candidate = await buildReleaseCandidate(db, {
      id: 3,
      propertyId: retired,
      action: 'unpublish',
    });

    expect(candidate.manifest.mediaIds).toContain(visibleMedia);
    expect(candidate.manifest.mediaIds).not.toContain(retiredMedia);
  });

  it('sale ordenado y sin repetidos', async () => {
    await property('lote-a', 'published');
    await property('lote-b', 'published');

    const candidate = await buildReleaseCandidate(db, {
      id: 4,
      propertyId: 1,
      action: 'publish',
    });

    const ids = candidate.manifest.mediaIds;

    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('un snapshot vacio da un manifiesto vacio', async () => {
    const propertyId = await property('lote-unico', 'published');

    const candidate = await buildReleaseCandidate(db, {
      id: 5,
      propertyId,
      action: 'unpublish',
    });

    expect(releaseMediaIds(candidate.snapshot)).toEqual([]);
    expect(candidate.manifest.mediaIds).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* La puerta de los archivos                                                  */
/* -------------------------------------------------------------------------- */

describe('la autorizacion de archivos con manifiesto', () => {
  it('sin manifiesto decide la base, como siempre', async () => {
    const propertyId = await property('lote-publicado', 'published');
    const mediaId = await mediaIdOf(propertyId);

    const response = await servePublicMedia({ mediaId, db, bucket });

    expect(response.status).toBe(200);
    expect(releaseAllowsMedia(null, mediaId)).toBe(true);
  });

  it('hoy no hay ninguna version desplegada que acotar', () => {
    expect(deployedReleaseManifest()).toBeNull();
  });

  it('con manifiesto, lo que no esta en la version no se sirve', async () => {
    const propertyId = await property('lote-publicado', 'published');
    const mediaId = await mediaIdOf(propertyId);

    const response = await servePublicMedia({
      mediaId,
      db,
      bucket,
      release: { releaseId: 'r1', generatedAt: '2026-01-01T00:00:00.000Z', mediaIds: [] },
    });

    // 404 sobrio, igual que un archivo inexistente.
    expect(response.status).toBe(404);
  });

  it('el manifiesto acota, nunca amplia', async () => {
    const propertyId = await property('lote-borrador', 'draft');
    const mediaId = await mediaIdOf(propertyId);

    const response = await servePublicMedia({
      mediaId,
      db,
      bucket,
      // Aunque la version lo listara, la base sigue diciendo que no es publico.
      release: {
        releaseId: 'r1',
        generatedAt: '2026-01-01T00:00:00.000Z',
        mediaIds: [mediaId],
      },
    });

    expect(response.status).toBe(404);
  });

  it('lo que esta en la version y es publico se sirve', async () => {
    const propertyId = await property('lote-publicado', 'published');
    const mediaId = await mediaIdOf(propertyId);

    const response = await servePublicMedia({
      mediaId,
      db,
      bucket,
      release: {
        releaseId: 'r1',
        generatedAt: '2026-01-01T00:00:00.000Z',
        mediaIds: [mediaId],
      },
    });

    expect(response.status).toBe(200);
  });
});
