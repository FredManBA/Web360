/**
 * Tests del protocolo de publicacion.
 *
 * Contra SQLite real con las migraciones del proyecto, porque aqui la mitad
 * de las garantias las sostiene el esquema: el indice unico parcial que impide
 * dos operaciones vivas sobre la misma propiedad y el unico del hash del token
 * no se pueden comprobar contra un mock.
 *
 * Lo que se prueba con mas insistencia es lo que puede dejar el sistema
 * incoherente: que la propiedad NO cambie de estado antes de la confirmacion,
 * que un fallo no mueva nada, y que un callback repetido no vuelva a
 * transicionar.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties, publicationRequests } from '../../db/schema';
import { createMedia } from '../admin/media/media';
import { setMediaRoles } from '../admin/media/media';
import { createPropertyDraft } from '../admin/properties/create-property';
import { updateProperty } from '../admin/properties/update-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import {
  allowedTransitionsFrom,
  isAllowedTransition,
  updatePropertyStatus,
} from '../admin/properties/update-property-status';
import { applySeed, createTestDatabase } from '../admin/test-database';
import { isUniqueViolation, type AdminBatchDatabase } from '../admin/types';
import { hashSecretToken } from '../security/secret-token';
import {
  finalizePublication,
  getPublicationState,
  requestPublication,
  summarizeError,
} from './publication';
import { manualPublishTrigger, type PublishTrigger } from './trigger';

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

/** El ejecutor de siempre en estos tests: acepta y devuelve el token. */
const trigger = manualPublishTrigger({ exposeToken: true });

/** Un ejecutor que rechaza el trabajo. */
const rejectingTrigger: PublishTrigger = {
  name: 'roto',
  start: () => Promise.resolve({ ok: false, error: 'El ejecutor esta caido.' }),
};

/** Un ejecutor que revienta. */
const throwingTrigger: PublishTrigger = {
  name: 'explosivo',
  start: () => Promise.reject(new Error('conexion rechazada contra 10.0.0.1:443')),
};

/** Propiedad completa, aprobada y lista para publicarse. */
async function approvedProperty(slug = 'lote-publicable'): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');

  const propertyId = created.data.id;

  await updateProperty(db, propertyId, {
    propertyTypeId: 1,
    priceMode: 'exact',
    priceAmountMinor: 12_000_000,
    currencyCode: 'USD',
    areaSquareMeters: 3400,
    province: 'Guanacaste',
    canton: 'Nicoya',
    publicLatitude: 9.95,
    publicLongitude: -85.65,
  });

  const translated = await upsertPropertyTranslation(db, propertyId, {
    locale: 'es',
    slug,
    title: 'Lote listo para publicar',
    marketingDescription: 'Una ficha completa.',
  });
  if (!translated.ok) throw new Error('setup: traduccion');

  const media = await createMedia(db, propertyId, {
    mediaKind: 'image',
    sourceProvider: 'r2',
    objectKey: `properties/${propertyId}/foto.jpg`,
    altTextEs: 'Vista del lote',
  });
  if (!media.ok) throw new Error('setup: archivo');

  const roles = await setMediaRoles(db, propertyId, media.data.id, {
    isHero: true,
    isCatalogCover: true,
  });
  if (!roles.ok) throw new Error('setup: roles');

  await updatePropertyStatus(db, propertyId, 'in_review');
  await updatePropertyStatus(db, propertyId, 'approved');

  return propertyId;
}

async function statusOf(propertyId: number): Promise<string> {
  const rows = await db
    .select({ status: properties.publicationStatus })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows[0]?.status ?? 'desconocido';
}

async function publishedAtOf(propertyId: number): Promise<Date | null> {
  const rows = await db
    .select({ publishedAt: properties.publishedAt })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows[0]?.publishedAt ?? null;
}

/** Pide publicar y devuelve el token del ejecutor manual. */
async function askToPublish(propertyId: number): Promise<string> {
  const result = await requestPublication(db, { propertyId, action: 'publish', trigger });
  if (!result.ok) throw new Error(`setup: peticion (${result.error.code})`);
  if (result.data.manual === null) throw new Error('setup: sin token manual');

  return result.data.manual.callbackToken;
}

/** Publica de verdad: pide, confirma y comprueba. */
async function publish(propertyId: number): Promise<void> {
  const token = await askToPublish(propertyId);
  const done = await finalizePublication(db, token, { ok: true });
  if (!done.ok) throw new Error('setup: publicacion');
}

