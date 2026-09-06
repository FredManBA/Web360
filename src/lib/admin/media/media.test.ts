/**
 * Tests de multimedia.
 *
 * Contra SQLite real con las migraciones del proyecto: los CHECK de coherencia
 * de la Fase 1C, los indices parciales de hero y portada y el `RESTRICT` del
 * recorrido 360 son los de produccion, no imitaciones.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  propertyMedia,
  propertyMediaGroupTranslations,
  propertyMediaTranslations,
  propertyTourNodes,
} from '../../../db/schema';
import { createPropertyDraft } from '../properties/create-property';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase, AdminResult } from '../types';
import { getPropertyMedia } from './get-media';
import { createMedia, deleteMedia, setMediaRoles, updateMedia } from './media';
import { createMediaGroup, deleteMediaGroup, updateMediaGroup } from './media-groups';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

async function newProperty(): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');
  return created.data.id;
}

async function newGroup(propertyId: number, nameEs?: string): Promise<number> {
  const created = await createMediaGroup(db, propertyId, nameEs === undefined ? {} : { nameEs });
  if (!created.ok) throw new Error('setup: grupo');
  return created.data.id;
}

/** Imagen de R2 con una clave unica, para no chocar con el UNIQUE global. */
let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `propiedades/archivo-${keyCounter}.jpg`;
}

async function newImage(propertyId: number, groupId: number | null = null): Promise<number> {
  const created = await createMedia(db, propertyId, {
    mediaKind: 'image',
    sourceProvider: 'r2',
    objectKey: nextKey(),
    groupId,
  });
  if (!created.ok) throw new Error('setup: imagen');
  return created.data.id;
}

function errorOf(result: AdminResult<unknown>): { code: string; message: string } {
  if (result.ok) throw new Error('se esperaba un error');
  return result.error;
}

async function view(propertyId: number) {
  const result = await getPropertyMedia(db, propertyId);
  if (!result.ok) throw new Error('lectura');
  return result.data;
}

/**
 * Ejecuta algo como si fuese otro instante.
 *
 * Solo se falsea `Date`: los temporizadores siguen siendo los reales, asi que
 * las promesas no se quedan colgadas. Hace falta porque los sellos se guardan
 * en segundos y dos escrituras seguidas caerian en el mismo.
 */
async function atTime<T>(millis: number, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(millis));

  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

async function translationUpdatedAt(mediaId: number): Promise<number> {
  const rows = await db
    .select({ updatedAt: propertyMediaTranslations.updatedAt })
    .from(propertyMediaTranslations)
    .where(eq(propertyMediaTranslations.propertyMediaId, mediaId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw new Error('sin traduccion');
  return row.updatedAt.getTime();
}

async function groupTranslationUpdatedAt(groupId: number): Promise<number> {
  const rows = await db
    .select({ updatedAt: propertyMediaGroupTranslations.updatedAt })
    .from(propertyMediaGroupTranslations)
    .where(eq(propertyMediaGroupTranslations.propertyMediaGroupId, groupId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw new Error('sin traduccion');
  return row.updatedAt.getTime();
}

/* -------------------------------------------------------------------------- */
/* Lectura                                                                    */
/* -------------------------------------------------------------------------- */

describe('lectura de multimedia', () => {
  it('(1) una propiedad inexistente no devuelve una lista vacia, sino un error', async () => {
    const result = await getPropertyMedia(db, 9999);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('not_found');
  });

  it('(2) una propiedad sin archivos devuelve la estructura vacia', async () => {
    const propertyId = await newProperty();

    expect(await view(propertyId)).toEqual({
      propertyId,
      groups: [],
      ungrouped: [],
      heroId: null,
      catalogCoverId: null,
    });
  });

  it('(22) ordena por sortOrder y desempata por id', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId);

    const first = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: nextKey(),
      groupId,
      sortOrder: 5,
    });
    const second = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: nextKey(),
      groupId,
      sortOrder: 1,
    });
    // Misma posicion que la anterior: manda el id mas bajo.
    const third = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: nextKey(),
      groupId,
      sortOrder: 1,
    });

    if (!first.ok || !second.ok || !third.ok) throw new Error('setup');

    const data = await view(propertyId);
    expect(data.groups[0]?.media.map((item) => item.id)).toEqual([
      second.data.id,
      third.data.id,
      first.data.id,
    ]);
  });

  it('(23) los archivos sin grupo salen aparte, no se pierden', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId);

    const grouped = await newImage(propertyId, groupId);
    const loose = await newImage(propertyId, null);

    const data = await view(propertyId);

    expect(data.groups[0]?.media.map((item) => item.id)).toEqual([grouped]);
    expect(data.ungrouped.map((item) => item.id)).toEqual([loose]);
  });
});

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

