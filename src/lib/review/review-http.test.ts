/**
 * Tests HTTP de la revision privada.
 *
 * Tres puertas distintas, y cada una con su regla:
 *
 * - la media de revision, que exige token Y que el archivo sea de esa
 *   propiedad;
 * - el endpoint de decision, publico porque el reviewer no tiene cuenta;
 * - los endpoints del panel, que siguen detras de Access.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties } from '../../db/schema';
import { createMemoryBucket, type MemoryBucket } from '../admin/media/bucket';
import { uploadMedia } from '../admin/media/upload';
import { SAMPLE_JPEG, toArrayBuffer } from '../admin/media/test-files';
import { createPropertyDraft } from '../admin/properties/create-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import type { AdminBatchDatabase } from '../admin/types';
import type { AdminHttpContext } from '../admin/http/handlers';
import {
  handleGetReview,
  handleRequestReview,
  handleRevokeReviewLinks,
} from '../admin/http/review-handlers';
import { servePublicMedia } from '../public/media-delivery';
import { handleReviewDecision } from './decision-handler';
import { decisionEndpoint } from './decision-page';
import { serveReviewMedia } from './preview-media';
import { requestReview } from './review';
import { generateReviewToken } from './tokens';

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

async function draft(slug = 'lote-en-revision'): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');

  await upsertPropertyTranslation(db, created.data.id, {
    locale: 'es',
    slug,
    title: 'Lote pendiente de revisar',
  });

  return created.data.id;
}

async function invite(propertyId: number): Promise<string> {
  const result = await requestReview(db, propertyId);
  if (!result.ok) throw new Error('setup: revision');

  return result.data.token;
}

async function upload(propertyId: number, name = 'foto.jpg'): Promise<number> {
  const result = await uploadMedia(db, bucket, propertyId, {
    mediaKind: 'image',
    fileName: name,
    declaredMimeType: 'image/jpeg',
    bytes: toArrayBuffer(SAMPLE_JPEG),
  });

  if (!result.ok) throw new Error('setup: archivo');
  return result.data.id;
}

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

function post(path: string, body?: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/* -------------------------------------------------------------------------- */
/* Archivos durante la revision                                               */
/* -------------------------------------------------------------------------- */