/* -------------------------------------------------------------------------- */
/* Maquina de estados                                                         */
/* -------------------------------------------------------------------------- */

describe('las transiciones de publicacion', () => {
  it('existen, pero solo con alcance de publicacion', () => {
    expect(isAllowedTransition('approved', 'published')).toBe(false);
    expect(isAllowedTransition('published', 'approved')).toBe(false);

    expect(isAllowedTransition('approved', 'published', 'publication')).toBe(true);
    expect(isAllowedTransition('published', 'approved', 'publication')).toBe(true);
  });

  it('no abren ningun otro camino', () => {
    expect(isAllowedTransition('draft', 'published', 'publication')).toBe(false);
    expect(isAllowedTransition('in_review', 'published', 'publication')).toBe(false);
    expect(isAllowedTransition('archived', 'published', 'publication')).toBe(false);
  });

  it('no aparecen en las transiciones que ofrece el panel', () => {
    expect(allowedTransitionsFrom('approved')).not.toContain('published');
    expect(allowedTransitionsFrom('published')).not.toContain('approved');
    expect(allowedTransitionsFrom('approved', 'publication')).toContain('published');
  });

  it('un cambio de estado normal no puede publicar', async () => {
    const propertyId = await approvedProperty();

    const moved = await updatePropertyStatus(db, propertyId, 'published');

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.code).toBe('invalid_status_transition');
    expect(await statusOf(propertyId)).toBe('approved');
  });
});

/* -------------------------------------------------------------------------- */
/* Peticion                                                                   */
/* -------------------------------------------------------------------------- */

describe('pedir publicacion', () => {
  it('anota la peticion y NO cambia el estado editorial', async () => {
    const propertyId = await approvedProperty();

    const result = await requestPublication(db, { propertyId, action: 'publish', trigger });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.request.action).toBe('publish');
      expect(result.data.request.status).toBe('building');
      expect(result.data.request.isActive).toBe(true);
    }

    // Lo esencial: la propiedad sigue donde estaba.
    expect(await statusOf(propertyId)).toBe('approved');
    expect(await publishedAtOf(propertyId)).toBeNull();
  });

  it('exige que la propiedad este aprobada', async () => {
    const created = await createPropertyDraft(db);
    if (!created.ok) throw new Error('setup');

    const result = await requestPublication(db, {
      propertyId: created.data.id,
      action: 'publish',
      trigger,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('publication_not_allowed');
  });

  it('con la ficha incompleta no crea ninguna peticion', async () => {
    const created = await createPropertyDraft(db);
    if (!created.ok) throw new Error('setup');

    const propertyId = created.data.id;
    await updatePropertyStatus(db, propertyId, 'in_review');
    await updatePropertyStatus(db, propertyId, 'approved');

    const result = await requestPublication(db, { propertyId, action: 'publish', trigger });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('publication_incomplete');
      expect(result.error.issues?.length).toBeGreaterThan(0);
    }

    const rows = await db.select().from(publicationRequests);
    expect(rows).toHaveLength(0);
  });

  it('no admite dos operaciones vivas sobre la misma propiedad', async () => {
    const propertyId = await approvedProperty();
    await askToPublish(propertyId);

    const second = await requestPublication(db, { propertyId, action: 'publish', trigger });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('publication_in_progress');
  });

  it('el esquema tambien lo impide, no solo la comprobacion previa', async () => {
    const propertyId = await approvedProperty();
    await askToPublish(propertyId);

    /*
     * Se salta la capa de aplicacion a proposito: si la comprobacion previa
     * fuera lo unico que protege, dos peticiones simultaneas colarian.
     */
    const insert = db.insert(publicationRequests).values({
      propertyId,
      action: 'unpublish',
      status: 'pending',
      callbackTokenHash: 'otro-hash-cualquiera',
    });

    /*
     * Drizzle envuelve el error del driver, asi que se comprueba con el mismo
     * detector que usa la aplicacion y no con el texto del mensaje.
     */
    await expect(insert).rejects.toSatisfy(isUniqueViolation);
  });

  it('el historial si admite varias operaciones terminadas', async () => {
    const propertyId = await approvedProperty();

    await publish(propertyId);

    const unpublishToken = await (async () => {
      const result = await requestPublication(db, {
        propertyId,
        action: 'unpublish',
        trigger,
      });
      if (!result.ok || result.data.manual === null) throw new Error('setup: retirada');
      return result.data.manual.callbackToken;
    })();

    await finalizePublication(db, unpublishToken, { ok: true });

    const rows = await db
      .select()
      .from(publicationRequests)
      .where(eq(publicationRequests.propertyId, propertyId));

    expect(rows).toHaveLength(2);
  });

  it('solo guarda el hash del token, nunca el token', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    const rows = await db.select().from(publicationRequests);
    const row = rows[0];

    expect(row?.callbackTokenHash).toBe(await hashSecretToken(token));
    expect(row?.callbackTokenHash).not.toContain(token);
    // 64 caracteres hexadecimales: SHA-256.
    expect(row?.callbackTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cada peticion estrena token', async () => {
    const first = await approvedProperty('lote-uno');
    const second = await approvedProperty('lote-dos');

    expect(await askToPublish(first)).not.toBe(await askToPublish(second));
  });

  it('retirar exige que este publicada', async () => {
    const propertyId = await approvedProperty();

    const result = await requestPublication(db, { propertyId, action: 'unpublish', trigger });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('publication_not_allowed');
  });

  it('retirar tampoco cambia el estado hasta la confirmacion', async () => {
    const propertyId = await approvedProperty();
    await publish(propertyId);

    const result = await requestPublication(db, { propertyId, action: 'unpublish', trigger });

    expect(result.ok).toBe(true);
    expect(await statusOf(propertyId)).toBe('published');
  });
});

