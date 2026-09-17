/**
 * Publicacion del sitio entero.
 *
 * Un cambio global —la marca, un texto, el hero— se guarda en la base pero no
 * llega al sitio, porque el HTML es estatico y se construyo antes. Hasta
 * ahora la unica forma de forzar una reconstruccion era publicar o retirar una
 * propiedad, asi que se acababa usando una de prueba como excusa.
 *
 * `publish_site` es esa reconstruccion sin excusa: no habla de ninguna
 * propiedad y no mueve el estado editorial de nada.
 *
 * Aqui se prueban las dos garantias que sostienen el resto: que la base impide
 * dos operaciones vivas a la vez, y que el candidato global mira el sitio tal
 * como esta, sin simular ningun cambio.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties, propertyMedia, publicationRequests } from '../../db/schema';
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
import { catalogueOf } from '../public/read-model';
import { loadCandidateRequest } from './candidate';
import { buildReleaseCandidate, releaseAllowsMedia, releaseIdFor } from './release';

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

  await upsertPropertyTranslation(db, propertyId, { locale: 'es', slug, title: `Lote ${slug}` });

  const media = await uploadMedia(db, bucket, propertyId, {
    mediaKind: 'image',
    fileName: `${slug}.jpg`,
    declaredMimeType: 'image/jpeg',
    bytes: toArrayBuffer(SAMPLE_JPEG),
  });
  if (!media.ok) throw new Error('setup: archivo');

  await setMediaRoles(db, propertyId, media.data.id, { isHero: true, isCatalogCover: true });
  await db
    .update(properties)
    .set({ publicationStatus: status })
    .where(eq(properties.id, propertyId));

  return propertyId;
}

/** Inserta una peticion a pelo: aqui se prueba la BASE, no el camino del admin. */
async function insertRequest(row: {
  propertyId: number | null;
  action: 'publish' | 'unpublish' | 'publish_site';
  status?: 'pending' | 'building' | 'done' | 'failed' | 'abandoned';
  hash: string;
}): Promise<number> {
  const inserted = await db
    .insert(publicationRequests)
    .values({
      propertyId: row.propertyId,
      action: row.action,
      status: row.status ?? 'pending',
      callbackTokenHash: row.hash,
    })
    .returning({ id: publicationRequests.id });

  const id = inserted[0]?.id;
  if (id === undefined) throw new Error('setup: peticion');
  return id;
}

/**
 * El motivo REAL del fallo.
 *
 * Drizzle envuelve el error del driver en uno suyo —"Failed query: insert
 * into..."— y el texto de la constraint queda en `cause`. Sin desenvolverlo,
 * un test podria dar por bueno cualquier fallo de insercion.
 */
async function fails(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    const causa = error instanceof Error ? error.cause : undefined;
    const texto = causa instanceof Error ? causa.message : '';
    return `${error instanceof Error ? error.message : String(error)} ${texto}`;
  }
  return '(no fallo)';
}

/* -------------------------------------------------------------------------- */
/* El candado global                                                          */
/* -------------------------------------------------------------------------- */

describe('como mucho una operacion viva en todo el sistema', () => {
  it('dos propiedades distintas tampoco pueden a la vez', async () => {
    const uno = await property('lote-uno', 'approved');
    const dos = await property('lote-dos', 'approved');

    await insertRequest({ propertyId: uno, action: 'publish', hash: 'h1' });

    const motivo = await fails(() =>
      insertRequest({ propertyId: dos, action: 'publish', hash: 'h2' }),
    );
    expect(motivo).toContain('UNIQUE');
  });

  it('una propiedad y el sitio tampoco', async () => {
    const uno = await property('lote-uno', 'approved');

    await insertRequest({ propertyId: uno, action: 'publish', hash: 'h1' });

    const motivo = await fails(() =>
      insertRequest({ propertyId: null, action: 'publish_site', hash: 'h2' }),
    );
    expect(motivo).toContain('UNIQUE');
  });

  it('dos del sitio, menos aun', async () => {
    await insertRequest({ propertyId: null, action: 'publish_site', hash: 'h1' });

    const motivo = await fails(() =>
      insertRequest({ propertyId: null, action: 'publish_site', hash: 'h2' }),
    );
    expect(motivo).toContain('UNIQUE');
  });

  it('`building` cuenta como viva igual que `pending`', async () => {
    await insertRequest({
      propertyId: null,
      action: 'publish_site',
      status: 'building',
      hash: 'h1',
    });

    const motivo = await fails(() =>
      insertRequest({ propertyId: null, action: 'publish_site', hash: 'h2' }),
    );
    expect(motivo).toContain('UNIQUE');
  });

  it('las terminadas no bloquean nada, por muchas que sean', async () => {
    const uno = await property('lote-uno', 'approved');

    for (const [i, status] of (['done', 'failed', 'abandoned'] as const).entries()) {
      await insertRequest({ propertyId: uno, action: 'publish', status, hash: `terminal-${i}` });
    }

    // Y despues de todas ellas, una viva entra sin problema.
    const viva = await insertRequest({ propertyId: null, action: 'publish_site', hash: 'viva' });
    expect(viva).toBeGreaterThan(0);
  });

  it('cerrar la viva libera el sistema en el acto', async () => {
    const id = await insertRequest({ propertyId: null, action: 'publish_site', hash: 'h1' });

    await db
      .update(publicationRequests)
      .set({ status: 'done' })
      .where(eq(publicationRequests.id, id));

    const siguiente = await insertRequest({
      propertyId: null,
      action: 'publish_site',
      hash: 'h2',
    });
    expect(siguiente).toBeGreaterThan(id);
  });
});