describe('grupos multimedia', () => {
  it('(3) se crea un grupo aunque todavia no tenga nombre', async () => {
    const propertyId = await newProperty();

    const created = await createMediaGroup(db, propertyId, {});

    expect(created.ok).toBe(true);
    expect((await view(propertyId)).groups).toHaveLength(1);
  });

  it('(4) guarda nombre en espanol y en ingles', async () => {
    const propertyId = await newProperty();

    await createMediaGroup(db, propertyId, { nameEs: 'Galería', nameEn: 'Gallery' });

    expect((await view(propertyId)).groups[0]?.names).toEqual({ es: 'Galería', en: 'Gallery' });
  });

  it('(4) un nombre vacio se guarda como null, no como cadena', async () => {
    const propertyId = await newProperty();

    await createMediaGroup(db, propertyId, { nameEs: '   ', nameEn: 'Gallery' });

    expect((await view(propertyId)).groups[0]?.names).toEqual({ es: null, en: 'Gallery' });
  });

  it('(5) sin sortOrder, el grupo nuevo va al final', async () => {
    const propertyId = await newProperty();

    await newGroup(propertyId, 'A');
    await newGroup(propertyId, 'B');
    const third = await createMediaGroup(db, propertyId, { nameEs: 'C' });

    if (!third.ok) throw new Error('setup');
    expect(third.data.sortOrder).toBe(2);
  });

  it('(6) se puede renombrar y recolocar', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Galería');

    const updated = await updateMediaGroup(db, propertyId, groupId, {
      nameEs: 'Fotos',
      nameEn: 'Photos',
      sortOrder: 3,
    });

    expect(updated.ok).toBe(true);
    const data = await view(propertyId);
    expect(data.groups[0]?.names).toEqual({ es: 'Fotos', en: 'Photos' });
    expect(data.groups[0]?.sortOrder).toBe(3);
  });

  it('(7) borrar el grupo NO borra sus archivos: quedan sin grupo', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Galería');

    const first = await newImage(propertyId, groupId);
    const second = await newImage(propertyId, groupId);

    const deleted = await deleteMediaGroup(db, propertyId, groupId);
    expect(deleted.ok).toBe(true);

    const data = await view(propertyId);
    expect(data.groups).toHaveLength(0);
    expect(data.ungrouped.map((item) => item.id)).toEqual([first, second]);
  });

  it('un grupo de otra propiedad no se puede tocar', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const other = await newGroup(second, 'Ajeno');

    const result = await updateMediaGroup(db, first, other, { nameEs: 'x' });

    expect(errorOf(result).code).toBe('media_group_property_mismatch');
  });

  it('un grupo inexistente se distingue de uno ajeno', async () => {
    const propertyId = await newProperty();

    const result = await deleteMediaGroup(db, propertyId, 9999);

    expect(errorOf(result).code).toBe('media_group_not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Crear archivos                                                             */
/* -------------------------------------------------------------------------- */

describe('registro de archivos', () => {
  const r2 = (mediaKind: 'image' | 'video' | 'document' | 'panorama') => ({
    mediaKind,
    sourceProvider: 'r2' as const,
    objectKey: nextKey(),
  });

  it('(8) registra una imagen de R2', async () => {
    const propertyId = await newProperty();
    const created = await createMedia(db, propertyId, r2('image'));

    expect(created.ok).toBe(true);
    if (created.ok) expect(created.data.mediaKind).toBe('image');
  });

  it('(9) registra un video de R2', async () => {
    const propertyId = await newProperty();
    expect((await createMedia(db, propertyId, r2('video'))).ok).toBe(true);
  });

  it('(10) registra un documento de R2', async () => {
    const propertyId = await newProperty();
    expect((await createMedia(db, propertyId, r2('document'))).ok).toBe(true);
  });

  it('(11) registra un panorama de R2', async () => {
    const propertyId = await newProperty();
    expect((await createMedia(db, propertyId, r2('panorama'))).ok).toBe(true);
  });

  it('(12) registra un video de YouTube con solo su identificador', async () => {
    const propertyId = await newProperty();

    const created = await createMedia(db, propertyId, {
      mediaKind: 'video',
      sourceProvider: 'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });

    expect(created.ok).toBe(true);

    const data = await view(propertyId);
    expect(data.ungrouped[0]?.youtubeVideoId).toBe('dQw4w9WgXcQ');
    expect(data.ungrouped[0]?.objectKey).toBeNull();
  });

  it('(13) no existe una imagen de YouTube', async () => {
    const propertyId = await newProperty();

    const result = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });

    expect(errorOf(result).code).toBe('media_invalid_provider');
  });

  it('(14) no existe un documento de YouTube', async () => {
    const propertyId = await newProperty();

    const result = await createMedia(db, propertyId, {
      mediaKind: 'document',
      sourceProvider: 'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });

    expect(errorOf(result).code).toBe('media_invalid_provider');
  });

  it('(15) no existe un panorama de YouTube', async () => {
    const propertyId = await newProperty();

    const result = await createMedia(db, propertyId, {
      mediaKind: 'panorama',
      sourceProvider: 'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });

    expect(errorOf(result).code).toBe('media_invalid_provider');
  });

  it('un identificador de YouTube con forma incorrecta se rechaza', async () => {
    const propertyId = await newProperty();

    const result = await createMedia(db, propertyId, {
      mediaKind: 'video',
      sourceProvider: 'youtube',
      youtubeVideoId: 'https://youtu.be/dQw4w9WgXcQ',
    });

    expect(errorOf(result).code).toBe('media_invalid_provider');
  });

  it('un archivo de R2 sin clave se rechaza antes de llegar al CHECK', async () => {
    const propertyId = await newProperty();

    const result = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
    });

    expect(errorOf(result).code).toBe('media_invalid_provider');
    expect(errorOf(result).message).toContain('clave del objeto');
  });

  it('dos archivos no pueden compartir la clave de R2', async () => {
    const propertyId = await newProperty();
    const objectKey = nextKey();

    await createMedia(db, propertyId, { mediaKind: 'image', sourceProvider: 'r2', objectKey });
    const second = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey,
    });

    expect(errorOf(second).code).toBe('media_object_key_taken');
  });

  it('(16) se puede registrar directamente dentro de un grupo', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Galería');

    const created = await createMedia(db, propertyId, { ...r2('image'), groupId });

    expect(created.ok).toBe(true);
    if (created.ok) expect(created.data.groupId).toBe(groupId);
  });

  it('(17) no se puede usar el grupo de otra propiedad', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const other = await newGroup(second, 'Ajeno');

    const result = await createMedia(db, first, { ...r2('image'), groupId: other });

    expect(errorOf(result).code).toBe('media_group_property_mismatch');
  });

  it('la posicion por defecto es la siguiente dentro de su grupo', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId);

    await newImage(propertyId, groupId);
    const second = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: nextKey(),
      groupId,
    });

    // El conjunto sin grupo lleva su propia cuenta.
    const loose = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: nextKey(),
    });

    if (!second.ok || !loose.ok) throw new Error('setup');
    expect(second.data.sortOrder).toBe(1);
    expect(loose.data.sortOrder).toBe(0);
  });

  it('una propiedad inexistente no admite archivos', async () => {
    const result = await createMedia(db, 9999, r2('image'));

    expect(errorOf(result).code).toBe('not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Actualizar                                                                 */
/* -------------------------------------------------------------------------- */

describe('actualizacion de archivos', () => {
  it('(18) se mueve entre grupos de la misma propiedad', async () => {
    const propertyId = await newProperty();
    const first = await newGroup(propertyId, 'A');
    const second = await newGroup(propertyId, 'B');
    const mediaId = await newImage(propertyId, first);

    const moved = await updateMedia(db, propertyId, mediaId, { groupId: second });

    expect(moved.ok).toBe(true);
    const data = await view(propertyId);
    expect(data.groups.find((group) => group.id === second)?.media.map((m) => m.id)).toEqual([
      mediaId,
    ]);
    expect(data.groups.find((group) => group.id === first)?.media).toHaveLength(0);
  });

  it('(19) no se puede mover al grupo de otra propiedad', async () => {
    const propertyId = await newProperty();
    const other = await newGroup(await newProperty(), 'Ajeno');
    const mediaId = await newImage(propertyId, null);

    const result = await updateMedia(db, propertyId, mediaId, { groupId: other });

    expect(errorOf(result).code).toBe('media_group_property_mismatch');
    expect((await view(propertyId)).ungrouped.map((item) => item.id)).toEqual([mediaId]);
  });

  it('(20) se puede sacar de su grupo y dejarlo suelto', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Galería');
    const mediaId = await newImage(propertyId, groupId);

    const moved = await updateMedia(db, propertyId, mediaId, { groupId: null });

    expect(moved.ok).toBe(true);
    expect((await view(propertyId)).ungrouped.map((item) => item.id)).toEqual([mediaId]);
  });

  it('(21) guarda titulo, texto alternativo y pie en los dos idiomas', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    await updateMedia(db, propertyId, mediaId, {
      titleEs: 'Fachada',
      altTextEs: 'Fachada de la casa',
      captionEs: 'Vista desde la calle',
      titleEn: 'Facade',
      altTextEn: 'House facade',
      captionEn: 'Street view',
    });

    const data = await view(propertyId);
    expect(data.ungrouped[0]?.translations).toEqual({
      es: { title: 'Fachada', altText: 'Fachada de la casa', caption: 'Vista desde la calle' },
      en: { title: 'Facade', altText: 'House facade', caption: 'Street view' },
    });
  });

  it('(21) el ingles es opcional y puede llegar despues', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    await updateMedia(db, propertyId, mediaId, { titleEs: 'Fachada' });
    await updateMedia(db, propertyId, mediaId, { titleEn: 'Facade' });

    const data = await view(propertyId);
    expect(data.ungrouped[0]?.translations.es?.title).toBe('Fachada');
    expect(data.ungrouped[0]?.translations.en?.title).toBe('Facade');
  });

  it('actualiza los metadatos tecnicos que ya existen en el modelo', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    await updateMedia(db, propertyId, mediaId, {
      mimeType: 'image/webp',
      fileSizeBytes: 240_512,
      width: 1920,
      height: 1080,
    });

    const media = (await view(propertyId)).ungrouped[0];
    expect(media?.mimeType).toBe('image/webp');
    expect(media?.width).toBe(1920);
    expect(media?.height).toBe(1080);
    expect(media?.fileSizeBytes).toBe(240_512);
  });

  it('un archivo de otra propiedad no se puede editar', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const mediaId = await newImage(second);

    const result = await updateMedia(db, first, mediaId, { titleEs: 'x' });

    expect(errorOf(result).code).toBe('media_not_found');
  });

  it('cambiar la clave a una ya usada se rechaza', async () => {
    const propertyId = await newProperty();
    const taken = nextKey();

    await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: taken,
    });
    const mediaId = await newImage(propertyId);

    const result = await updateMedia(db, propertyId, mediaId, { objectKey: taken });

    expect(errorOf(result).code).toBe('media_object_key_taken');
  });

  it('vaciar la clave de un archivo de R2 se rechaza, no se guarda incoherente', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    const result = await updateMedia(db, propertyId, mediaId, { objectKey: null });

    expect(errorOf(result).code).toBe('media_invalid_provider');
  });

  it('(32) `updatedAt` del archivo avanza al editarlo', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    const before = (await view(propertyId)).ungrouped[0]?.updatedAt;
    if (before === undefined) throw new Error('setup');

    await atTime(before.getTime() + 60_000, () =>
      updateMedia(db, propertyId, mediaId, { mimeType: 'image/webp' }),
    );

    const after = (await view(propertyId)).ungrouped[0]?.updatedAt;
    expect(after?.getTime()).toBeGreaterThan(before.getTime());
  });

  it('(32) `updatedAt` de la traduccion del archivo avanza al reescribirla', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    await updateMedia(db, propertyId, mediaId, { titleEs: 'Fachada' });
    const before = await translationUpdatedAt(mediaId);

    await atTime(before + 60_000, () =>
      updateMedia(db, propertyId, mediaId, { titleEs: 'Fachada principal' }),
    );

    expect(await translationUpdatedAt(mediaId)).toBeGreaterThan(before);
  });

  it('editar solo los textos no toca el `updatedAt` del archivo', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    const before = (await view(propertyId)).ungrouped[0]?.updatedAt;
    if (before === undefined) throw new Error('setup');

    await atTime(before.getTime() + 60_000, () =>
      updateMedia(db, propertyId, mediaId, { titleEs: 'Fachada' }),
    );

    // Cada fila lleva su propio sello: la traduccion es una fila aparte.
    const after = (await view(propertyId)).ungrouped[0]?.updatedAt;
    expect(after?.getTime()).toBe(before.getTime());
  });

  it('(32) `updatedAt` del grupo tambien avanza', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Galería');

    const before = (await view(propertyId)).groups[0]?.updatedAt;
    if (before === undefined) throw new Error('setup');

    await atTime(before.getTime() + 60_000, () =>
      updateMediaGroup(db, propertyId, groupId, { sortOrder: 4 }),
    );

    const after = (await view(propertyId)).groups[0]?.updatedAt;
    expect(after?.getTime()).toBeGreaterThan(before.getTime());
  });

  it('(32) `updatedAt` de la traduccion del grupo avanza al reescribirla', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Galería');

    const before = await groupTranslationUpdatedAt(groupId);

    await atTime(before + 60_000, () =>
      updateMediaGroup(db, propertyId, groupId, { nameEs: 'Fotos' }),
    );

    expect(await groupTranslationUpdatedAt(groupId)).toBeGreaterThan(before);
  });
});

