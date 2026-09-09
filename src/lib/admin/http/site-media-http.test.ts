/**
 * Tests HTTP de la media global.
 *
 * La puerta del panel exige Access y mismo origen, como el resto; la puerta
 * publica solo entiende cuatro nombres. Aqui se comprueban las dos, y sobre
 * todo que ninguna clave de R2 cruza en ningun sentido.
 */

import type { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryBucket, type MemoryBucket } from '../media/bucket';
import { SAMPLE_JPEG, SAMPLE_PDF, SAMPLE_PNG, toArrayBuffer } from '../media/test-files';
import { readSiteMediaKey } from '../settings/site-media';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import type { AdminHttpContext } from './handlers';
import {
  handleDeleteSiteMedia,
  handleGetSettings,
  handleUploadSiteMedia,
} from './settings-handlers';

const BASE = 'https://codeloba.test';

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

function ctx(
  request: Request,
  params: Record<string, string | undefined> = {},
  bypass = true,
): AdminHttpContext {
  return {
    request,
    params,
    db,
    bucket,
    env: bypass ? { isDev: true, ADMIN_DEV_BYPASS: 'true' } : { isDev: true },
  };
}

/** Una subida como la manda el panel: multipart con un solo campo. */
function upload(
  slot: string,
  bytes = SAMPLE_PNG,
  mime = 'image/png',
  extra: { origin?: string } = {},
): Request {
  const form = new FormData();
  form.set('file', new File([toArrayBuffer(bytes)], 'imagen.png', { type: mime }));

  return new Request(`${BASE}/api/admin/settings/media/${slot}`, {
    method: 'PUT',
    ...(extra.origin === undefined ? {} : { headers: { origin: extra.origin } }),
    body: form,
  });
}

