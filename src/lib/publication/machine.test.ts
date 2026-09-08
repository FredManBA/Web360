/**
 * Tests del endpoint de maquina.
 *
 * Es la puerta por la que el runner de Actions cuenta como fue. Lo que se
 * prueba con mas insistencia es lo que NO puede hacer una credencial correcta:
 * publicar una propiedad que el artefacto desplegado no esta sirviendo.
 *
 * Contra SQLite real y con `Request` de verdad. No se llama a GitHub ni a
 * Cloudflare.
 */

import type { DatabaseSync } from 'node:sqlite';

import { desc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties, publicationRequests } from '../../db/schema';
import { createMedia, setMediaRoles } from '../admin/media/media';
import { createPropertyDraft } from '../admin/properties/create-property';
import { updateProperty } from '../admin/properties/update-property';
import { updatePropertyStatus } from '../admin/properties/update-property-status';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import type { AdminBatchDatabase } from '../admin/types';
import { handlePublicationCallback, CALLBACK_TOKEN_HEADER } from './callback-handler';
import { handleMachineReport, MACHINE_SECRET_HEADER } from './machine-handler';
import { reconcilePublication, requestPublication } from './publication';
import type { ReleaseManifest } from './release';
import { manualPublishTrigger } from './trigger';

const BASE = 'https://codeloba.test';
const SECRET = 'secreto-compartido-de-maquina';

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

const trigger = manualPublishTrigger({ exposeToken: true });

async function approvedProperty(slug = 'lote-maquina'): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');

  const propertyId = created.data.id;

  await updateProperty(db, propertyId, {
    propertyTypeId: 1,
    priceMode: 'exact',
    priceAmountMinor: 10_000_000,
    currencyCode: 'USD',
    areaSquareMeters: 3000,
    province: 'Guanacaste',
    publicLatitude: 9.95,
    publicLongitude: -85.65,
  });

  await upsertPropertyTranslation(db, propertyId, { locale: 'es', slug, title: 'Lote' });

  const media = await createMedia(db, propertyId, {
    mediaKind: 'image',
    sourceProvider: 'r2',
    objectKey: `propiedades/${propertyId}/foto.jpg`,
  });
  if (!media.ok) throw new Error('setup: archivo');

  await setMediaRoles(db, propertyId, media.data.id, { isHero: true, isCatalogCover: true });
  await updatePropertyStatus(db, propertyId, 'in_review');
  await updatePropertyStatus(db, propertyId, 'approved');

  return propertyId;
}

/** Pide publicar y devuelve el numero de la operacion y su token. */
async function askToPublish(propertyId: number): Promise<{ requestId: number; token: string }> {
  const result = await requestPublication(db, { propertyId, action: 'publish', trigger });
  if (!result.ok || result.data.manual === null) throw new Error('setup: peticion');

  return { requestId: result.data.request.id, token: result.data.manual.callbackToken };
}

function artifactOf(requestId: number, propertyId: number): ReleaseManifest {
  return {
    releaseId: `publish-p${propertyId}-r${requestId}`,
    requestId,
    generatedAt: '2026-01-01T00:00:00.000Z',
    mediaIds: [],
  };
}

function report(secret: string | null, body: unknown): Request {
  return new Request(`${BASE}/api/publication/machine`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret === null ? {} : { [MACHINE_SECRET_HEADER]: secret }),
    },
    body: JSON.stringify(body),
  });
}

function send(
  request: Request,
  options: { secret?: string | undefined; deployed?: ReleaseManifest | null } = {},
): Promise<Response> {
  return handleMachineReport({
    request,
    db,
    secret: 'secret' in options ? options.secret : SECRET,
    deployedRelease: options.deployed ?? null,
  });
}

async function statusOf(propertyId: number): Promise<string> {
  const rows = await db
    .select({ status: properties.publicationStatus })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows[0]?.status ?? 'desconocido';
}

async function requestStatus(requestId: number): Promise<string> {
  const rows = await db
    .select({ status: publicationRequests.status })
    .from(publicationRequests)
    .where(eq(publicationRequests.id, requestId))
    .limit(1);

  return rows[0]?.status ?? 'desconocida';
}

/* -------------------------------------------------------------------------- */
/* Autenticacion                                                              */
/* -------------------------------------------------------------------------- */