/* -------------------------------------------------------------------------- */
/* Fallos del ejecutor                                                        */
/* -------------------------------------------------------------------------- */

describe('cuando el ejecutor no acepta el trabajo', () => {
  it('deja la peticion fallida y la propiedad intacta', async () => {
    const propertyId = await approvedProperty();

    const result = await requestPublication(db, {
      propertyId,
      action: 'publish',
      trigger: rejectingTrigger,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('publication_trigger_failed');

    const rows = await db.select().from(publicationRequests);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.errorSummary).toBe('El ejecutor esta caido.');
    expect(rows[0]?.finishedAt).not.toBeNull();

    expect(await statusOf(propertyId)).toBe('approved');
  });

  it('una peticion fallida no bloquea la siguiente', async () => {
    const propertyId = await approvedProperty();

    await requestPublication(db, { propertyId, action: 'publish', trigger: rejectingTrigger });
    const second = await requestPublication(db, { propertyId, action: 'publish', trigger });

    expect(second.ok).toBe(true);
  });

  it('una excepcion del ejecutor no filtra su detalle', async () => {
    const propertyId = await approvedProperty();

    const result = await requestPublication(db, {
      propertyId,
      action: 'publish',
      trigger: throwingTrigger,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain('10.0.0.1');

    const rows = await db.select().from(publicationRequests);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.errorSummary).not.toContain('10.0.0.1');
  });
});

/* -------------------------------------------------------------------------- */
/* Confirmacion                                                               */
/* -------------------------------------------------------------------------- */

describe('confirmar una publicacion', () => {
  it('publica la propiedad y cierra la peticion', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    const result = await finalizePublication(db, token, { ok: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.publicationStatus).toBe('published');
      expect(result.data.request.status).toBe('done');
      expect(result.data.request.isActive).toBe(false);
    }

    expect(await statusOf(propertyId)).toBe('published');
    expect(await publishedAtOf(propertyId)).not.toBeNull();
  });

  it('retirar devuelve la propiedad a aprobada', async () => {
    const propertyId = await approvedProperty();
    await publish(propertyId);

    const asked = await requestPublication(db, { propertyId, action: 'unpublish', trigger });
    if (!asked.ok || asked.data.manual === null) throw new Error('setup');

    const result = await finalizePublication(db, asked.data.manual.callbackToken, { ok: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.publicationStatus).toBe('approved');

    expect(await statusOf(propertyId)).toBe('approved');
    // Ya no hay una version publicada: la fecha no puede seguir afirmando que si.
    expect(await publishedAtOf(propertyId)).toBeNull();
  });

  it('un build fallido no mueve la propiedad', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    const result = await finalizePublication(db, token, { ok: false, error: 'El build fallo.' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.request.status).toBe('failed');
      expect(result.data.publicationStatus).toBe('approved');
    }

    expect(await statusOf(propertyId)).toBe('approved');
  });

  it('un fallo sin motivo deja igualmente un motivo legible', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    await finalizePublication(db, token, { ok: false });

    const rows = await db.select().from(publicationRequests);
    expect(rows[0]?.errorSummary).toBe('El build no termino correctamente.');
  });

  it('repetir el callback no vuelve a transicionar', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    await finalizePublication(db, token, { ok: true });

    // El mismo token otra vez, ahora diciendo que fallo.
    const again = await finalizePublication(db, token, { ok: false, error: 'ups' });

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('publication_link_invalid');

    // Ni el estado ni la peticion se han tocado.
    expect(await statusOf(propertyId)).toBe('published');
    const rows = await db.select().from(publicationRequests);
    expect(rows[0]?.status).toBe('done');
    expect(rows[0]?.errorSummary).toBeNull();
  });

  it('el token de una peticion fallida tampoco vuelve a servir', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    await finalizePublication(db, token, { ok: false, error: 'roto' });
    const again = await finalizePublication(db, token, { ok: true });

    expect(again.ok).toBe(false);
    expect(await statusOf(propertyId)).toBe('approved');
  });

  it('un token que no existe falla igual que uno usado', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);
    await finalizePublication(db, token, { ok: true });

    const used = await finalizePublication(db, token, { ok: true });
    const unknown = await finalizePublication(db, 'x'.repeat(43), { ok: true });
    const malformed = await finalizePublication(db, 'no', { ok: true });

    for (const result of [used, unknown, malformed]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('publication_link_invalid');
    }

    // Y ninguno dice nada distinto del otro.
    expect(used.ok === false && unknown.ok === false && used.error.message).toBe(
      unknown.ok === false ? unknown.error.message : null,
    );
  });

  it('si la propiedad se archivo entretanto, la peticion queda fallida', async () => {
    const propertyId = await approvedProperty();
    const token = await askToPublish(propertyId);

    await updatePropertyStatus(db, propertyId, 'archived');

    const result = await finalizePublication(db, token, { ok: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('publication_failed');

    // No se fuerza un estado que ya no encaja.
    expect(await statusOf(propertyId)).toBe('archived');

    const rows = await db.select().from(publicationRequests);
    expect(rows[0]?.status).toBe('failed');
  });
});

