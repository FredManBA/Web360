/**
 * Tests HTTP de multimedia.
 *
 * Se invocan los handlers reales con `Request` reales sobre SQLite real. No se
 * repiten los tests de dominio: aqui se comprueba la adaptacion HTTP.
 */

import type { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPropertyDraft } from '../properties/create-property';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import type { AdminHttpContext } from './handlers';
import {
  handleCreateMedia,
  handleCreateMediaGroup,
  handleDeleteMedia,
  handleDeleteMediaGroup,
  handleGetMedia,
  handleSetMediaRoles,
  handleUpdateMedia,
  handleUpdateMediaGroup,
} from './media-handlers';

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
    env: bypass ? { isDev: true, ADMIN_DEV_BYPASS: 'true' } : { isDev: true },
  };
}

function jsonRequest(method: string, body?: unknown, headers: HeadersInit = {}): Request {
  return new Request(`${BASE}/api/admin/properties/1/media`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function newProperty(): Promise<string> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup');
  return String(created.data.id);
}

async function idOf(response: Response): Promise<number> {
  const body = (await response.json()) as { data: { id: number } };
  return body.data.id;
}

async function newGroup(id: string, nameEs = 'Galería'): Promise<number> {
  return idOf(await handleCreateMediaGroup(ctx(jsonRequest('POST', { nameEs }), { id })));
}

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `http/archivo-${keyCounter}.jpg`;
}

