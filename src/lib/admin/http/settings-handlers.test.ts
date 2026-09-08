/**
 * Tests HTTP de la configuracion del sitio.
 *
 * Handlers reales con `Request` reales sobre SQLite real. Lo que se comprueba
 * aqui es la adaptacion HTTP y, sobre todo, que nada de esto se pueda leer ni
 * escribir sin acceso: contiene los buzones internos del negocio.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryBucket } from '../media/bucket';
import { createSocialLink, updateSiteSettings } from '../settings/settings';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import type { AdminHttpContext } from './handlers';
import {
  handleCreateSocialLink,
  handleDeleteSocialLink,
  handleGetSettings,
  handleReorderSocialLinks,
  handleUpdateSettings,
  handleUpdateSettingsTranslation,
  handleUpdateSocialLink,
} from './settings-handlers';

const BASE = 'https://panel.codeloba.test';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

function ctx(
  request: Request,
  params: Record<string, string | undefined> = {},
  bypass = true,
): AdminHttpContext {
  return {
    request,
    params,
    db,
    bucket: createMemoryBucket(),
    env: bypass ? { isDev: true, ADMIN_DEV_BYPASS: 'true' } : { isDev: true },
  };
}

function request(method: string, path = '/api/admin/settings', body?: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function jsonOf(response: Response): Promise<{ data?: unknown; error?: { code: string } }> {
  return (await response.json()) as { data?: unknown; error?: { code: string } };
}

/* -------------------------------------------------------------------------- */
/* Acceso                                                                     */
/* -------------------------------------------------------------------------- */

describe('la configuracion no es publica', () => {
  it('sin acceso no se puede leer', async () => {
    await updateSiteSettings(db, { notificationsEmail: 'avisos@codeloba.test' });

    const response = await handleGetSettings(ctx(request('GET'), {}, false));

    expect(response.status).toBe(403);
    // Ni un buzon interno se escapa en el cuerpo del rechazo.
    expect(await response.text()).not.toContain('avisos@codeloba.test');
  });

  it('sin acceso tampoco se puede escribir nada', async () => {
    const cases: [string, Promise<Response>][] = [
      [
        'settings',
        handleUpdateSettings(ctx(request('PATCH', '/x', { businessName: 'X' }), {}, false)),
      ],
      [
        'traducciones',
        handleUpdateSettingsTranslation(
          ctx(request('PUT', '/x', { homeHeroTitle: 'X' }), { locale: 'es' }, false),
        ),
      ],
      [
        'crear red',
        handleCreateSocialLink(
          ctx(request('POST', '/x', { platform: 'X', url: 'https://x.test' }), {}, false),
        ),
      ],
      ['borrar red', handleDeleteSocialLink(ctx(request('DELETE'), { linkId: '1' }, false))],
      ['orden', handleReorderSocialLinks(ctx(request('PUT', '/x', { ids: [1] }), {}, false))],
    ];

    for (const [label, promise] of cases) {
      const response = await promise;
      expect(response.status, label).toBe(403);
    }
  });

  it('nada de esto se cachea', async () => {
    const response = await handleGetSettings(ctx(request('GET')));

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rechaza escrituras de otro origen', async () => {
    const patch = request('PATCH', '/x', { businessName: 'Loba' });
    patch.headers.set('origin', 'https://otro.example');

    expect((await handleUpdateSettings(ctx(patch))).status).toBe(403);
  });
});

/* -------------------------------------------------------------------------- */
/* Lectura y escritura                                                        */
/* -------------------------------------------------------------------------- */