/* -------------------------------------------------------------------------- */
/* Estado para el panel                                                       */
/* -------------------------------------------------------------------------- */

describe('el estado que ve el panel', () => {
  it('en borrador no ofrece publicar ni explica lo que falta', async () => {
    const created = await createPropertyDraft(db);
    if (!created.ok) throw new Error('setup');

    const state = await getPublicationState(db, created.data.id);

    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.data.canPublish).toBe(false);
      expect(state.data.canUnpublish).toBe(false);
      expect(state.data.issues).toEqual([]);
    }
  });

  it('aprobada e incompleta explica que falta', async () => {
    const created = await createPropertyDraft(db);
    if (!created.ok) throw new Error('setup');

    const propertyId = created.data.id;
    await updatePropertyStatus(db, propertyId, 'in_review');
    await updatePropertyStatus(db, propertyId, 'approved');

    const state = await getPublicationState(db, propertyId);

    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.data.canPublish).toBe(false);
      expect(state.data.issues.length).toBeGreaterThan(0);
    }
  });

  it('aprobada y completa ofrece publicar', async () => {
    const propertyId = await approvedProperty();
    const state = await getPublicationState(db, propertyId);

    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.data.canPublish).toBe(true);
      expect(state.data.canUnpublish).toBe(false);
      expect(state.data.current).toBeNull();
    }
  });

  it('con una operacion viva no ofrece ninguna accion', async () => {
    const propertyId = await approvedProperty();
    await askToPublish(propertyId);

    const state = await getPublicationState(db, propertyId);

    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.data.canPublish).toBe(false);
      expect(state.data.canUnpublish).toBe(false);
      expect(state.data.current?.status).toBe('building');
    }
  });

  it('publicada ofrece retirar', async () => {
    const propertyId = await approvedProperty();
    await publish(propertyId);

    const state = await getPublicationState(db, propertyId);

    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.data.publicationStatus).toBe('published');
      expect(state.data.canUnpublish).toBe(true);
      expect(state.data.canPublish).toBe(false);
    }
  });

  it('no existe la propiedad', async () => {
    const state = await getPublicationState(db, 99_999);

    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.error.code).toBe('not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Motivos de fallo                                                           */
/* -------------------------------------------------------------------------- */

describe('el resumen de un fallo', () => {
  it('normaliza espacios y recorta', () => {
    expect(summarizeError('  algo   fallo \n aqui ')).toBe('algo fallo aqui');
    expect(summarizeError('x'.repeat(500))).toHaveLength(200);
  });
});