describe('la puerta de la maquina', () => {
  it('sin credencial no entra, y no dice nada de la peticion', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    const sinCabecera = await send(report(null, { requestId, ok: true }));
    const inventada = await send(report('otra-cosa', { requestId, ok: true }));
    const inexistente = await send(report(null, { requestId: 99_999, ok: true }));

    for (const response of [sinCabecera, inventada, inexistente]) {
      expect(response.status).toBe(401);
    }

    // Las tres respuestas son identicas: no se filtra si la peticion existe.
    expect(await sinCabecera.text()).toBe(await inexistente.text());
    expect(await requestStatus(requestId)).toBe('building');
  });

  it('sin secreto configurado en el Worker no abre nada', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    const response = await send(report(SECRET, { requestId, ok: true }), {
      secret: undefined,
      deployed: artifactOf(requestId, propertyId),
    });

    expect(response.status).toBe(401);
    expect(await statusOf(propertyId)).toBe('approved');
  });

  it('no lleva cabeceras CORS ni se cachea', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    const response = await send(report(SECRET, { requestId, ok: true }), {
      deployed: artifactOf(requestId, propertyId),
    });

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('solo POST y solo JSON', async () => {
    const conGet = await send(
      new Request(`${BASE}/api/publication/machine`, {
        headers: { [MACHINE_SECRET_HEADER]: SECRET },
      }),
    );

    const comoFormulario = await send(
      new Request(`${BASE}/api/publication/machine`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', [MACHINE_SECRET_HEADER]: SECRET },
        body: 'ok=true',
      }),
    );

    expect(conGet.status).toBe(405);
    expect(comoFormulario.status).toBe(415);
  });
});

/* -------------------------------------------------------------------------- */
/* Exito                                                                      */
/* -------------------------------------------------------------------------- */

describe('el parte de exito', () => {
  it('cierra la operacion cuando el artefacto la lleva dentro', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    const response = await send(report(SECRET, { requestId, ok: true }), {
      deployed: artifactOf(requestId, propertyId),
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      data: { status: string; publicationStatus: string; releaseId: string };
    };

    expect(payload.data.status).toBe('done');
    expect(payload.data.publicationStatus).toBe('published');
    expect(payload.data.releaseId).toBe(`publish-p${propertyId}-r${requestId}`);
    expect(await statusOf(propertyId)).toBe('published');
  });

  it('con la credencial correcta pero OTRO artefacto NO publica', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    const response = await send(report(SECRET, { requestId, ok: true }), {
      deployed: artifactOf(requestId + 100, propertyId),
    });

    expect(response.status).toBe(409);
    expect(await statusOf(propertyId)).toBe('approved');
    expect(await requestStatus(requestId)).toBe('building');
  });

  it('sin artefacto desplegado tampoco publica', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    const response = await send(report(SECRET, { requestId, ok: true }), { deployed: null });

    expect(response.status).toBe(409);
    expect(await statusOf(propertyId)).toBe('approved');
  });

  it('una credencial robada no puede publicar OTRA propiedad', async () => {
    const victima = await approvedProperty('lote-victima');
    const desplegada = await approvedProperty('lote-desplegada');

    const suya = await askToPublish(victima);
    const otra = await askToPublish(desplegada);

    /*
     * El atacante tiene el secreto y pide cerrar la operacion de la victima,
     * pero el artefacto que responde es el de la otra propiedad.
     */
    const response = await send(report(SECRET, { requestId: suya.requestId, ok: true }), {
      deployed: artifactOf(otra.requestId, desplegada),
    });

    expect(response.status).toBe(409);
    expect(await statusOf(victima)).toBe('approved');
    expect(await statusOf(desplegada)).toBe('approved');
  });

  it('repetir el parte no transiciona dos veces', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);
    const deployed = artifactOf(requestId, propertyId);

    await send(report(SECRET, { requestId, ok: true }), { deployed });
    const otraVez = await send(report(SECRET, { requestId, ok: true }), { deployed });

    expect(otraVez.status).toBe(409);
    expect(await statusOf(propertyId)).toBe('published');
    expect(await requestStatus(requestId)).toBe('done');
  });

  it('el cuerpo no puede decidir la propiedad ni el estado', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    const response = await send(
      report(SECRET, {
        requestId,
        ok: true,
        propertyId: 1,
        publicationStatus: 'published',
      }),
      { deployed: artifactOf(requestId, propertyId) },
    );

    // Un campo de mas se rechaza: no se ignora en silencio.
    expect(response.status).toBe(422);
    expect(await statusOf(propertyId)).toBe('approved');
  });

  it('rechaza un parte mal formado', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    for (const body of [{}, { requestId }, { requestId, ok: 'si' }, { requestId: -1, ok: true }]) {
      expect((await send(report(SECRET, body))).status).toBe(422);
    }

    expect(await requestStatus(requestId)).toBe('building');
  });
});

/* -------------------------------------------------------------------------- */
/* Fallo                                                                      */
/* -------------------------------------------------------------------------- */