/* -------------------------------------------------------------------------- */
/* Hero y portada                                                             */
/* -------------------------------------------------------------------------- */

describe('hero y portada de catalogo', () => {
  it('(24) se marca una imagen como hero', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    const result = await setMediaRoles(db, propertyId, mediaId, { isHero: true });

    expect(result.ok).toBe(true);
    expect((await view(propertyId)).heroId).toBe(mediaId);
  });

  it('(24) un video tambien puede encabezar la ficha', async () => {
    const propertyId = await newProperty();
    const created = await createMedia(db, propertyId, {
      mediaKind: 'video',
      sourceProvider: 'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });
    if (!created.ok) throw new Error('setup');

    expect((await setMediaRoles(db, propertyId, created.data.id, { isHero: true })).ok).toBe(true);
  });

  it('(25) marcar otro hero desmarca el anterior en una sola operacion', async () => {
    const propertyId = await newProperty();
    const first = await newImage(propertyId);
    const second = await newImage(propertyId);

    await setMediaRoles(db, propertyId, first, { isHero: true });
    const swap = await setMediaRoles(db, propertyId, second, { isHero: true });

    expect(swap.ok).toBe(true);

    const data = await view(propertyId);
    expect(data.heroId).toBe(second);

    // Y de verdad queda uno solo, no dos.
    const heroes = [...data.groups.flatMap((group) => group.media), ...data.ungrouped].filter(
      (item) => item.isHero,
    );
    expect(heroes).toHaveLength(1);
  });

  it('(25) el intercambio va en un solo lote', async () => {
    const propertyId = await newProperty();
    const first = await newImage(propertyId);
    const second = await newImage(propertyId);

    await setMediaRoles(db, propertyId, first, { isHero: true });

    const batch = vi.spyOn(db, 'batch');
    await setMediaRoles(db, propertyId, second, { isHero: true });

    expect(batch).toHaveBeenCalledTimes(1);
    // Retirar el anterior y marcar el nuevo.
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
    batch.mockRestore();
  });

  it('(26) se marca la portada de catalogo', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    await setMediaRoles(db, propertyId, mediaId, { isCatalogCover: true });

    expect((await view(propertyId)).catalogCoverId).toBe(mediaId);
  });

  it('(27) cambiar la portada desmarca la anterior', async () => {
    const propertyId = await newProperty();
    const first = await newImage(propertyId);
    const second = await newImage(propertyId);

    await setMediaRoles(db, propertyId, first, { isCatalogCover: true });
    await setMediaRoles(db, propertyId, second, { isCatalogCover: true });

    const data = await view(propertyId);
    expect(data.catalogCoverId).toBe(second);

    const covers = [...data.groups.flatMap((group) => group.media), ...data.ungrouped].filter(
      (item) => item.isCatalogCover,
    );
    expect(covers).toHaveLength(1);
  });

  it('(28) un video no puede ser portada de catalogo', async () => {
    const propertyId = await newProperty();
    const created = await createMedia(db, propertyId, {
      mediaKind: 'video',
      sourceProvider: 'r2',
      objectKey: nextKey(),
    });
    if (!created.ok) throw new Error('setup');

    const result = await setMediaRoles(db, propertyId, created.data.id, { isCatalogCover: true });

    expect(errorOf(result).code).toBe('media_role_conflict');
    expect((await view(propertyId)).catalogCoverId).toBeNull();
  });

  it('(28) un documento no puede ser portada ni hero', async () => {
    const propertyId = await newProperty();
    const created = await createMedia(db, propertyId, {
      mediaKind: 'document',
      sourceProvider: 'r2',
      objectKey: nextKey(),
    });
    if (!created.ok) throw new Error('setup');

    expect(
      errorOf(await setMediaRoles(db, propertyId, created.data.id, { isCatalogCover: true })).code,
    ).toBe('media_role_conflict');
    expect(
      errorOf(await setMediaRoles(db, propertyId, created.data.id, { isHero: true })).code,
    ).toBe('media_role_conflict');
  });

  it('(28) un panorama tampoco', async () => {
    const propertyId = await newProperty();
    const created = await createMedia(db, propertyId, {
      mediaKind: 'panorama',
      sourceProvider: 'r2',
      objectKey: nextKey(),
    });
    if (!created.ok) throw new Error('setup');

    expect(
      errorOf(await setMediaRoles(db, propertyId, created.data.id, { isHero: true })).code,
    ).toBe('media_role_conflict');
  });

  it('la misma imagen puede ser hero y portada a la vez', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    const result = await setMediaRoles(db, propertyId, mediaId, {
      isHero: true,
      isCatalogCover: true,
    });

    expect(result.ok).toBe(true);
    const data = await view(propertyId);
    expect(data.heroId).toBe(mediaId);
    expect(data.catalogCoverId).toBe(mediaId);
  });

  it('un rol se puede retirar sin dárselo a nadie', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    await setMediaRoles(db, propertyId, mediaId, { isHero: true });
    await setMediaRoles(db, propertyId, mediaId, { isHero: false });

    expect((await view(propertyId)).heroId).toBeNull();
  });

  it('los roles llegan tambien por el PATCH normal, con el mismo intercambio', async () => {
    const propertyId = await newProperty();
    const first = await newImage(propertyId);
    const second = await newImage(propertyId);

    await updateMedia(db, propertyId, first, { isHero: true });
    await updateMedia(db, propertyId, second, { isHero: true, titleEs: 'Fachada' });

    const data = await view(propertyId);
    expect(data.heroId).toBe(second);
    expect(data.ungrouped.find((item) => item.id === second)?.translations.es?.title).toBe(
      'Fachada',
    );
  });

  it('un archivo inexistente no puede recibir roles', async () => {
    const propertyId = await newProperty();

    expect(errorOf(await setMediaRoles(db, propertyId, 9999, { isHero: true })).code).toBe(
      'media_not_found',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Eliminar                                                                   */
/* -------------------------------------------------------------------------- */

describe('eliminacion de archivos', () => {
  it('(29) elimina el registro de un archivo normal', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    const deleted = await deleteMedia(db, propertyId, mediaId);

    expect(deleted.ok).toBe(true);
    expect((await view(propertyId)).ungrouped).toHaveLength(0);
  });

  it('(30) sus traducciones caen con el, por CASCADE', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    await updateMedia(db, propertyId, mediaId, { titleEs: 'Fachada', titleEn: 'Facade' });

    const before = await db
      .select({ id: propertyMediaTranslations.id })
      .from(propertyMediaTranslations)
      .where(eq(propertyMediaTranslations.propertyMediaId, mediaId));
    expect(before).toHaveLength(2);

    await deleteMedia(db, propertyId, mediaId);

    const after = await db
      .select({ id: propertyMediaTranslations.id })
      .from(propertyMediaTranslations)
      .where(eq(propertyMediaTranslations.propertyMediaId, mediaId));
    expect(after).toHaveLength(0);
  });

  it('(31) un panorama usado por el recorrido 360 no se borra', async () => {
    const propertyId = await newProperty();

    const panorama = await createMedia(db, propertyId, {
      mediaKind: 'panorama',
      sourceProvider: 'r2',
      objectKey: nextKey(),
    });
    if (!panorama.ok) throw new Error('setup');

    await db
      .insert(propertyTourNodes)
      .values({ propertyId, propertyMediaId: panorama.data.id, isStart: true });

    const result = await deleteMedia(db, propertyId, panorama.data.id);

    expect(errorOf(result).code).toBe('media_in_use');

    // La referencia NO se rompe: el panorama sigue ahi y el nodo tambien.
    const media = await db
      .select({ id: propertyMedia.id })
      .from(propertyMedia)
      .where(eq(propertyMedia.id, panorama.data.id));
    expect(media).toHaveLength(1);

    const nodes = await db.select({ id: propertyTourNodes.id }).from(propertyTourNodes);
    expect(nodes).toHaveLength(1);
  });

  it('(31) el RESTRICT del esquema es real, no solo la comprobacion previa', async () => {
    const propertyId = await newProperty();

    const panorama = await createMedia(db, propertyId, {
      mediaKind: 'panorama',
      sourceProvider: 'r2',
      objectKey: nextKey(),
    });
    if (!panorama.ok) throw new Error('setup');

    await db
      .insert(propertyTourNodes)
      .values({ propertyId, propertyMediaId: panorama.data.id, isStart: true });

    // Saltandose la capa de aplicacion, la base sigue negandose.
    await expect(
      db.delete(propertyMedia).where(eq(propertyMedia.id, panorama.data.id)),
    ).rejects.toThrow();
  });

  it('un archivo de otra propiedad no se puede borrar', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const mediaId = await newImage(second);

    expect(errorOf(await deleteMedia(db, first, mediaId)).code).toBe('media_not_found');
    expect((await view(second)).ungrouped).toHaveLength(1);
  });

  it('borrar el hero deja la propiedad sin hero, no rota', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    await setMediaRoles(db, propertyId, mediaId, { isHero: true });
    await deleteMedia(db, propertyId, mediaId);

    expect((await view(propertyId)).heroId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Mensajes                                                                   */
/* -------------------------------------------------------------------------- */

describe('mensajes de error', () => {
  it('no mencionan SQL, tablas ni stack traces', async () => {
    const propertyId = await newProperty();

    const results = [
      await createMedia(db, propertyId, { mediaKind: 'panorama', sourceProvider: 'youtube' }),
      await deleteMedia(db, propertyId, 9999),
      await setMediaRoles(db, propertyId, 9999, { isHero: true }),
    ];

    for (const result of results) {
      const { message } = errorOf(result);
      expect(message).not.toMatch(/SQL|SQLITE|property_media|CHECK|node:sqlite/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});