async function newImage(id: string, extra: Record<string, unknown> = {}): Promise<number> {
  const response = await handleCreateMedia(
    ctx(
      jsonRequest('POST', {
        mediaKind: 'image',
        sourceProvider: 'r2',
        objectKey: nextKey(),
        ...extra,
      }),
      { id },
    ),
  );
  return idOf(response);
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

/* -------------------------------------------------------------------------- */
/* Acceso                                                                     */
/* -------------------------------------------------------------------------- */

describe('acceso', () => {
  it('sin bypass ni Access, todo el multimedia responde 403', async () => {
    const id = await newProperty();

    const responses = [
      await handleGetMedia(ctx(jsonRequest('GET'), { id }, false)),
      await handleCreateMedia(ctx(jsonRequest('POST', {}), { id }, false)),
      await handleCreateMediaGroup(ctx(jsonRequest('POST', {}), { id }, false)),
      await handleUpdateMedia(ctx(jsonRequest('PATCH', {}), { id, mediaId: '1' }, false)),
      await handleDeleteMedia(ctx(jsonRequest('DELETE'), { id, mediaId: '1' }, false)),
      await handleSetMediaRoles(ctx(jsonRequest('PUT', {}), { id, mediaId: '1' }, false)),
    ];

    for (const response of responses) expect(response.status).toBe(403);
  });

  it('una escritura cross-origin se rechaza', async () => {
    const id = await newProperty();

    const request = jsonRequest('POST', { nameEs: 'X' }, { origin: 'https://atacante.test' });
    const response = await handleCreateMediaGroup(ctx(request, { id }));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe('forbidden');
  });

  it('todas las respuestas llevan Cache-Control: no-store', async () => {
    const id = await newProperty();
    const mediaId = String(await newImage(id));

    const responses = [
      await handleGetMedia(ctx(jsonRequest('GET'), { id })),
      await handleUpdateMedia(ctx(jsonRequest('PATCH', { titleEs: 'x' }), { id, mediaId })),
      await handleSetMediaRoles(ctx(jsonRequest('PUT', { isHero: true }), { id, mediaId })),
    ];

    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toContain('application/json');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Cuerpo e identificadores                                                   */
/* -------------------------------------------------------------------------- */

describe('cuerpo e identificadores', () => {
  it('un content-type que no es JSON se rechaza con 415', async () => {
    const id = await newProperty();

    const request = new Request(`${BASE}/api/admin/properties/${id}/media`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'mediaKind=image',
    });

    const response = await handleCreateMedia(ctx(request, { id }));

    expect(response.status).toBe(415);
  });

  it('un identificador de ruta no numerico se rechaza con 422', async () => {
    const responses = [
      await handleGetMedia(ctx(jsonRequest('GET'), { id: 'abc' })),
      await handleUpdateMedia(ctx(jsonRequest('PATCH', {}), { id: '1', mediaId: '0' })),
      await handleDeleteMediaGroup(ctx(jsonRequest('DELETE'), { id: '1', groupId: '-2' })),
    ];

    for (const response of responses) expect(response.status).toBe(422);
  });

  it('el cuerpo es estricto: `propertyId` se rechaza, no se ignora', async () => {
    const id = await newProperty();

    const response = await handleCreateMedia(
      ctx(
        jsonRequest('POST', {
          mediaKind: 'image',
          sourceProvider: 'r2',
          objectKey: nextKey(),
          propertyId: 99,
        }),
        { id },
      ),
    );

    expect(response.status).toBe(422);
  });

  it('el tipo y el proveedor no se pueden cambiar despues de registrar', async () => {
    const id = await newProperty();
    const mediaId = String(await newImage(id));

    const response = await handleUpdateMedia(
      ctx(jsonRequest('PATCH', { mediaKind: 'video' }), { id, mediaId }),
    );

    expect(response.status).toBe(422);
  });

  it('un proveedor desconocido se rechaza en el esquema', async () => {
    const id = await newProperty();

    const response = await handleCreateMedia(
      ctx(
        jsonRequest('POST', { mediaKind: 'image', sourceProvider: 'vimeo', objectKey: nextKey() }),
        { id },
      ),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('validation_failed');
  });

  it('un tipo desconocido se rechaza en el esquema', async () => {
    const id = await newProperty();

    const response = await handleCreateMedia(
      ctx(jsonRequest('POST', { mediaKind: 'audio', sourceProvider: 'r2', objectKey: nextKey() }), {
        id,
      }),
    );

    expect(response.status).toBe(422);
  });

  it('una combinacion imposible se explica como error de proveedor', async () => {
    const id = await newProperty();

    const response = await handleCreateMedia(
      ctx(
        jsonRequest('POST', {
          mediaKind: 'panorama',
          sourceProvider: 'youtube',
          youtubeVideoId: 'dQw4w9WgXcQ',
        }),
        { id },
      ),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('media_invalid_provider');
  });
});

/* -------------------------------------------------------------------------- */
/* Ciclo completo                                                             */
/* -------------------------------------------------------------------------- */

describe('crear, leer, actualizar y borrar', () => {
  it('el ciclo completo funciona de punta a punta', async () => {
    const id = await newProperty();

    const groupId = await newGroup(id, 'Galería');
    const created = await handleCreateMedia(
      ctx(
        jsonRequest('POST', {
          mediaKind: 'image',
          sourceProvider: 'r2',
          objectKey: nextKey(),
          groupId,
          titleEs: 'Fachada',
        }),
        { id },
      ),
    );

    expect(created.status).toBe(201);
    const mediaId = String(await idOf(created));

    const updated = await handleUpdateMedia(
      ctx(jsonRequest('PATCH', { groupId: null, titleEn: 'Facade' }), { id, mediaId }),
    );
    expect(updated.status).toBe(200);

    const listed = await handleGetMedia(ctx(jsonRequest('GET'), { id }));
    const body = (await listed.json()) as {
      ok: boolean;
      data: { ungrouped: { id: number; translations: Record<string, unknown> }[] };
    };

    expect(body.ok).toBe(true);
    expect(body.data.ungrouped[0]?.id).toBe(Number(mediaId));
    expect(body.data.ungrouped[0]?.translations).toEqual({
      es: { title: 'Fachada', altText: null, caption: null },
      en: { title: 'Facade', altText: null, caption: null },
    });

    const removed = await handleDeleteMedia(ctx(jsonRequest('DELETE'), { id, mediaId }));
    expect(removed.status).toBe(200);
  });

  it('el grupo se crea con 201 y se puede renombrar y borrar', async () => {
    const id = await newProperty();

    const created = await handleCreateMediaGroup(ctx(jsonRequest('POST', {}), { id }));
    expect(created.status).toBe(201);

    const groupId = String(await idOf(created));

    const updated = await handleUpdateMediaGroup(
      ctx(jsonRequest('PATCH', { nameEs: 'Planos' }), { id, groupId }),
    );
    expect(updated.status).toBe(200);

    const removed = await handleDeleteMediaGroup(ctx(jsonRequest('DELETE'), { id, groupId }));
    expect(removed.status).toBe(200);
  });

  it('una propiedad inexistente devuelve 404', async () => {
    const response = await handleGetMedia(ctx(jsonRequest('GET'), { id: '9999' }));

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('not_found');
  });

  it('un archivo inexistente devuelve 404', async () => {
    const id = await newProperty();

    const response = await handleUpdateMedia(
      ctx(jsonRequest('PATCH', { titleEs: 'x' }), { id, mediaId: '9999' }),
    );

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('media_not_found');
  });

  it('un grupo inexistente devuelve 404', async () => {
    const id = await newProperty();

    const response = await handleUpdateMediaGroup(
      ctx(jsonRequest('PATCH', { nameEs: 'x' }), { id, groupId: '9999' }),
    );

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('media_group_not_found');
  });

  it('el grupo de otra propiedad devuelve 422', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const other = await newGroup(second, 'Ajeno');

    const response = await handleCreateMedia(
      ctx(
        jsonRequest('POST', {
          mediaKind: 'image',
          sourceProvider: 'r2',
          objectKey: nextKey(),
          groupId: other,
        }),
        { id: first },
      ),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('media_group_property_mismatch');
  });
});

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

describe('hero y portada por HTTP', () => {
  it('el endpoint de roles intercambia el hero', async () => {
    const id = await newProperty();
    const first = String(await newImage(id));
    const second = String(await newImage(id));

    await handleSetMediaRoles(ctx(jsonRequest('PUT', { isHero: true }), { id, mediaId: first }));
    const swap = await handleSetMediaRoles(
      ctx(jsonRequest('PUT', { isHero: true }), { id, mediaId: second }),
    );

    expect(swap.status).toBe(200);

    const listed = await handleGetMedia(ctx(jsonRequest('GET'), { id }));
    const body = (await listed.json()) as { data: { heroId: number | null } };
    expect(body.data.heroId).toBe(Number(second));
  });

  it('un tipo que no admite el rol devuelve 422', async () => {
    const id = await newProperty();

    const created = await handleCreateMedia(
      ctx(
        jsonRequest('POST', { mediaKind: 'document', sourceProvider: 'r2', objectKey: nextKey() }),
        { id },
      ),
    );
    const mediaId = String(await idOf(created));

    const response = await handleSetMediaRoles(
      ctx(jsonRequest('PUT', { isCatalogCover: true }), { id, mediaId }),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('media_role_conflict');
  });

  it('el cuerpo de roles tambien es estricto', async () => {
    const id = await newProperty();
    const mediaId = String(await newImage(id));

    const response = await handleSetMediaRoles(
      ctx(jsonRequest('PUT', { isHero: true, sortOrder: 3 }), { id, mediaId }),
    );

    expect(response.status).toBe(422);
  });

  it('un panorama en uso por el recorrido no se borra: 409', async () => {
    const id = await newProperty();

    const created = await handleCreateMedia(
      ctx(
        jsonRequest('POST', { mediaKind: 'panorama', sourceProvider: 'r2', objectKey: nextKey() }),
        { id },
      ),
    );
    const mediaId = await idOf(created);

    const { propertyTourNodes } = await import('../../../db/schema');
    await db
      .insert(propertyTourNodes)
      .values({ propertyId: Number(id), propertyMediaId: mediaId, isStart: true });

    const response = await handleDeleteMedia(
      ctx(jsonRequest('DELETE'), { id, mediaId: String(mediaId) }),
    );

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('media_in_use');
  });
});

/* -------------------------------------------------------------------------- */
/* Errores internos                                                           */
/* -------------------------------------------------------------------------- */

describe('errores internos', () => {
  it('no filtran SQL, tablas ni stack traces', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const brokenDb = {
      select: () => {
        throw new Error(
          'SQLITE_ERROR: no such table: property_media\n    at Statement.all (node:sqlite:120:15)',
        );
      },
    } as unknown as AdminBatchDatabase;

    const response = await handleGetMedia({
      request: jsonRequest('GET'),
      params: { id: '1' },
      db: brokenDb,
      env: { isDev: true, ADMIN_DEV_BYPASS: 'true' },
    });

    expect(response.status).toBe(500);

    const text = await response.text();
    expect(text).not.toContain('SQLITE');
    expect(text).not.toContain('no such table');
    expect(text).not.toContain('property_media');
    expect(text).not.toContain('node:sqlite');
    expect(text).not.toContain('at Statement');

    const body = JSON.parse(text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    expect(response.headers.get('cache-control')).toBe('no-store');

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