describe('el parte de fallo', () => {
  it('deja la operacion fallida y la propiedad intacta', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    const response = await send(
      report(SECRET, { requestId, ok: false, error: 'El build no compiló.' }),
    );

    expect(response.status).toBe(200);
    expect(await requestStatus(requestId)).toBe('failed');
    expect(await statusOf(propertyId)).toBe('approved');

    const rows = await db.select().from(publicationRequests);
    expect(rows[0]?.errorSummary).toBe('El build no compiló.');
  });

  it('no necesita artefacto: un fallo no publica nada', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    const response = await send(report(SECRET, { requestId, ok: false }), { deployed: null });

    expect(response.status).toBe(200);
    expect(await requestStatus(requestId)).toBe('failed');
  });

  it('repetirlo es inofensivo', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    await send(report(SECRET, { requestId, ok: false }));
    const otraVez = await send(report(SECRET, { requestId, ok: false }));

    expect(otraVez.status).toBe(409);
    expect(await requestStatus(requestId)).toBe('failed');
  });

  it('no puede convertir en fallo algo ya publicado', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);
    const deployed = artifactOf(requestId, propertyId);

    await send(report(SECRET, { requestId, ok: true }), { deployed });
    const tarde = await send(report(SECRET, { requestId, ok: false, error: 'tarde' }), {
      deployed,
    });

    expect(tarde.status).toBe(409);
    expect(await statusOf(propertyId)).toBe('published');
    expect(await requestStatus(requestId)).toBe('done');
  });

  it('una operacion que no existe no revela nada distinto', async () => {
    const response = await send(report(SECRET, { requestId: 99_999, ok: false }));

    expect(response.status).toBe(409);
  });
});

/* -------------------------------------------------------------------------- */
/* Convivencia con lo de 5C-1 y 5C-2                                          */
/* -------------------------------------------------------------------------- */

describe('las otras dos puertas siguen funcionando', () => {
  it('el callback de un solo uso sigue cerrando una operacion', async () => {
    const propertyId = await approvedProperty();
    const { token } = await askToPublish(propertyId);

    const response = await handlePublicationCallback({
      request: new Request(`${BASE}/api/publication/callback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CALLBACK_TOKEN_HEADER]: token },
        body: JSON.stringify({ ok: true }),
      }),
      db,
    });

    expect(response.status).toBe(200);
    expect(await statusOf(propertyId)).toBe('published');
  });

  it('y despues el parte de maquina ya no aplica', async () => {
    const propertyId = await approvedProperty();
    const { requestId, token } = await askToPublish(propertyId);

    await handlePublicationCallback({
      request: new Request(`${BASE}/api/publication/callback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CALLBACK_TOKEN_HEADER]: token },
        body: JSON.stringify({ ok: true }),
      }),
      db,
    });

    const tarde = await send(report(SECRET, { requestId, ok: true }), {
      deployed: artifactOf(requestId, propertyId),
    });

    expect(tarde.status).toBe(409);
    expect(await requestStatus(requestId)).toBe('done');
  });

  it('si el parte se pierde, el admin todavia puede reconciliar', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    // El deploy ocurrio; el parte nunca llego.
    const result = await reconcilePublication(db, propertyId, artifactOf(requestId, propertyId));

    expect(result.ok && result.data.reason).toBe('applied');
    expect(await statusOf(propertyId)).toBe('published');
  });

  it('y el parte que llega tarde despues de reconciliar no cambia nada', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);
    const deployed = artifactOf(requestId, propertyId);

    await reconcilePublication(db, propertyId, deployed);
    const tarde = await send(report(SECRET, { requestId, ok: false, error: 'ups' }), { deployed });

    expect(tarde.status).toBe(409);
    expect(await statusOf(propertyId)).toBe('published');
    expect(await requestStatus(requestId)).toBe('done');
  });

  it('una operacion abandonada no la resucita el parte de maquina', async () => {
    const propertyId = await approvedProperty();
    const { requestId } = await askToPublish(propertyId);

    await db
      .update(publicationRequests)
      .set({ status: 'abandoned' })
      .where(eq(publicationRequests.id, requestId));

    const response = await send(report(SECRET, { requestId, ok: true }), {
      deployed: artifactOf(requestId, propertyId),
    });

    expect(response.status).toBe(409);
    expect(await statusOf(propertyId)).toBe('approved');
    expect(await requestStatus(requestId)).toBe('abandoned');
  });

  it('despues de un fallo de maquina se puede volver a pedir', async () => {
    const propertyId = await approvedProperty();
    const primera = await askToPublish(propertyId);

    await send(report(SECRET, { requestId: primera.requestId, ok: false }));

    const segunda = await requestPublication(db, { propertyId, action: 'publish', trigger });
    expect(segunda.ok).toBe(true);

    const rows = await db
      .select({ status: publicationRequests.status })
      .from(publicationRequests)
      .orderBy(desc(publicationRequests.id));

    expect(rows.map((row) => row.status)).toEqual(['building', 'failed']);
  });
});