/* -------------------------------------------------------------------------- */
/* El alcance                                                                 */
/* -------------------------------------------------------------------------- */

describe('cada accion con su alcance', () => {
  it('una operacion de propiedad no puede quedarse sin propiedad', async () => {
    const motivo = await fails(() =>
      insertRequest({ propertyId: null, action: 'publish', hash: 'h1' }),
    );
    expect(motivo).toContain('CHECK');
  });

  it('una operacion de sitio no puede nombrar una', async () => {
    const uno = await property('lote-uno', 'approved');

    const motivo = await fails(() =>
      insertRequest({ propertyId: uno, action: 'publish_site', hash: 'h1' }),
    );
    expect(motivo).toContain('CHECK');
  });
});

/* -------------------------------------------------------------------------- */
/* La version que produce                                                     */
/* -------------------------------------------------------------------------- */

describe('la release del sitio', () => {
  it('se identifica sin nombrar propiedad', () => {
    expect(releaseIdFor({ id: 12, action: 'publish_site', propertyId: null })).toBe('site-r12');
    // Y las de propiedad siguen igual que siempre.
    expect(releaseIdFor({ id: 11, action: 'publish', propertyId: 3 })).toBe('publish-p3-r11');
  });

  it('se puede cargar aunque no haya propiedad con la que juntarse', async () => {
    const id = await insertRequest({ propertyId: null, action: 'publish_site', hash: 'h1' });

    const cargada = await loadCandidateRequest(db, id);

    expect(cargada.ok).toBe(true);
    if (cargada.ok) {
      expect(cargada.data.action).toBe('publish_site');
      expect(cargada.data.propertyId).toBeNull();
    }
  });

  it('mira el sitio tal como esta: publica lo publicado y nada mas', async () => {
    const publicada = await property('lote-publicada', 'published');
    const aprobada = await property('lote-aprobada', 'approved');

    const id = await insertRequest({ propertyId: null, action: 'publish_site', hash: 'h1' });
    const candidato = await buildReleaseCandidate(db, {
      id,
      action: 'publish_site',
      propertyId: null,
    });

    const slugs = catalogueOf(candidato.snapshot, 'es').map((p) => p.slug);
    expect(slugs).toContain('lote-publicada');
    expect(slugs).not.toContain('lote-aprobada');

    // Y no ha tocado el estado de ninguna.
    const estados = await db
      .select({ id: properties.id, status: properties.publicationStatus })
      .from(properties);
    expect(estados.find((p) => p.id === publicada)?.status).toBe('published');
    expect(estados.find((p) => p.id === aprobada)?.status).toBe('approved');
  });
});

/* -------------------------------------------------------------------------- */
/* Los archivos                                                               */
/* -------------------------------------------------------------------------- */

describe('el manifiesto de una publicacion del sitio', () => {
  it('lleva la media de las publicadas y NINGUNA de las que no lo estan', async () => {
    const publicada = await property('lote-publicada', 'published');
    const aprobada = await property('lote-aprobada', 'approved');

    /* Los archivos que tiene cada una, segun la base. */
    const archivos = await db
      .select({ id: propertyMedia.id, propertyId: propertyMedia.propertyId })
      .from(propertyMedia);

    const dePublicada = archivos.filter((m) => m.propertyId === publicada).map((m) => m.id);
    const deAprobada = archivos.filter((m) => m.propertyId === aprobada).map((m) => m.id);

    expect(dePublicada.length).toBeGreaterThan(0);
    expect(deAprobada.length).toBeGreaterThan(0);

    const id = await insertRequest({ propertyId: null, action: 'publish_site', hash: 'h1' });
    const { manifest } = await buildReleaseCandidate(db, {
      id,
      action: 'publish_site',
      propertyId: null,
    });

    expect(manifest.requestId).toBe(id);
    expect(manifest.releaseId).toBe(`site-r${id}`);

    // Todos los de la publicada entran.
    for (const mediaId of dePublicada) {
      expect(manifest.mediaIds, `falta el archivo ${mediaId}`).toContain(mediaId);
    }

    /*
     * Y ninguno de la que no esta publicada. Es lo que impide que republicar
     * el sitio abra por la puerta de atras los archivos de una ficha que
     * todavia no esta en linea.
     */
    for (const mediaId of deAprobada) {
      expect(manifest.mediaIds, `se colo el archivo ${mediaId}`).not.toContain(mediaId);
      expect(releaseAllowsMedia(manifest, mediaId)).toBe(false);
    }
  });

  it('no deja fuera los archivos de las fichas que siguen en linea', async () => {
    await property('lote-publicada', 'published');

    const id = await insertRequest({ propertyId: null, action: 'publish_site', hash: 'h1' });
    const { manifest, snapshot } = await buildReleaseCandidate(db, {
      id,
      action: 'publish_site',
      propertyId: null,
    });

    /*
     * `/media/*` se autoriza contra el manifiesto. Si una publicacion global
     * dejara fuera la media de las fichas publicadas, sus fotos dejarian de
     * servirse en cuanto se desplegara.
     */
    const ficha = catalogueOf(snapshot, 'es')[0];
    expect(ficha).toBeDefined();

    for (const mediaId of manifest.mediaIds) {
      expect(releaseAllowsMedia(manifest, mediaId)).toBe(true);
    }
    expect(manifest.mediaIds.length).toBeGreaterThan(0);
  });
});
