/**
 * Tests HTTP del flujo de publicacion.
 *
 * Dos puertas con reglas distintas a proposito:
 *
 * - los endpoints del panel, detras de Access y same-origin, que solo PIDEN
 *   la operacion;
 * - el callback, que no puede estar detras de Access porque quien lo llama es
 *   un proceso, y cuya unica credencial es el token de la peticion.
 *
 * Tambien se comprueba aqui lo que no debe poder hacerse: publicar desde el
 * PATCH generico de estado del admin.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties, publicationRequests } from '../../db/schema';
import { createMemoryBucket, type MemoryBucket } from '../admin/media/bucket';
import { setMediaRoles } from '../admin/media/media';
import { uploadMedia } from '../admin/media/upload';
import { SAMPLE_JPEG, toArrayBuffer } from '../admin/media/test-files';
import { createPropertyDraft } from '../admin/properties/create-property';
import { updateProperty } from '../admin/properties/update-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { updatePropertyStatus } from '../admin/properties/update-property-status';
import { applySeed, createTestDatabase } from '../admin/test-database';
import type { AdminBatchDatabase } from '../admin/types';
import type { AdminHttpContext } from '../admin/http/handlers';
import { handleUpdateStatus } from '../admin/http/handlers';
import {
  handleGetPublication,
  handleRequestPublish,
  handleRequestUnpublish,
} from '../admin/http/publication-handlers';
import { CALLBACK_TOKEN_HEADER, handlePublicationCallback } from './callback-handler';
import type { PublishTrigger } from './trigger';

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
  options: { bypass?: boolean; trigger?: PublishTrigger } = {},
): AdminHttpContext {
  const bypass = options.bypass ?? true;

  return {
    request,
    params,
    db,
    bucket,
    env: bypass ? { isDev: true, ADMIN_DEV_BYPASS: 'true' } : { isDev: true },
    ...(options.trigger === undefined ? {} : { publishTrigger: options.trigger }),
  };
}

function post(path: string, body?: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function get(path: string): Request {
  return new Request(`${BASE}${path}`, { headers: { accept: 'application/json' } });
}

/** Callback con token en cabecera, como lo mandaria quien construye. */
function callback(token: string | null, body: unknown): Request {
  return new Request(`${BASE}/api/publication/callback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { [CALLBACK_TOKEN_HEADER]: token }),
    },
    body: JSON.stringify(body),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** Propiedad completa y aprobada. */
async function approvedProperty(slug = 'lote-http'): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');

  const propertyId = created.data.id;

  await updateProperty(db, propertyId, {
    propertyTypeId: 1,
    priceMode: 'exact',
    priceAmountMinor: 15_000_000,
    currencyCode: 'USD',
    areaSquareMeters: 4000,
    province: 'Guanacaste',
    publicLatitude: 9.95,
    publicLongitude: -85.65,
  });

  await upsertPropertyTranslation(db, propertyId, {
    locale: 'es',
    slug,
    title: 'Lote listo',
  });

  const media = await uploadMedia(db, bucket, propertyId, {
    mediaKind: 'image',
    fileName: 'foto.jpg',
    declaredMimeType: 'image/jpeg',
    bytes: toArrayBuffer(SAMPLE_JPEG),
  });
  if (!media.ok) throw new Error('setup: archivo');

  await setMediaRoles(db, propertyId, media.data.id, { isHero: true, isCatalogCover: true });

  await updatePropertyStatus(db, propertyId, 'in_review');
  await updatePropertyStatus(db, propertyId, 'approved');

  return propertyId;
}

/** Pide publicar por HTTP y devuelve el token que da el ejecutor manual. */
async function askToPublish(propertyId: number): Promise<string> {
  const response = await handleRequestPublish(
    ctx(post(`/api/admin/properties/${propertyId}/publication/publish`, {}), {
      id: String(propertyId),
    }),
  );

  const payload = (await response.json()) as {
    data?: { manual: { callbackToken: string } | null };
  };

  const token = payload.data?.manual?.callbackToken;
  if (token === undefined) throw new Error('setup: sin token manual');

  return token;
}

async function statusOf(propertyId: number): Promise<string> {
  const rows = await db
    .select({ status: properties.publicationStatus })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows[0]?.status ?? 'desconocido';
}

/* -------------------------------------------------------------------------- */
/* El PATCH generico                                                          */
/* -------------------------------------------------------------------------- */

describe('el cambio de estado del panel', () => {
  it('no puede publicar', async () => {
    const propertyId = await approvedProperty();

    const response = await handleUpdateStatus(
      ctx(
        new Request(`${BASE}/api/admin/properties/${propertyId}/status`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ publicationStatus: 'published' }),
        }),
        { id: String(propertyId) },
      ),
    );

    expect(response.status).toBe(422);
    expect((await body(response)).ok).toBe(false);
    expect(await statusOf(propertyId)).toBe('approved');
  });

  it('tampoco puede despublicar', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);
    await handlePublicationCallback({ request: callback(token, { ok: true }), db });

    const response = await handleUpdateStatus(
      ctx(
        new Request(`${BASE}/api/admin/properties/${propertyId}/status`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ publicationStatus: 'approved' }),
        }),
        { id: String(propertyId) },
      ),
    );

    expect(response.status).toBe(422);
    expect(await statusOf(propertyId)).toBe('published');
  });
});

/* -------------------------------------------------------------------------- */
/* Endpoints del panel                                                        */
/* -------------------------------------------------------------------------- */

describe('los endpoints del panel', () => {
  it('exigen acceso administrativo', async () => {
    const propertyId = await approvedProperty();
    const params = { id: String(propertyId) };

    const responses = [
      await handleGetPublication(
        ctx(get(`/api/admin/properties/${propertyId}/publication`), params, { bypass: false }),
      ),
      await handleRequestPublish(
        ctx(post(`/api/admin/properties/${propertyId}/publication/publish`, {}), params, {
          bypass: false,
        }),
      ),
      await handleRequestUnpublish(
        ctx(post(`/api/admin/properties/${propertyId}/publication/unpublish`, {}), params, {
          bypass: false,
        }),
      ),
    ];

    for (const response of responses) expect(response.status).toBe(403);
    // Nada se ha anotado.
    expect(await db.select().from(publicationRequests)).toHaveLength(0);
  });

  it('rechazan una escritura de otro origen', async () => {
    const propertyId = await approvedProperty();

    const request = new Request(`${BASE}/api/admin/properties/${propertyId}/publication/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://otro.example' },
      body: '{}',
    });

    const response = await handleRequestPublish(ctx(request, { id: String(propertyId) }));

    expect(response.status).toBe(403);
  });

  it('no se cachean', async () => {
    const propertyId = await approvedProperty();

    const response = await handleGetPublication(
      ctx(get(`/api/admin/properties/${propertyId}/publication`), { id: String(propertyId) }),
    );

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rechazan un identificador que no es un entero positivo', async () => {
    const response = await handleGetPublication(
      ctx(get('/api/admin/properties/abc/publication'), { id: 'abc' }),
    );

    expect(response.status).toBe(422);
  });

  it('publicar devuelve el estado y el paso manual', async () => {
    const propertyId = await approvedProperty();

    const response = await handleRequestPublish(
      ctx(post(`/api/admin/properties/${propertyId}/publication/publish`, {}), {
        id: String(propertyId),
      }),
    );

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      data: {
        publication: { publicationStatus: string; current: { status: string } | null };
        manual: { callbackToken: string; callbackPath: string } | null;
      };
    };

    // La UI no puede ver "publicada" antes de que lo este de verdad.
    expect(payload.data.publication.publicationStatus).toBe('approved');
    expect(payload.data.publication.current?.status).toBe('building');
    expect(payload.data.manual?.callbackPath).toBe('/api/publication/callback');
  });

  it('en produccion el token no llega al navegador', async () => {
    const propertyId = await approvedProperty();

    /*
     * `isDev: false` es una build productiva. El bypass de Access se apoya en
     * el mismo indicador, asi que aqui se autoriza con el resolutor de
     * pruebas... que no existe: se comprueba solo que sin DEV no hay token.
     */
    const response = await handleRequestPublish({
      request: post(`/api/admin/properties/${propertyId}/publication/publish`, {}),
      params: { id: String(propertyId) },
      db,
      bucket,
      env: { isDev: false, ADMIN_DEV_BYPASS: 'true' },
    });

    // Sin DEV el bypass no vale: ni siquiera se entra.
    expect(response.status).toBe(403);
    expect(await db.select().from(publicationRequests)).toHaveLength(0);
  });

  it('una ficha incompleta responde 422 y no anota nada', async () => {
    const created = await createPropertyDraft(db);
    if (!created.ok) throw new Error('setup');

    const propertyId = created.data.id;
    await updatePropertyStatus(db, propertyId, 'in_review');
    await updatePropertyStatus(db, propertyId, 'approved');

    const response = await handleRequestPublish(
      ctx(post(`/api/admin/properties/${propertyId}/publication/publish`, {}), {
        id: String(propertyId),
      }),
    );

    expect(response.status).toBe(422);

    const payload = await body(response);
    expect((payload.error as { code: string }).code).toBe('publication_incomplete');
    expect(await db.select().from(publicationRequests)).toHaveLength(0);
  });

  it('retirar algo que no esta publicado responde 409', async () => {
    const propertyId = await approvedProperty();

    const response = await handleRequestUnpublish(
      ctx(post(`/api/admin/properties/${propertyId}/publication/unpublish`, {}), {
        id: String(propertyId),
      }),
    );

    expect(response.status).toBe(409);
  });

  it('una segunda peticion en curso responde 409', async () => {
    const propertyId = await approvedProperty();
    await askToPublish(propertyId);

    const response = await handleRequestPublish(
      ctx(post(`/api/admin/properties/${propertyId}/publication/publish`, {}), {
        id: String(propertyId),
      }),
    );

    expect(response.status).toBe(409);
  });

  it('si el ejecutor rechaza el trabajo responde 502', async () => {
    const propertyId = await approvedProperty();

    const response = await handleRequestPublish(
      ctx(
        post(`/api/admin/properties/${propertyId}/publication/publish`, {}),
        { id: String(propertyId) },
        {
          trigger: {
            name: 'roto',
            start: () => Promise.resolve({ ok: false, error: 'No hay ejecutor.' }),
          },
        },
      ),
    );

    expect(response.status).toBe(502);
    expect(await statusOf(propertyId)).toBe('approved');
  });
});

