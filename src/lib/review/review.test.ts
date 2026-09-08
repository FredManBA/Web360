/**
 * Tests de la revision privada.
 *
 * Contra SQLite real con las migraciones del proyecto. Aqui el token es la
 * unica credencial de alguien que no tiene cuenta, asi que se prueba con el
 * mismo detalle que se probaria un login: que solo se guarda el hash, que un
 * enlace muerto no distingue por que esta muerto, y que una decision no se
 * puede aplicar dos veces.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties, propertyReviews, propertyReviewTokens } from '../../db/schema';
import { createMedia } from '../admin/media/media';
import { createPropertyDraft } from '../admin/properties/create-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import type { AdminBatchDatabase } from '../admin/types';
import { buildPreviewSnapshot, buildPublicSnapshot, catalogueOf } from '../public/read-model';
import {
  decideReview,
  getReviewState,
  requestReview,
  resolveReviewToken,
  revokeReviewLinks,
} from './review';
import { generateReviewToken, hashReviewToken, looksLikeToken, tokenExpiry } from './tokens';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

async function draft(slug = 'lote-en-revision'): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');

  const translated = await upsertPropertyTranslation(db, created.data.id, {
    locale: 'es',
    slug,
    title: 'Lote pendiente de revisar',
    marketingDescription: 'Un borrador que todavia no esta publicado.',
  });
  if (!translated.ok) throw new Error('setup: traduccion');

  return created.data.id;
}

/** Abre una revision y devuelve el token en claro. */
async function invite(propertyId: number): Promise<string> {
  const result = await requestReview(db, propertyId);
  if (!result.ok) throw new Error('setup: revision');

  return result.data.token;
}

async function statusOf(propertyId: number): Promise<string> {
  const rows = await db
    .select({ status: properties.publicationStatus })
    .from(properties)
    .where(eq(properties.id, propertyId));

  return rows[0]?.status ?? 'desconocido';
}