describe('ajustes', () => {
  it('se leen con los dos idiomas y sus redes', async () => {
    const response = await handleGetSettings(ctx(request('GET')));
    const data = (await jsonOf(response)).data as {
      settings: unknown;
      translations: { locale: string }[];
      social: unknown[];
    };

    expect(response.status).toBe(200);
    expect(data.translations.map((entry) => entry.locale)).toEqual(['es', 'en']);
    expect(data.social).toEqual([]);
  });

  it('se guardan y se devuelve la configuracion completa', async () => {
    const response = await handleUpdateSettings(
      ctx(request('PATCH', '/x', { businessName: 'Loba', phone: '+506 2222 3333' })),
    );

    const data = (await jsonOf(response)).data as { settings: { businessName: string } };

    expect(response.status).toBe(200);
    expect(data.settings.businessName).toBe('Loba');
  });

  it('un cuerpo que no es JSON se rechaza', async () => {
    const bad = new Request(`${BASE}/api/admin/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'text/plain' },
      body: 'businessName=Loba',
    });

    expect((await handleUpdateSettings(ctx(bad))).status).toBe(415);
  });

  it('un campo desconocido se rechaza con 422', async () => {
    const response = await handleUpdateSettings(
      ctx(request('PATCH', '/x', { businessName: 'Loba', inventado: true })),
    );

    expect(response.status).toBe(422);
    expect((await jsonOf(response)).error?.code).toBe('validation_failed');
  });

  it('un correo invalido se rechaza con 422', async () => {
    const response = await handleUpdateSettings(ctx(request('PATCH', '/x', { email: 'roto' })));

    expect(response.status).toBe(422);
  });
});

describe('textos por idioma', () => {
  it('el idioma lo define la URL', async () => {
    const response = await handleUpdateSettingsTranslation(
      ctx(request('PUT', '/x', { homeHeroTitle: 'Nuestra costa' }), { locale: 'es' }),
    );

    expect(response.status).toBe(200);

    const data = (await jsonOf(response)).data as {
      translations: { locale: string; homeHeroTitle: string | null }[];
    };
    expect(data.translations.find((entry) => entry.locale === 'es')?.homeHeroTitle).toBe(
      'Nuestra costa',
    );
  });

  it('un idioma que no existe se rechaza', async () => {
    const response = await handleUpdateSettingsTranslation(
      ctx(request('PUT', '/x', { homeHeroTitle: 'X' }), { locale: 'fr' }),
    );

    expect(response.status).toBe(422);
  });

  it('el cuerpo no puede colar otro idioma', async () => {
    const response = await handleUpdateSettingsTranslation(
      ctx(request('PUT', '/x', { locale: 'en', homeHeroTitle: 'X' }), { locale: 'es' }),
    );

    // `locale` no es un campo del cuerpo: manda la URL.
    expect(response.status).toBe(422);
  });
});

describe('la pantalla', () => {
  it('los campos no heredan el estirado de la barra de filtros', () => {
    /*
     * `.admin-field` nace con `flex: 1 1 11rem` para la barra de filtros. En
     * una columna eso estira cada campo hasta llenar el panel.
     */
    const css = readFileSync(path.resolve(process.cwd(), 'src/styles/admin.css'), 'utf8');

    expect(css).toContain('.settings-form .admin-field {');
    expect(css).toContain('flex: 0 0 auto;');
  });
});

describe('redes sociales', () => {
  it('crear devuelve 201 y el enlace', async () => {
    const response = await handleCreateSocialLink(
      ctx(request('POST', '/x', { platform: 'Instagram', url: 'https://instagram.com/loba' })),
    );

    expect(response.status).toBe(201);
    expect((await jsonOf(response)).data).toMatchObject({ platform: 'Instagram', isActive: true });
  });

  it('una direccion que no es http se rechaza', async () => {
    const response = await handleCreateSocialLink(
      ctx(request('POST', '/x', { platform: 'X', url: 'javascript:alert(1)' })),
    );

    expect(response.status).toBe(422);
  });

  it('borrar responde 204 y despues 404', async () => {
    const created = await createSocialLink(db, {
      platform: 'Instagram',
      url: 'https://instagram.com/loba',
    });
    if (!created.ok) throw new Error('setup');

    const params = { linkId: String(created.data.id) };
    expect((await handleDeleteSocialLink(ctx(request('DELETE'), params))).status).toBe(204);
    expect((await handleDeleteSocialLink(ctx(request('DELETE'), params))).status).toBe(404);
  });

  it('un identificador que no es un entero positivo no llega a consultar', async () => {
    const response = await handleUpdateSocialLink(
      ctx(request('PATCH', '/x', { isActive: false }), { linkId: '0' }),
    );

    expect(response.status).toBe(422);
  });

  it('un orden que no describe la lista guardada responde 409', async () => {
    const a = await createSocialLink(db, { platform: 'A', url: 'https://a.test' });
    await createSocialLink(db, { platform: 'B', url: 'https://b.test' });
    if (!a.ok) throw new Error('setup');

    const response = await handleReorderSocialLinks(
      ctx(request('PUT', '/x', { ids: [a.data.id] })),
    );

    expect(response.status).toBe(409);
    expect((await jsonOf(response)).error?.code).toBe('social_order_conflict');
  });
});
