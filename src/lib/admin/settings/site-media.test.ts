/**
 * Tests de la media global del sitio.
 *
 * Contra SQLite real y un bucket en memoria. Lo que mas se prueba es lo que
 * puede salir mal sin que nadie se entere:
 *
 * - que una clave de R2 acabe donde no debe;
 * - que un reemplazo deje la web enlazando a un objeto que ya no existe;
 * - que un hueco acepte algo que no es una imagen.
 */

import type { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { siteSettings } from '../../../db/schema';
import { SITE_MEDIA_RULES, SITE_MEDIA_SLOTS, checkSiteUpload } from '../../domain/site-media';
import { buildPublicSnapshot } from '../../public/read-model';
import { serveSiteMedia } from '../../public/site-media-delivery';
import { createMemoryBucket, type MemoryBucket } from '../media/bucket';
import {
  SAMPLE_GIF,
  SAMPLE_JPEG,
  SAMPLE_PDF,
  SAMPLE_PNG,
  SAMPLE_TEXT,
  toArrayBuffer,
} from '../media/test-files';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import {
  deleteSiteMedia,
  getSiteMedia,
  readSiteMediaKey,
  siteMediaUrl,
  uploadSiteMedia,
} from './site-media';

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

async function subir(
  slot: 'logo' | 'favicon' | 'social' | 'hero',
  bytes = SAMPLE_PNG,
  mime = 'image/png',
): ReturnType<typeof uploadSiteMedia> {
  return uploadSiteMedia(db, bucket, slot, {
    fileName: 'imagen.png',
    declaredMimeType: mime,
    bytes: toArrayBuffer(bytes),
  });
}

/* -------------------------------------------------------------------------- */
/* Reglas por hueco                                                           */
/* -------------------------------------------------------------------------- */

describe('lo que admite cada hueco', () => {
  it('son cuatro, y ni uno mas', () => {
    expect([...SITE_MEDIA_SLOTS]).toEqual(['logo', 'favicon', 'social', 'hero']);
  });

  it('todos aceptan imagen web, y ninguno acepta otra cosa', () => {
    for (const slot of SITE_MEDIA_SLOTS) {
      const tipos = SITE_MEDIA_RULES[slot].mimeTypes;

      expect(tipos).toContain('image/png');
      expect(tipos).not.toContain('image/svg+xml');
      expect(tipos).not.toContain('application/pdf');
      expect(tipos.some((tipo) => tipo.startsWith('video/'))).toBe(false);
    }
  });

  it('el favicon tiene el limite mas estrecho, y la portada el mas ancho', () => {
    expect(SITE_MEDIA_RULES.favicon.maxBytes).toBeLessThan(SITE_MEDIA_RULES.logo.maxBytes);
    expect(SITE_MEDIA_RULES.hero.maxBytes).toBeGreaterThan(SITE_MEDIA_RULES.social.maxBytes);
  });

  it('decide por el contenido, no por lo que diga el navegador', () => {
    const mentira = checkSiteUpload({
      slot: 'logo',
      declaredMimeType: 'image/png',
      bytes: SAMPLE_PDF,
    });

    expect(mentira.problems).toContain('content_mismatch');
  });

  it('un formato que no se sabe comprobar se rechaza', () => {
    for (const bytes of [SAMPLE_GIF, SAMPLE_TEXT]) {
      const check = checkSiteUpload({ slot: 'logo', declaredMimeType: 'image/png', bytes });

      expect(check.problems.length).toBeGreaterThan(0);
    }
  });

  it('un archivo vacio tampoco pasa', () => {
    const check = checkSiteUpload({
      slot: 'hero',
      declaredMimeType: 'image/jpeg',
      bytes: new Uint8Array(0),
    });

    expect(check.problems).toContain('empty_file');
  });
});

/* -------------------------------------------------------------------------- */
/* Subir                                                                      */
/* -------------------------------------------------------------------------- */

describe('poner una imagen', () => {
  it('guarda el objeto y apunta la clave', async () => {
    const result = await subir('logo');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.logo.present).toBe(true);

    const key = await readSiteMediaKey(db, 'logo');
    expect(key).not.toBeNull();
    expect(bucket.objects.has(key ?? '')).toBe(true);
  });

  it('la clave la genera el servidor, y va bajo `sitio/`', async () => {
    await subir('hero', SAMPLE_JPEG, 'image/jpeg');

    const key = (await readSiteMediaKey(db, 'hero')) ?? '';

    expect(key).toMatch(/^sitio\/hero\/[0-9a-f-]{36}\.jpg$/);
    // Nunca bajo el espacio de las propiedades.
    expect(key).not.toContain('propiedades/');
  });

  it('rechaza lo que no es una imagen admitida', async () => {
    const result = await uploadSiteMedia(db, bucket, 'logo', {
      fileName: 'documento.pdf',
      declaredMimeType: 'application/pdf',
      bytes: toArrayBuffer(SAMPLE_PDF),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('media_upload_rejected');

    expect(await readSiteMediaKey(db, 'logo')).toBeNull();
    expect(bucket.objects.size).toBe(0);
  });

  it('si R2 falla, la configuracion se queda como estaba', async () => {
    bucket.failNextPut();

    const result = await subir('social');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('media_upload_failed');

    expect(await readSiteMediaKey(db, 'social')).toBeNull();
  });

  it('cada hueco es independiente', async () => {
    await subir('logo');
    await subir('favicon');

    const media = await getSiteMedia(db);

    expect(media.logo.present).toBe(true);
    expect(media.favicon.present).toBe(true);
    expect(media.social.present).toBe(false);
    expect(media.hero.present).toBe(false);

    expect(await readSiteMediaKey(db, 'logo')).not.toBe(await readSiteMediaKey(db, 'favicon'));
  });
});

/* -------------------------------------------------------------------------- */
/* Reemplazar                                                                 */
/* -------------------------------------------------------------------------- */

describe('reemplazar una imagen', () => {
  it('deja la nueva y retira la anterior', async () => {
    await subir('logo');
    const primera = (await readSiteMediaKey(db, 'logo')) ?? '';

    await subir('logo', SAMPLE_JPEG, 'image/jpeg');
    const segunda = (await readSiteMediaKey(db, 'logo')) ?? '';

    expect(segunda).not.toBe(primera);
    expect(bucket.objects.has(segunda)).toBe(true);
    expect(bucket.objects.has(primera)).toBe(false);
  });

  it('si no se puede borrar la anterior, prefiere el huerfano a la referencia rota', async () => {
    await subir('logo');
    const primera = (await readSiteMediaKey(db, 'logo')) ?? '';

    // R2 se niega a borrar: el objeto viejo se queda ahi.
    bucket.delete = () => Promise.reject(new Error('R2 caido'));

    const result = await subir('logo', SAMPLE_JPEG, 'image/jpeg');
    const segunda = (await readSiteMediaKey(db, 'logo')) ?? '';

    expect(result.ok).toBe(true);
    // Lo que importa: la referencia apunta a algo que SI existe.
    expect(segunda).not.toBe(primera);
    expect(bucket.objects.has(segunda)).toBe(true);
    expect(bucket.objects.has(primera)).toBe(true);
  });

  it('la version cambia, para que nadie se quede con la imagen anterior', async () => {
    await subir('logo');
    const antes = (await getSiteMedia(db)).logo.url;

    await db.update(siteSettings).set({ updatedAt: new Date(Date.now() + 60_000) });
    const despues = (await getSiteMedia(db)).logo.url;

    expect(antes).not.toBe(despues);
    expect(despues).toContain('/site-media/logo?v=');
  });
});

/* -------------------------------------------------------------------------- */
/* Quitar                                                                     */
/* -------------------------------------------------------------------------- */

describe('quitar una imagen', () => {
  it('borra la referencia y el objeto', async () => {
    await subir('hero', SAMPLE_JPEG, 'image/jpeg');
    const key = (await readSiteMediaKey(db, 'hero')) ?? '';

    const result = await deleteSiteMedia(db, bucket, 'hero');

    expect(result.ok).toBe(true);
    expect(await readSiteMediaKey(db, 'hero')).toBeNull();
    expect(bucket.objects.has(key)).toBe(false);
  });

  it('si R2 falla, la referencia ya se quito igualmente', async () => {
    await subir('hero', SAMPLE_JPEG, 'image/jpeg');
    bucket.delete = () => Promise.reject(new Error('R2 caido'));

    const result = await deleteSiteMedia(db, bucket, 'hero');

    expect(result.ok).toBe(true);
    // La web ya no lo enlaza; lo que queda es un archivo de mas.
    expect(await readSiteMediaKey(db, 'hero')).toBeNull();
  });

  it('un hueco vacio no se puede vaciar', async () => {
    const result = await deleteSiteMedia(db, bucket, 'social');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('media_not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Lo que se publica                                                          */
/* -------------------------------------------------------------------------- */

describe('lo que sale al sitio publico', () => {
  it('son rutas, nunca claves de R2', async () => {
    await subir('logo');
    await subir('hero', SAMPLE_JPEG, 'image/jpeg');

    const snapshot = await buildPublicSnapshot(db);
    const crudo = JSON.stringify(snapshot);
    const key = (await readSiteMediaKey(db, 'logo')) ?? '';

    expect(snapshot.site.media.logo).toMatch(/^\/site-media\/logo\?v=\d+$/);
    expect(snapshot.site.media.hero).toMatch(/^\/site-media\/hero\?v=\d+$/);

    expect(crudo).not.toContain(key);
    expect(crudo).not.toContain('sitio/');
    expect(crudo).not.toContain('objectKey');
  });

  it('un hueco vacio no publica nada', async () => {
    const snapshot = await buildPublicSnapshot(db);

    expect(snapshot.site.media).toEqual({
      logo: null,
      favicon: null,
      social: null,
      hero: null,
    });
  });

  it('la vista del panel tampoco lleva la clave', async () => {
    await subir('favicon');

    const media = await getSiteMedia(db);
    const key = (await readSiteMediaKey(db, 'favicon')) ?? '';

    expect(JSON.stringify(media)).not.toContain(key);
    expect(media.favicon.url).toBe(siteMediaUrl('favicon', media.favicon.version));
  });
});

/* -------------------------------------------------------------------------- */
/* La puerta publica                                                          */
/* -------------------------------------------------------------------------- */

describe('la entrega publica', () => {
  it('sirve la imagen de un hueco lleno', async () => {
    await subir('logo');

    const response = await serveSiteMedia({ slot: 'logo', db, bucket });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('max-age');
  });

  it('un hueco vacio responde 404', async () => {
    const response = await serveSiteMedia({ slot: 'hero', db, bucket });

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('un hueco que no existe se rechaza sin mirar la base', async () => {
    for (const slot of ['logotipo', '../secreto', 'sitio/logo/algo.png', '']) {
      expect((await serveSiteMedia({ slot, db, bucket })).status).toBe(404);
    }
  });

  it('no acepta una clave de R2 en la URL', async () => {
    await subir('logo');
    const key = (await readSiteMediaKey(db, 'logo')) ?? '';

    // Ni siquiera con la clave correcta: la URL no lleva claves.
    expect((await serveSiteMedia({ slot: key, db, bucket })).status).toBe(404);
  });

  it('revalida con ETag', async () => {
    await subir('logo');

    const primera = await serveSiteMedia({ slot: 'logo', db, bucket });
    const etag = primera.headers.get('etag');

    expect(etag).not.toBeNull();

    const segunda = await serveSiteMedia({ slot: 'logo', db, bucket, ifNoneMatch: etag });
    expect(segunda.status).toBe(304);
  });

  it('no se mezcla con la multimedia de propiedades', async () => {
    const delivery = await import('../../public/media-delivery');

    // Son dos funciones distintas, con dos reglas distintas.
    expect(typeof delivery.servePublicMedia).toBe('function');
    expect(serveSiteMedia).not.toBe(delivery.servePublicMedia);
  });
});
