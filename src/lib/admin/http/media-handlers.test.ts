/**
 * Tests HTTP de multimedia.
 *
 * Se invocan los handlers reales con `Request` reales sobre SQLite real. No se
 * repiten los tests de dominio: aqui se comprueba la adaptacion HTTP.
 */

import type { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPropertyDraft } from '../properties/create-property';
import { createMemoryBucket, type MemoryBucket } from '../media/bucket';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import { SAMPLE_JPEG, SAMPLE_PDF, toArrayBuffer } from '../media/test-files';
import type { AdminHttpContext } from './handlers';
import {
  handleCreateMedia,
  handleUploadMedia,
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
/** Compartido entre llamadas para poder comprobar que queda en el bucket. */
let bucket: MemoryBucket;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  bucket = createMemoryBucket();
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
    bucket,
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
      bucket,
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

/* -------------------------------------------------------------------------- */
/* Subida                                                                     */
/* -------------------------------------------------------------------------- */

/** Peticion multipart equivalente a la que enviara el formulario del panel. */
function uploadRequest(
  id: string,
  file: File,
  fields: Record<string, string> = { mediaKind: 'image' },
): Request {
  const form = new FormData();
  form.set('file', file);
  for (const [name, value] of Object.entries(fields)) form.set(name, value);

  // `FormData` fija por si mismo el content-type con su boundary.
  return new Request(`${BASE}/api/admin/properties/${id}/media/upload`, {
    method: 'POST',
    body: form,
  });
}

function sampleFile(bytes: Uint8Array, name = 'fachada.jpg', type = 'image/jpeg'): File {
  return new File([toArrayBuffer(bytes)], name, { type });
}

describe('subida de archivos', () => {
  it('sube una imagen y responde 201 con la fila creada', async () => {
    const id = await newProperty();

    const response = await handleUploadMedia(
      ctx(uploadRequest(id, sampleFile(SAMPLE_JPEG)), { id }),
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as { ok: boolean; data: { sourceProvider: string } };
    expect(body.ok).toBe(true);
    expect(body.data.sourceProvider).toBe('r2');
    expect(bucket.objects.size).toBe(1);
  });

  it('acepta los campos de texto y el grupo junto al archivo', async () => {
    const id = await newProperty();
    const groupId = await newGroup(id, 'Galería');

    const response = await handleUploadMedia(
      ctx(
        uploadRequest(id, sampleFile(SAMPLE_JPEG), {
          mediaKind: 'image',
          groupId: String(groupId),
          titleEs: 'Fachada',
        }),
        { id },
      ),
    );

    expect(response.status).toBe(201);

    const listed = await handleGetMedia(ctx(jsonRequest('GET'), { id }));
    const body = (await listed.json()) as {
      data: { groups: { media: { translations: { es?: { title: string | null } } }[] }[] };
    };

    expect(body.data.groups[0]?.media[0]?.translations.es?.title).toBe('Fachada');
  });

  it('un cuerpo que no es multipart se rechaza con 415', async () => {
    const id = await newProperty();

    const response = await handleUploadMedia(
      ctx(jsonRequest('POST', { mediaKind: 'image' }), { id }),
    );

    expect(response.status).toBe(415);
  });

  it('sin archivo se rechaza con 422', async () => {
    const id = await newProperty();

    const form = new FormData();
    form.set('mediaKind', 'image');

    const request = new Request(`${BASE}/api/admin/properties/${id}/media/upload`, {
      method: 'POST',
      body: form,
    });

    const response = await handleUploadMedia(ctx(request, { id }));

    expect(response.status).toBe(422);
    expect(bucket.objects.size).toBe(0);
  });

  it('un tipo de archivo desconocido se rechaza en el esquema', async () => {
    const id = await newProperty();

    const response = await handleUploadMedia(
      ctx(uploadRequest(id, sampleFile(SAMPLE_JPEG), { mediaKind: 'audio' }), { id }),
    );

    expect(response.status).toBe(422);
    expect(bucket.objects.size).toBe(0);
  });

  it('un campo desconocido se rechaza: el formulario tambien es estricto', async () => {
    const id = await newProperty();

    const response = await handleUploadMedia(
      ctx(uploadRequest(id, sampleFile(SAMPLE_JPEG), { mediaKind: 'image', propertyId: '99' }), {
        id,
      }),
    );

    expect(response.status).toBe(422);
  });

  it('el contenido se comprueba: un PDF disfrazado de JPEG no pasa', async () => {
    const id = await newProperty();

    const response = await handleUploadMedia(
      ctx(uploadRequest(id, sampleFile(SAMPLE_PDF, 'trampa.jpg', 'image/jpeg')), { id }),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('media_upload_rejected');
    expect(bucket.objects.size).toBe(0);
  });

  it('si R2 falla, responde 502 y no queda fila', async () => {
    const id = await newProperty();
    bucket.failNextPut();

    const response = await handleUploadMedia(
      ctx(uploadRequest(id, sampleFile(SAMPLE_JPEG)), { id }),
    );

    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe('media_upload_failed');

    const listed = await handleGetMedia(ctx(jsonRequest('GET'), { id }));
    const body = (await listed.json()) as { data: { ungrouped: unknown[] } };
    expect(body.data.ungrouped).toHaveLength(0);
  });

  it('sin acceso administrativo no se puede subir', async () => {
    const id = await newProperty();

    const response = await handleUploadMedia(
      ctx(uploadRequest(id, sampleFile(SAMPLE_JPEG)), { id }, false),
    );

    expect(response.status).toBe(403);
    expect(bucket.objects.size).toBe(0);
  });

  it('una subida cross-origin se rechaza', async () => {
    const id = await newProperty();

    const form = new FormData();
    form.set('file', sampleFile(SAMPLE_JPEG));
    form.set('mediaKind', 'image');

    const request = new Request(`${BASE}/api/admin/properties/${id}/media/upload`, {
      method: 'POST',
      headers: { origin: 'https://atacante.test' },
      body: form,
    });

    const response = await handleUploadMedia(ctx(request, { id }));

    expect(response.status).toBe(403);
    expect(bucket.objects.size).toBe(0);
  });

  it('borrar el archivo retira tambien su objeto', async () => {
    const id = await newProperty();

    const created = await handleUploadMedia(
      ctx(uploadRequest(id, sampleFile(SAMPLE_JPEG)), { id }),
    );
    const mediaId = String(await idOf(created));

    expect(bucket.objects.size).toBe(1);

    const removed = await handleDeleteMedia(ctx(jsonRequest('DELETE'), { id, mediaId }));

    expect(removed.status).toBe(200);
    const body = (await removed.json()) as { data: { objectRemoved: boolean } };
    expect(body.data.objectRemoved).toBe(true);
    expect(bucket.objects.size).toBe(0);
  });
});