describe('la media de revision', () => {
  it('sirve un archivo del borrador con un token valido', async () => {
    const propertyId = await draft();
    const mediaId = await upload(propertyId);
    const token = await invite(propertyId);

    const response = await serveReviewMedia({ token, mediaId, db, bucket });

    expect(response.status).toBe(200);
    // Un borrador no se cachea en ninguna parte.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    // Y el navegador no adivina el tipo de un archivo subido por alguien.
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sin token no sirve nada', async () => {
    const propertyId = await draft();
    const mediaId = await upload(propertyId);

    expect((await serveReviewMedia({ token: '', mediaId, db, bucket })).status).toBe(404);
  });

  it('con un token inventado tampoco', async () => {
    const propertyId = await draft();
    const mediaId = await upload(propertyId);

    const response = await serveReviewMedia({
      token: generateReviewToken(),
      mediaId,
      db,
      bucket,
    });

    expect(response.status).toBe(404);
  });

  it('un archivo de OTRA propiedad se rechaza, aunque el token sea valido', async () => {
    const mia = await draft('mia');
    const ajena = await draft('ajena');

    const token = await invite(mia);
    const archivoAjeno = await upload(ajena, 'ajena.jpg');

    // Es la comprobacion que impide pasear por la multimedia del catalogo.
    const response = await serveReviewMedia({ token, mediaId: archivoAjeno, db, bucket });

    expect(response.status).toBe(404);
  });

  it('un identificador que no es un entero positivo no llega a consultar', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    expect((await serveReviewMedia({ token, mediaId: 0, db, bucket })).status).toBe(404);
    expect((await serveReviewMedia({ token, mediaId: -1, db, bucket })).status).toBe(404);
  });

  it('tras decidir, el enlace deja de servir archivos', async () => {
    const propertyId = await draft();
    const mediaId = await upload(propertyId);
    const token = await invite(propertyId);

    await handleReviewDecision({ request: post('/x', { decision: 'approved' }), token, db });

    expect((await serveReviewMedia({ token, mediaId, db, bucket })).status).toBe(404);
  });

  it('la puerta publica sigue igual de estrecha', async () => {
    const propertyId = await draft();
    const mediaId = await upload(propertyId);
    await invite(propertyId);

    // El borrador tiene enlace de revision, y aun asi `/media/[id]` dice 404.
    expect((await servePublicMedia({ mediaId, db, bucket })).status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* Decision                                                                   */
/* -------------------------------------------------------------------------- */

describe('el endpoint de decision', () => {
  it('acepta la decision y no se cachea', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const response = await handleReviewDecision({
      request: post('/x', { decision: 'approved' }),
      token,
      db,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('no exige sesion: el reviewer no tiene cuenta', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const response = await handleReviewDecision({
      request: post('/x', { decision: 'changes_requested', comment: 'Cambia las fotos.' }),
      token,
      db,
    });

    expect(response.status).toBe(200);
  });

  it('un enlace muerto responde 404, sin decir por que', async () => {
    const response = await handleReviewDecision({
      request: post('/x', { decision: 'approved' }),
      token: generateReviewToken(),
      db,
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(
      JSON.stringify({ ok: false, error: { code: 'link_invalid' } }),
    );
  });

  it('una decision inventada se rechaza', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const response = await handleReviewDecision({
      request: post('/x', { decision: 'publicar' }),
      token,
      db,
    });

    expect(response.status).toBe(422);
  });

  it('solo acepta JSON', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const request = new Request(`${BASE}/x`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'decision=approved',
    });

    expect((await handleReviewDecision({ request, token, db })).status).toBe(415);
  });

  it('rechaza peticiones de otro origen', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const request = post('/x', { decision: 'approved' });
    request.headers.set('origin', 'https://otro.example');

    expect((await handleReviewDecision({ request, token, db })).status).toBe(403);
  });

  it('un cuerpo enorme se corta', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const request = post('/x', { decision: 'approved', comment: 'a'.repeat(9000) });

    expect((await handleReviewDecision({ request, token, db })).status).toBe(413);
  });

  it('la segunda decision no se aplica', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    await handleReviewDecision({ request: post('/x', { decision: 'approved' }), token, db });
    const second = await handleReviewDecision({
      request: post('/x', { decision: 'changes_requested' }),
      token,
      db,
    });

    expect(second.status).toBe(404);

    const rows = await db
      .select({ status: properties.publicationStatus })
      .from(properties)
      .where(eq(properties.id, propertyId));

    expect(rows[0]?.status).toBe('approved');
  });
});

describe('la pagina de revision apunta al endpoint correcto', () => {
  it('la vista previa y su endpoint NO comparten ruta', () => {
    /*
     * La pagina vive en `/review/<token>` y el endpoint en
     * `/api/review/<token>/decision`. Concatenar "/decision" sobre la ruta de
     * la pagina daba un 404 que ademas se leia como "enlace caducado".
     */
    expect(decisionEndpoint('/review/abc123')).toBe('/api/review/abc123/decision');
    expect(decisionEndpoint('/review/abc123/')).toBe('/api/review/abc123/decision');
  });

  it('fuera de esa ruta no hay endpoint que construir', () => {
    expect(decisionEndpoint('/es/propiedades/lote')).toBeNull();
    expect(decisionEndpoint('/review/')).toBeNull();
    expect(decisionEndpoint('/review/abc/media/1')).toBeNull();
  });

  it('el token no puede salir en la cabecera `Referer`', () => {
    /*
     * La URL de esta pagina ES la credencial, y la ficha carga recursos de
     * fuera —el video de YouTube—. Sin declararlo, que la ruta viaje o no en
     * el `Referer` dependeria del navegador de turno.
     */
    const page = readFileSync(
      path.resolve(process.cwd(), 'src/pages/review/[token].astro'),
      'utf8',
    );

    expect(page).toContain('<meta name="referrer" content="no-referrer" />');
    expect(page).toContain('noindex, nofollow, noarchive');
  });
});

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

describe('las acciones del panel siguen detras de Access', () => {
  it('sin acceso no se consulta la revision', async () => {
    const propertyId = await draft();
    await invite(propertyId);

    const request = new Request(`${BASE}/api/admin/properties/${propertyId}/review`);
    const response = await handleGetReview(ctx(request, { id: String(propertyId) }, false));

    expect(response.status).toBe(403);
  });

  it('sin acceso no se genera ni se revoca un enlace', async () => {
    const propertyId = await draft();
    const params = { id: String(propertyId) };

    expect((await handleRequestReview(ctx(post('/x', {}), params, false))).status).toBe(403);
    expect((await handleRevokeReviewLinks(ctx(post('/x'), params, false))).status).toBe(403);
  });

  it('el token se devuelve UNA vez, al crearlo', async () => {
    const propertyId = await draft();
    const params = { id: String(propertyId) };

    const created = await handleRequestReview(ctx(post('/x', {}), params));
    const body = (await created.json()) as { data: { token: string } };

    expect(created.status).toBe(200);
    expect(body.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Y consultarla despues ya no lo trae.
    const state = await handleGetReview(
      ctx(new Request(`${BASE}/api/admin/properties/${propertyId}/review`), params),
    );

    expect(await state.text()).not.toContain(body.data.token);
  });

  it('nada de esto se cachea', async () => {
    const propertyId = await draft();

    const response = await handleGetReview(
      ctx(new Request(`${BASE}/x`), { id: String(propertyId) }),
    );

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rechaza escrituras de otro origen', async () => {
    const propertyId = await draft();
    const request = post('/x', {});
    request.headers.set('origin', 'https://otro.example');

    expect((await handleRequestReview(ctx(request, { id: String(propertyId) }))).status).toBe(403);
  });

  it('un identificador invalido no llega a consultar', async () => {
    expect((await handleGetReview(ctx(new Request(`${BASE}/x`), { id: '0' }))).status).toBe(422);
  });

  it('revocar sin revision abierta responde 404', async () => {
    const propertyId = await draft();

    const response = await handleRevokeReviewLinks(ctx(post('/x'), { id: String(propertyId) }));

    expect(response.status).toBe(404);
  });
});
