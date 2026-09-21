/**
 * Panoramas 360 de "Explora Costa Rica".
 *
 * Son media global del sitio (`site_settings`), no de ninguna propiedad. Se
 * prueba de punta a punta con SQLite real y el bucket en memoria: las reglas
 * de cada hueco, subir, reemplazar y retirar, y que el read model los entrega
 * en orden 1, 2, 3 sin huecos.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryBucket, type MemoryBucket } from '../admin/media/bucket';
import { changeSiteImage, COLUMN_BY_SLOT, readSiteMediaKey } from '../admin/settings/site-media';
import { applySeed, createTestDatabase } from '../admin/test-database';
import type { AdminBatchDatabase } from '../admin/types';
import {
  checkSiteUpload,
  EXPLORE_360_SLOTS,
  IDENTITY_SLOTS,
  SITE_MEDIA_RULES,
  SITE_MEDIA_SLOTS,
  type SiteMediaSlot,
} from '../domain/site-media';
import { buildPublicSnapshot } from './read-model';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const MB = 1024 * 1024;
/** Cabecera JPEG real, suficiente para el detector de contenido. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

function jpeg(): File {
  return new File([JPEG], 'panorama.jpg', { type: 'image/jpeg' });
}

let db: AdminBatchDatabase;
let bucket: MemoryBucket;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  applySeed(test.sqlite);
  bucket = createMemoryBucket();
});

async function panoramas(): Promise<string[]> {
  return (await buildPublicSnapshot(db)).site.media.explore360;
}

describe('los huecos de panorama', () => {
  it('son tres, aparte de la identidad visual', () => {
    expect(EXPLORE_360_SLOTS).toEqual(['explore360_1', 'explore360_2', 'explore360_3']);
    expect(IDENTITY_SLOTS).toEqual(['logo', 'favicon', 'social', 'hero']);
    expect(SITE_MEDIA_SLOTS).toEqual([...IDENTITY_SLOTS, ...EXPLORE_360_SLOTS]);
  });

  it('admiten JPEG, WebP y PNG de hasta 30 MB, no el limite de la portada', () => {
    for (const [index, slot] of EXPLORE_360_SLOTS.entries()) {
      const rule = SITE_MEDIA_RULES[slot];

      expect(rule.maxBytes).toBe(30 * MB);
      expect([...rule.mimeTypes].sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
      expect(rule.label).toBe(`Explora Costa Rica 360 · ${index + 1}`);
    }
    expect(SITE_MEDIA_RULES.hero.maxBytes).toBe(8 * MB);
  });

  it('un panorama de 12 MB entra; uno de 31 MB no', () => {
    const big = (size: number): Uint8Array => {
      const bytes = new Uint8Array(size);
      bytes.set(JPEG);
      return bytes;
    };
    const check = (size: number) =>
      checkSiteUpload({ slot: 'explore360_1', declaredMimeType: 'image/jpeg', bytes: big(size) });

    expect(check(12 * MB).problems).toEqual([]);
    expect(check(31 * MB).problems).toContain('too_large');
  });

  it('cada hueco tiene su columna', () => {
    expect(COLUMN_BY_SLOT.explore360_1).toBe('explore360_1ObjectKey');
    expect(COLUMN_BY_SLOT.explore360_2).toBe('explore360_2ObjectKey');
    expect(COLUMN_BY_SLOT.explore360_3).toBe('explore360_3ObjectKey');
  });

  it('la migracion solo anade columnas', () => {
    const sql = read('drizzle/0001_explore_360_site_media.sql');

    for (const n of [1, 2, 3]) {
      expect(sql).toContain(
        `ALTER TABLE \`site_settings\` ADD \`explore_360_${n}_object_key\` text;`,
      );
    }
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE|CREATE TABLE/i);
  });
});

describe('subir, reemplazar y retirar', () => {
  it('sin panoramas, la lista esta vacia', async () => {
    expect(await panoramas()).toEqual([]);
  });

  it('uno subido aparece con su URL publica, sin la clave de R2', async () => {
    const result = await changeSiteImage(db, bucket, 'explore360_2', jpeg());

    expect(result.ok).toBe(true);
    const list = await panoramas();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/^\/site-media\/explore360_2\?v=\d+$/);
    expect(list[0]).not.toContain('site/');
    expect(bucket.objects.size).toBe(1);
  });

  it('los tres salen en orden 1, 2, 3 aunque se suban desordenados', async () => {
    for (const slot of ['explore360_3', 'explore360_1', 'explore360_2'] as SiteMediaSlot[]) {
      await changeSiteImage(db, bucket, slot, jpeg());
    }

    expect((await panoramas()).map((url) => url.split('?')[0])).toEqual([
      '/site-media/explore360_1',
      '/site-media/explore360_2',
      '/site-media/explore360_3',
    ]);
  });

  it('retirar el central deja 1 y 3, sin hueco', async () => {
    for (const slot of EXPLORE_360_SLOTS) await changeSiteImage(db, bucket, slot, jpeg());
    await changeSiteImage(db, bucket, 'explore360_2', null);

    expect((await panoramas()).map((url) => url.split('?')[0])).toEqual([
      '/site-media/explore360_1',
      '/site-media/explore360_3',
    ]);
  });

  it('reemplazar cambia el archivo, no el hueco', async () => {
    await changeSiteImage(db, bucket, 'explore360_1', jpeg());
    const before = await readSiteMediaKey(db, 'explore360_1');
    await changeSiteImage(db, bucket, 'explore360_1', jpeg());
    const after = await readSiteMediaKey(db, 'explore360_1');

    expect(after).not.toBe(before);
    expect(after).toMatch(/^site\/explore360_1\//);
    expect((await panoramas()).map((url) => url.split('?')[0])).toEqual([
      '/site-media/explore360_1',
    ]);
  });

  it('no tocan la identidad visual', async () => {
    await changeSiteImage(db, bucket, 'hero', jpeg());
    await changeSiteImage(db, bucket, 'explore360_1', jpeg());
    await changeSiteImage(db, bucket, 'explore360_1', null);

    const media = (await buildPublicSnapshot(db)).site.media;
    expect(media.hero).toMatch(/^\/site-media\/hero\?v=/);
    expect(media.explore360).toEqual([]);
  });
});

describe('el visor sin WebGL', () => {
  it('devuelve null en vez de dejar el aviso en ingles de Photo Sphere Viewer', () => {
    const viewer = read('src/lib/viewer/panorama-viewer.ts');

    expect(viewer).toContain('if (!webglAvailable()) return null;');
    // El contexto de prueba no se queda ocupando uno de los pocos que hay.
    expect(viewer).toContain("getExtension('WEBGL_lose_context')?.loseContext()");
  });
});

describe('la subida por HTTP', () => {
  it('el limite de tamano es el del hueco, no uno fijo', () => {
    const handlers = read('src/lib/admin/http/core-handlers.ts');

    expect(handlers).toContain('SITE_MEDIA_RULES[slot].maxBytes');
    expect(handlers).not.toContain('> 9 * 1024 * 1024');
  });

  it('el panel ensena los panoramas aparte de la identidad visual', () => {
    const page = read('src/pages/admin/configuracion.astro');

    expect(page).toContain('Explora Costa Rica · panoramas 360');
    expect(page).toContain('Estos panoramas aparecen en la portada y no pertenecen a ningún lote.');
    expect(page).toContain('IDENTITY_SLOTS.map');
    expect(page).toContain('EXPLORE_360_SLOTS.map');
  });
});