function remove(slot: string, origin?: string): Request {
  return new Request(`${BASE}/api/admin/settings/media/${slot}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      ...(origin === undefined ? {} : { origin }),
    },
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Acceso                                                                     */
/* -------------------------------------------------------------------------- */

describe('quien puede tocar la media del sitio', () => {
  it('sin acceso administrativo, nadie', async () => {
    const subida = await handleUploadSiteMedia(ctx(upload('logo'), { slot: 'logo' }, false));
    const borrado = await handleDeleteSiteMedia(ctx(remove('logo'), { slot: 'logo' }, false));

    expect(subida.status).toBe(403);
    expect(borrado.status).toBe(403);

    expect(await readSiteMediaKey(db, 'logo')).toBeNull();
    expect(bucket.objects.size).toBe(0);
  });

  it('una escritura de otro origen se rechaza', async () => {
    const response = await handleUploadSiteMedia(
      ctx(upload('logo', SAMPLE_PNG, 'image/png', { origin: 'https://otro.example' }), {
        slot: 'logo',
      }),
    );

    expect(response.status).toBe(403);
    expect(await readSiteMediaKey(db, 'logo')).toBeNull();
  });

  it('las respuestas del panel no se cachean', async () => {
    const response = await handleUploadSiteMedia(ctx(upload('logo'), { slot: 'logo' }));

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

/* -------------------------------------------------------------------------- */
/* Huecos                                                                     */
/* -------------------------------------------------------------------------- */

describe('el hueco lo dice la ruta', () => {
  it('sube al hueco pedido', async () => {
    const response = await handleUploadSiteMedia(ctx(upload('hero'), { slot: 'hero' }));

    expect(response.status).toBe(200);
    expect(await readSiteMediaKey(db, 'hero')).not.toBeNull();
    expect(await readSiteMediaKey(db, 'logo')).toBeNull();
  });

  it('un hueco inventado responde 404 y no toca nada', async () => {
    for (const slot of ['logotipo', 'propiedades', '..']) {
      const response = await handleUploadSiteMedia(ctx(upload(slot), { slot }));

      expect(response.status).toBe(404);
    }

    expect(bucket.objects.size).toBe(0);
  });

  it('sin archivo no hay subida', async () => {
    const form = new FormData();
    form.set('slot', 'logo');

    const response = await handleUploadSiteMedia(
      ctx(new Request(`${BASE}/api/admin/settings/media/logo`, { method: 'PUT', body: form }), {
        slot: 'logo',
      }),
    );

    expect(response.status).toBe(422);
  });

  it('un tipo que no se admite se rechaza', async () => {
    const response = await handleUploadSiteMedia(
      ctx(upload('logo', SAMPLE_PDF, 'application/pdf'), { slot: 'logo' }),
    );

    expect(response.status).toBe(422);
    expect((await body(response)).ok).toBe(false);
    expect(await readSiteMediaKey(db, 'logo')).toBeNull();
  });

  it('el cuerpo no puede colar una clave de R2', async () => {
    const form = new FormData();
    form.set('file', new File([toArrayBuffer(SAMPLE_PNG)], 'imagen.png', { type: 'image/png' }));
    form.set('objectKey', 'sitio/logo/mia.png');

    const response = await handleUploadSiteMedia(
      ctx(new Request(`${BASE}/api/admin/settings/media/logo`, { method: 'PUT', body: form }), {
        slot: 'logo',
      }),
    );

    expect(response.status).toBe(200);

    // El campo de mas se ignora: la clave la genera el servidor.
    const key = (await readSiteMediaKey(db, 'logo')) ?? '';
    expect(key).not.toBe('sitio/logo/mia.png');
    expect(key).toMatch(/^sitio\/logo\/[0-9a-f-]{36}\.png$/);
  });
});

/* -------------------------------------------------------------------------- */
/* Lo que devuelve                                                            */
/* -------------------------------------------------------------------------- */

describe('lo que ve el panel', () => {
  it('la configuracion incluye el estado de los cuatro huecos', async () => {
    await handleUploadSiteMedia(ctx(upload('logo'), { slot: 'logo' }));

    const response = await handleGetSettings(
      ctx(new Request(`${BASE}/api/admin/settings`, { headers: { accept: 'application/json' } })),
    );

    interface SlotPayload {
      present: boolean;
      url: string | null;
    }

    const payload = (await response.json()) as {
      data: { media: { logo: SlotPayload; hero: SlotPayload } };
    };

    expect(payload.data.media.logo.present).toBe(true);
    expect(payload.data.media.logo.url).toContain('/site-media/logo');
    expect(payload.data.media.hero.present).toBe(false);
    expect(payload.data.media.hero.url).toBeNull();
  });

  it('nunca devuelve la clave del objeto', async () => {
    await handleUploadSiteMedia(ctx(upload('hero', SAMPLE_JPEG, 'image/jpeg'), { slot: 'hero' }));

    const key = (await readSiteMediaKey(db, 'hero')) ?? '';

    const config = await handleGetSettings(
      ctx(new Request(`${BASE}/api/admin/settings`, { headers: { accept: 'application/json' } })),
    );
    const subida = await handleUploadSiteMedia(ctx(upload('logo'), { slot: 'logo' }));
    const borrado = await handleDeleteSiteMedia(ctx(remove('logo'), { slot: 'logo' }));

    for (const response of [config, subida, borrado]) {
      const crudo = await response.text();

      expect(crudo).not.toContain(key);
      expect(crudo).not.toContain('sitio/');
      expect(crudo).not.toContain('ObjectKey');
    }
  });

  it('quitar deja el hueco vacio', async () => {
    await handleUploadSiteMedia(ctx(upload('social'), { slot: 'social' }));

    const response = await handleDeleteSiteMedia(ctx(remove('social'), { slot: 'social' }));
    const payload = (await response.json()) as {
      data: { social: { present: boolean } };
    };

    expect(response.status).toBe(200);
    expect(payload.data.social.present).toBe(false);
    expect(await readSiteMediaKey(db, 'social')).toBeNull();
  });

  it('quitar algo que no esta responde 404', async () => {
    const response = await handleDeleteSiteMedia(ctx(remove('favicon'), { slot: 'favicon' }));

    expect(response.status).toBe(404);
  });
});