async function tokenRows() {
  return db.select().from(propertyReviewTokens);
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                     */
/* -------------------------------------------------------------------------- */

describe('el token', () => {
  it('no se repite: viene del generador aleatorio del entorno', () => {
    const many = new Set(Array.from({ length: 200 }, () => generateReviewToken()));

    expect(many.size).toBe(200);
  });

  it('cabe en una URL y es lo bastante largo', () => {
    const token = generateReviewToken();

    expect(looksLikeToken(token)).toBe(true);
    // 32 bytes en base64url: 43 caracteres.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('el mismo token da siempre el mismo hash, y otro token da otro', async () => {
    const a = generateReviewToken();
    const b = generateReviewToken();

    expect(await hashReviewToken(a)).toBe(await hashReviewToken(a));
    expect(await hashReviewToken(a)).not.toBe(await hashReviewToken(b));
    // SHA-256 en hexadecimal.
    expect(await hashReviewToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('nace con vigencia', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');

    expect(tokenExpiry(now).getTime()).toBeGreaterThan(now.getTime());
  });

  it('una ruta absurda no llega ni a consultar la base', () => {
    expect(looksLikeToken('')).toBe(false);
    expect(looksLikeToken('corto')).toBe(false);
    expect(looksLikeToken('a'.repeat(200))).toBe(false);
    expect(looksLikeToken('con espacios dentro de la ruta')).toBe(false);
  });
});

describe('lo que se guarda en la base', () => {
  it('es SOLO el hash: el token no esta en ninguna columna', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const rows = await tokenRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(await hashReviewToken(token));

    // Ni una fila de la base contiene el token utilizable.
    const dump = JSON.stringify(await db.select().from(propertyReviewTokens));
    expect(dump).not.toContain(token);

    const reviews = JSON.stringify(await db.select().from(propertyReviews));
    expect(reviews).not.toContain(token);
  });

  it('consultar el estado NO devuelve el token', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const state = await getReviewState(db, propertyId);
    if (!state.ok) throw new Error('estado');

    expect(JSON.stringify(state.data)).not.toContain(token);
    // Pero si dice si el enlace sigue vivo.
    expect(state.data.current?.link?.isActive).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Envio a revision                                                           */
/* -------------------------------------------------------------------------- */

describe('enviar a revision', () => {
  it('pasa la propiedad de borrador a en revision', async () => {
    const propertyId = await draft();

    expect(await statusOf(propertyId)).toBe('draft');
    await invite(propertyId);
    expect(await statusOf(propertyId)).toBe('in_review');
  });

  it('abre una revision pendiente con su enlace', async () => {
    const propertyId = await draft();
    await invite(propertyId);

    const state = await getReviewState(db, propertyId);
    if (!state.ok) throw new Error('estado');

    expect(state.data.current?.status).toBe('pending');
    expect(state.data.history).toHaveLength(1);
  });

  it('pedirla dos veces da un enlace nuevo y mata el anterior', async () => {
    const propertyId = await draft();
    const first = await invite(propertyId);
    const second = await invite(propertyId);

    expect(second).not.toBe(first);
    // El viejo deja de servir en el acto.
    expect(await resolveReviewToken(db, first)).toBeNull();
    expect(await resolveReviewToken(db, second)).not.toBeNull();
  });

  it('y no abre una segunda revision en paralelo', async () => {
    const propertyId = await draft();
    await invite(propertyId);
    await invite(propertyId);

    const state = await getReviewState(db, propertyId);
    if (!state.ok) throw new Error('estado');

    expect(state.data.history).toHaveLength(1);
  });

  it('una propiedad publicada no entra en revision', async () => {
    const propertyId = await draft();
    await db
      .update(properties)
      .set({ publicationStatus: 'published' })
      .where(eq(properties.id, propertyId));

    const result = await requestReview(db, propertyId);

    // Lo decide la maquina de estados de siempre, no una regla nueva.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_status_transition');
  });

  it('una archivada tampoco', async () => {
    const propertyId = await draft();
    await db
      .update(properties)
      .set({ publicationStatus: 'archived' })
      .where(eq(properties.id, propertyId));

    expect((await requestReview(db, propertyId)).ok).toBe(false);
  });

  it('una propiedad que no existe se explica', async () => {
    const result = await requestReview(db, 999);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Validez del enlace                                                         */
/* -------------------------------------------------------------------------- */

describe('cuando un enlace sirve', () => {
  it('uno recien creado sirve', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const resolved = await resolveReviewToken(db, token);

    expect(resolved?.propertyId).toBe(propertyId);
    expect(resolved?.reviewStatus).toBe('pending');
  });

  it('uno inventado no sirve', async () => {
    await draft();

    expect(await resolveReviewToken(db, generateReviewToken())).toBeNull();
  });

  it('uno caducado no sirve', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const manana = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    expect(await resolveReviewToken(db, token, manana)).toBeNull();
  });

  it('uno revocado no sirve, y no vuelve a servir', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    await revokeReviewLinks(db, propertyId);

    expect(await resolveReviewToken(db, token)).toBeNull();
    // Ni aunque se vuelva a pedir revision: ese token concreto esta muerto.
    await invite(propertyId);
    expect(await resolveReviewToken(db, token)).toBeNull();
  });

  it('todos los casos responden lo mismo: `null`', async () => {
    const propertyId = await draft();
    const revoked = await invite(propertyId);
    await revokeReviewLinks(db, propertyId);

    /*
     * Inexistente, revocado y con forma invalida dan el mismo resultado.
     * Distinguirlos confirmaria que un token existio alguna vez.
     */
    expect(await resolveReviewToken(db, revoked)).toBeNull();
    expect(await resolveReviewToken(db, generateReviewToken())).toBeNull();
    expect(await resolveReviewToken(db, 'no-es-un-token')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Vista previa                                                               */
/* -------------------------------------------------------------------------- */

describe('lo que ve el reviewer', () => {
  const preview = (propertyId: number) =>
    buildPreviewSnapshot(db, propertyId, (mediaId) => `/review/x/media/${mediaId}`);

  it('ve el borrador, que el sitio publico no muestra', async () => {
    const propertyId = await draft();
    await invite(propertyId);

    const snapshot = await preview(propertyId);
    expect(catalogueOf(snapshot, 'es')).toHaveLength(1);
    expect(catalogueOf(snapshot, 'es')[0]?.title).toBe('Lote pendiente de revisar');

    // Y el sitio publico sigue sin saber que existe.
    expect(catalogueOf(await buildPublicSnapshot(db), 'es')).toEqual([]);
  });

  it('solo ve ESA propiedad, no el catalogo entero', async () => {
    const propertyId = await draft();
    await draft('otro-borrador');

    expect(catalogueOf(await preview(propertyId), 'es')).toHaveLength(1);
  });

  it('los archivos apuntan a la ruta de revision, no a la publica', async () => {
    const propertyId = await draft();

    const media = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: 'privado/foto.jpg',
    });
    if (!media.ok) throw new Error('setup: media');

    const item = catalogueOf(await preview(propertyId), 'es')[0]?.media.items[0];

    expect(item?.url).toBe(`/review/x/media/${media.data.id}`);
  });

  it('NO lleva coordenadas privadas ni claves de R2', async () => {
    const propertyId = await draft();

    await db
      .update(properties)
      .set({ privateLatitude: 9.777777, privateLongitude: -85.777777 })
      .where(eq(properties.id, propertyId));

    await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: 'privado/secreto.jpg',
    });

    const json = JSON.stringify(await preview(propertyId));

    // Es la misma proyeccion del sitio publico: excluye lo mismo.
    expect(json).not.toContain('privateLatitude');
    expect(json).not.toContain('9.777777');
    expect(json).not.toContain('objectKey');
    expect(json).not.toContain('secreto.jpg');
    expect(json).not.toContain('publicationStatus');
  });
});

/* -------------------------------------------------------------------------- */
/* Decision                                                                   */
/* -------------------------------------------------------------------------- */

describe('la decision del reviewer', () => {
  it('aprobar deja la propiedad aprobada, NO publicada', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const result = await decideReview(db, token, 'approved');

    expect(result.ok).toBe(true);
    expect(await statusOf(propertyId)).toBe('approved');
    // Publicar es cosa del admin, y de otra fase.
    expect(await statusOf(propertyId)).not.toBe('published');
  });

  it('y no la mete en el sitio publico', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);
    await decideReview(db, token, 'approved');

    expect(catalogueOf(await buildPublicSnapshot(db), 'es')).toEqual([]);
  });

  it('pedir cambios la devuelve a borrador', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    await decideReview(db, token, 'changes_requested', 'Faltan fotos del acceso.');

    expect(await statusOf(propertyId)).toBe('draft');

    const state = await getReviewState(db, propertyId);
    if (!state.ok) throw new Error('estado');

    expect(state.data.history[0]?.status).toBe('changes_requested');
    expect(state.data.history[0]?.reviewerComment).toBe('Faltan fotos del acceso.');
  });

  it('el comentario es opcional', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    expect((await decideReview(db, token, 'approved')).ok).toBe(true);
  });

  it('un comentario enorme se rechaza', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const result = await decideReview(db, token, 'approved', 'a'.repeat(2001));

    expect(result.ok).toBe(false);
    expect(await statusOf(propertyId)).toBe('in_review');
  });

  it('decidir INVALIDA el enlace: no se puede decidir dos veces', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    expect((await decideReview(db, token, 'approved')).ok).toBe(true);

    const second = await decideReview(db, token, 'changes_requested');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('review_link_invalid');

    // Y la propiedad se queda como la dejo la primera decision.
    expect(await statusOf(propertyId)).toBe('approved');
  });

  it('y el enlace deja de abrir la vista previa', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);
    await decideReview(db, token, 'approved');

    expect(await resolveReviewToken(db, token)).toBeNull();
  });

  it('un token de OTRA propiedad no decide sobre esta', async () => {
    const uno = await draft('primero');
    const dos = await draft('segundo');

    const tokenDeUno = await invite(uno);
    await invite(dos);

    await decideReview(db, tokenDeUno, 'approved');

    // Solo se movio la suya.
    expect(await statusOf(uno)).toBe('approved');
    expect(await statusOf(dos)).toBe('in_review');
  });

  it('un enlace revocado no decide nada', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);
    await revokeReviewLinks(db, propertyId);

    const result = await decideReview(db, token, 'approved');

    expect(result.ok).toBe(false);
    expect(await statusOf(propertyId)).toBe('in_review');
  });

  it('un enlace caducado tampoco', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const manana = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    expect((await decideReview(db, token, 'approved', null, manana)).ok).toBe(false);
  });

  it('una decision inventada se rechaza', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const result = await decideReview(db, token, 'publicada' as 'approved');

    expect(result.ok).toBe(false);
    expect(await statusOf(propertyId)).toBe('in_review');
  });
});

/* -------------------------------------------------------------------------- */
/* Revocacion                                                                 */
/* -------------------------------------------------------------------------- */

describe('revocar', () => {
  it('mata el enlace pero deja la revision abierta', async () => {
    const propertyId = await draft();
    const token = await invite(propertyId);

    const result = await revokeReviewLinks(db, propertyId);
    if (!result.ok) throw new Error('revocar');

    expect(await resolveReviewToken(db, token)).toBeNull();
    expect(result.data.current?.status).toBe('pending');
    expect(result.data.current?.link?.isActive).toBe(false);
  });

  it('sin revision abierta no hay nada que revocar', async () => {
    const propertyId = await draft();

    const result = await revokeReviewLinks(db, propertyId);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('review_not_found');
  });
});