/* -------------------------------------------------------------------------- */
/* Callback                                                                   */
/* -------------------------------------------------------------------------- */

describe('el callback del build', () => {
  it('cierra la publicacion con el token correcto', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    const response = await handlePublicationCallback({
      request: callback(token, { ok: true }),
      db,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const payload = (await response.json()) as {
      data: { status: string; publicationStatus: string };
    };

    expect(payload.data.status).toBe('done');
    expect(payload.data.publicationStatus).toBe('published');
    expect(await statusOf(propertyId)).toBe('published');
  });

  it('no lleva cabeceras CORS: no es para un navegador', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    const response = await handlePublicationCallback({
      request: callback(token, { ok: true }),
      db,
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sin token responde igual que con uno inventado', async () => {
    const propertyId = await approvedProperty();
    await askToPublish(propertyId);

    const missing = await handlePublicationCallback({
      request: callback(null, { ok: true }),
      db,
    });
    const wrong = await handlePublicationCallback({
      request: callback('z'.repeat(43), { ok: true }),
      db,
    });

    expect(missing.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(await missing.text()).toBe(await wrong.text());
  });

  it('repetirlo no vuelve a transicionar', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    await handlePublicationCallback({ request: callback(token, { ok: true }), db });
    const again = await handlePublicationCallback({
      request: callback(token, { ok: false, error: 'ups' }),
      db,
    });

    expect(again.status).toBe(404);
    expect(await statusOf(propertyId)).toBe('published');
  });

  it('no acepta que el cliente diga sobre que propiedad actua', async () => {
    const first = await approvedProperty('lote-uno');
    const second = await approvedProperty('lote-dos');
    const token = await askToPublish(first);

    await handlePublicationCallback({
      request: callback(token, { ok: true, propertyId: second, publicationStatus: 'published' }),
      db,
    });

    // Solo se movio la propiedad de la peticion.
    expect(await statusOf(first)).toBe('published');
    expect(await statusOf(second)).toBe('approved');
  });

  it('un fallo se registra sin mover la propiedad', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    const response = await handlePublicationCallback({
      request: callback(token, { ok: false, error: 'El despliegue no termino.' }),
      db,
    });

    expect(response.status).toBe(200);
    expect(await statusOf(propertyId)).toBe('approved');

    const rows = await db.select().from(publicationRequests);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.errorSummary).toBe('El despliegue no termino.');
  });

  it('rechaza lo que no es una confirmacion', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    const noOk = await handlePublicationCallback({ request: callback(token, {}), db });
    const wrongType = await handlePublicationCallback({
      request: callback(token, { ok: 'si' }),
      db,
    });

    expect(noOk.status).toBe(422);
    expect(wrongType.status).toBe(422);

    // Y la peticion sigue viva: no se ha cerrado por una tonteria.
    const rows = await db.select().from(publicationRequests);
    expect(rows[0]?.status).toBe('building');
  });

  it('exige JSON y el metodo correcto', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    const asForm = await handlePublicationCallback({
      request: new Request(`${BASE}/api/publication/callback`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', [CALLBACK_TOKEN_HEADER]: token },
        body: 'ok=true',
      }),
      db,
    });

    const asGet = await handlePublicationCallback({
      request: new Request(`${BASE}/api/publication/callback`, {
        headers: { [CALLBACK_TOKEN_HEADER]: token },
      }),
      db,
    });

    expect(asForm.status).toBe(415);
    expect(asGet.status).toBe(405);
  });

  it('recorta un motivo desmesurado', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    await handlePublicationCallback({
      request: callback(token, { ok: false, error: 'x'.repeat(2000) }),
      db,
    });

    const rows = await db.select().from(publicationRequests);
    expect((rows[0]?.errorSummary ?? '').length).toBeLessThanOrEqual(200);
  });
});
