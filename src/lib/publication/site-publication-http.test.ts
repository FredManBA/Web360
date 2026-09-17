/**
 * La publicacion del sitio, por su API.
 *
 * Lo que se prueba aqui no es que la ruta responda, sino las dos promesas que
 * la hacen segura: que reconstruir el sitio NO mueve el estado editorial de
 * ninguna ficha, y que el candado es de todo el sistema —una operacion viva y
 * solo una, sea de una propiedad o del sitio—.
 *
 * Reutiliza el mismo pipeline que una publicacion de propiedad: mismo trigger,
 * mismo finalize, misma reconciliacion. Si alguna de esas piezas se bifurcara
 * en dos caminos, estos tests dejarian de tener sentido.
 */

import type { DatabaseSync } from 'node:sqlite';

import { desc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties, publicationRequests } from '../../db/schema';
import { createMemoryBucket, type MemoryBucket } from '../admin/media/bucket';
import { setMediaRoles } from '../admin/media/media';
import { uploadMedia } from '../admin/media/upload';
import { SAMPLE_JPEG, toArrayBuffer } from '../admin/media/test-files';
import { createPropertyDraft } from '../admin/properties/create-property';
import { updateProperty } from '../admin/properties/update-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import type { AdminBatchDatabase } from '../admin/types';
import type { AdminHttpContext } from '../admin/http/handlers';
import {
  handleAbandonSitePublication,
  handleGetSitePublication,
  handleReconcileSitePublication,
  handleRequestSitePublication,
  handleRequestPublish,
} from '../admin/http/publication-handlers';
import type { PublicationStatus } from '../domain/vocabularies';
import { handleMachineReport, MACHINE_SECRET_HEADER } from './machine-handler';
import type { ReleaseManifest } from './release';
import type { PublishTrigger, PublishTriggerJob } from './trigger';

const BASE = 'https://codeloba.test';
const SECRET = 'secreto-de-maquina-para-pruebas';

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

/** Un ejecutor que apunta lo que se le encarga, sin salir a ninguna parte. */
function spyTrigger(): { trigger: PublishTrigger; jobs: PublishTriggerJob[] } {
  const jobs: PublishTriggerJob[] = [];

  return {
    jobs,
    trigger: {
      name: 'espia',
      start: async (job) => {
        jobs.push(job);
        return { ok: true, jobRef: `espia#${job.requestId}` };
      },
    },
  };
}

/** Un ejecutor que rechaza el trabajo, para probar que no queda exito falso. */
const brokenTrigger: PublishTrigger = {
  name: 'roto',
  start: async () => ({ ok: false, error: 'el ejecutor no acepto el trabajo' }),
};

function ctx(
  request: Request,
  options: { trigger?: PublishTrigger; deployed?: ReleaseManifest | null } = {},
): AdminHttpContext {
  return {
    request,
    params: {},
    db,
    bucket,
    env: { isDev: true, ADMIN_DEV_BYPASS: 'true' },
    ...(options.trigger === undefined ? {} : { publishTrigger: options.trigger }),
    ...(options.deployed === undefined ? {} : { deployedRelease: options.deployed }),
  };
}

const req = (method: string, path = '/api/admin/publication/site', body?: unknown): Request =>
  new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: BASE },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function json(response: Response): Promise<Record<string, never>> {
  return (await response.json()) as Record<string, never>;
}

/** El manifiesto que llevaria dentro el artefacto de una release del sitio. */
function siteArtifact(requestId: number): ReleaseManifest {
  return {
    releaseId: `site-r${requestId}`,
    requestId,
    generatedAt: '2026-01-01T00:00:00.000Z',
    mediaIds: [],
  };
}

async function approvedProperty(slug = 'lote-uno'): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');

  const propertyId = created.data.id;

  await updateProperty(db, propertyId, {
    propertyTypeId: 1,
    priceMode: 'exact',
    priceAmountMinor: 9_000_000,
    currencyCode: 'USD',
    areaSquareMeters: 2100,
    province: 'Guanacaste',
    publicLatitude: 9.95,
    publicLongitude: -85.65,
  });

  await upsertPropertyTranslation(db, propertyId, { locale: 'es', slug, title: `Lote ${slug}` });

  const media = await uploadMedia(db, bucket, propertyId, {
    mediaKind: 'image',
    fileName: `${slug}.jpg`,
    declaredMimeType: 'image/jpeg',
    bytes: toArrayBuffer(SAMPLE_JPEG),
  });
  if (!media.ok) throw new Error('setup: archivo');

  await setMediaRoles(db, propertyId, media.data.id, { isHero: true, isCatalogCover: true });
  await db
    .update(properties)
    .set({ publicationStatus: 'approved' })
    .where(eq(properties.id, propertyId));

  return propertyId;
}

/** Foto del estado editorial de todas las fichas, para comparar despues. */
interface EditorialRow {
  id: number;
  status: PublicationStatus;
  publishedAt: Date | null;
}

async function editorialSnapshot(): Promise<EditorialRow[]> {
  return db
    .select({
      id: properties.id,
      status: properties.publicationStatus,
      publishedAt: properties.publishedAt,
    })
    .from(properties)
    .orderBy(properties.id);
}

async function lastSiteRequestId(): Promise<number> {
  const rows = await db
    .select({ id: publicationRequests.id })
    .from(publicationRequests)
    .where(eq(publicationRequests.action, 'publish_site'))
    .orderBy(desc(publicationRequests.id))
    .limit(1);

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('setup: sin peticion de sitio');
  return id;
}

/* -------------------------------------------------------------------------- */
/* Crear                                                                      */
/* -------------------------------------------------------------------------- */

describe('pedir que se reconstruya el sitio', () => {
  it('anota la operacion sin propiedad y la lanza', async () => {
    const espia = spyTrigger();

    const response = await handleRequestSitePublication(
      ctx(req('POST'), { trigger: espia.trigger }),
    );
    expect(response.status).toBe(200);

    const rows = await db.select().from(publicationRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.propertyId).toBeNull();
    expect(rows[0]?.action).toBe('publish_site');
    expect(rows[0]?.status).toBe('building');
  });

  it('el ejecutor recibe el numero de la operacion, que es lo unico que necesita', async () => {
    const espia = spyTrigger();

    await handleRequestSitePublication(ctx(req('POST'), { trigger: espia.trigger }));

    const id = await lastSiteRequestId();
    expect(espia.jobs).toHaveLength(1);
    expect(espia.jobs[0]?.requestId).toBe(id);
    expect(espia.jobs[0]?.propertyId).toBeNull();
    expect(espia.jobs[0]?.action).toBe('publish_site');
  });

  it('no toca ninguna ficha', async () => {
    await approvedProperty();
    const antes = await editorialSnapshot();

    await handleRequestSitePublication(ctx(req('POST'), { trigger: spyTrigger().trigger }));

    expect(await editorialSnapshot()).toEqual(antes);
  });

  it('si el ejecutor rechaza el trabajo, no queda un exito falso', async () => {
    const response = await handleRequestSitePublication(
      ctx(req('POST'), { trigger: brokenTrigger }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);

    const rows = await db.select().from(publicationRequests);
    expect(rows[0]?.status).toBe('failed');
    // Y al quedar terminal, el sistema queda libre para intentarlo otra vez.
    const estado = await json(await handleGetSitePublication(ctx(req('GET'))));
    expect((estado['data'] as never as { site: { canPublish: boolean } }).site.canPublish).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* El candado, visto desde la API                                             */
/* -------------------------------------------------------------------------- */

describe('una sola operacion viva en todo el sistema', () => {
  it('una segunda del sitio devuelve conflicto', async () => {
    const espia = spyTrigger();
    await handleRequestSitePublication(ctx(req('POST'), { trigger: espia.trigger }));

    const segunda = await handleRequestSitePublication(
      ctx(req('POST'), { trigger: espia.trigger }),
    );

    expect(segunda.status).toBe(409);
    expect(await db.select().from(publicationRequests)).toHaveLength(1);
  });

  it('una publicacion de propiedad viva bloquea la del sitio', async () => {
    const propertyId = await approvedProperty();
    const espia = spyTrigger();

    const primera = await handleRequestPublish({
      ...ctx(req('POST'), { trigger: espia.trigger }),
      params: { id: String(propertyId) },
    });
    expect(primera.status).toBe(200);

    const sitio = await handleRequestSitePublication(ctx(req('POST'), { trigger: espia.trigger }));

    expect(sitio.status).toBe(409);
    const cuerpo = await json(sitio);
    expect(JSON.stringify(cuerpo)).toContain(String(propertyId));
  });

  it('la del sitio viva bloquea la de una propiedad', async () => {
    const propertyId = await approvedProperty();
    const espia = spyTrigger();

    await handleRequestSitePublication(ctx(req('POST'), { trigger: espia.trigger }));

    const propiedad = await handleRequestPublish({
      ...ctx(req('POST'), { trigger: espia.trigger }),
      params: { id: String(propertyId) },
    });

    expect(propiedad.status).toBe(409);
  });

  it('el estado dice quien esta bloqueando', async () => {
    const propertyId = await approvedProperty();
    const espia = spyTrigger();

    await handleRequestPublish({
      ...ctx(req('POST'), { trigger: espia.trigger }),
      params: { id: String(propertyId) },
    });

    const estado = await json(await handleGetSitePublication(ctx(req('GET'))));
    const site = (estado['data'] as never as { site: Record<string, unknown> }).site;

    expect(site['canPublish']).toBe(false);
    expect(site['blockedByPropertyId']).toBe(propertyId);
    expect(site['current']).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Cerrar                                                                     */
/* -------------------------------------------------------------------------- */

describe('cerrar la publicacion del sitio', () => {
  it('el endpoint de maquina la termina sin mover ninguna ficha', async () => {
    await approvedProperty();
    await handleRequestSitePublication(ctx(req('POST'), { trigger: spyTrigger().trigger }));

    const id = await lastSiteRequestId();
    const antes = await editorialSnapshot();

    const response = await handleMachineReport({
      request: new Request(`${BASE}/api/publication/machine`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [MACHINE_SECRET_HEADER]: SECRET },
        body: JSON.stringify({ requestId: id, ok: true }),
      }),
      db,
      secret: SECRET,
      deployedRelease: siteArtifact(id),
    });

    expect(response.status).toBe(200);

    const cuerpo = (await response.json()) as { data: { publicationStatus: unknown } };
    // Ninguna ficha de la que hablar: decir 'draft' aqui seria inventarselo.
    expect(cuerpo.data.publicationStatus).toBeNull();

    const fila = await db.select().from(publicationRequests).where(eq(publicationRequests.id, id));
    expect(fila[0]?.status).toBe('done');
    expect(await editorialSnapshot()).toEqual(antes);
  });

  it('un artefacto que no es el suyo falla cerrado', async () => {
    await handleRequestSitePublication(ctx(req('POST'), { trigger: spyTrigger().trigger }));
    const id = await lastSiteRequestId();

    const response = await handleMachineReport({
      request: new Request(`${BASE}/api/publication/machine`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [MACHINE_SECRET_HEADER]: SECRET },
        body: JSON.stringify({ requestId: id, ok: true }),
      }),
      db,
      secret: SECRET,
      // El artefacto dice llevar OTRA release.
      deployedRelease: siteArtifact(id + 99),
    });

    expect(response.status).toBe(409);

    const fila = await db.select().from(publicationRequests).where(eq(publicationRequests.id, id));
    expect(fila[0]?.status).toBe('building');
  });

  it('reconciliar por el panel la cierra igual, y tampoco mueve nada', async () => {
    await approvedProperty();
    await handleRequestSitePublication(ctx(req('POST'), { trigger: spyTrigger().trigger }));

    const id = await lastSiteRequestId();
    const antes = await editorialSnapshot();

    const response = await handleReconcileSitePublication(
      ctx(req('PUT'), { deployed: siteArtifact(id) }),
    );

    expect(response.status).toBe(200);

    const fila = await db.select().from(publicationRequests).where(eq(publicationRequests.id, id));
    expect(fila[0]?.status).toBe('done');
    expect(await editorialSnapshot()).toEqual(antes);
  });

  it('reconciliar con otro artefacto no cierra nada', async () => {
    await handleRequestSitePublication(ctx(req('POST'), { trigger: spyTrigger().trigger }));
    const id = await lastSiteRequestId();

    await handleReconcileSitePublication(ctx(req('PUT'), { deployed: siteArtifact(id + 99) }));

    const fila = await db.select().from(publicationRequests).where(eq(publicationRequests.id, id));
    expect(fila[0]?.status).toBe('building');
  });

  it('abandonar la deja terminal sin afirmar que fallara, y sin tocar fichas', async () => {
    await approvedProperty();
    await handleRequestSitePublication(ctx(req('POST'), { trigger: spyTrigger().trigger }));

    const id = await lastSiteRequestId();
    const antes = await editorialSnapshot();

    const response = await handleAbandonSitePublication(
      ctx(req('DELETE', '/api/admin/publication/site', { reason: 'se perdio el aviso' })),
    );

    expect(response.status).toBe(200);

    const fila = await db.select().from(publicationRequests).where(eq(publicationRequests.id, id));
    expect(fila[0]?.status).toBe('abandoned');
    expect(fila[0]?.errorSummary).toContain('se perdio el aviso');
    expect(await editorialSnapshot()).toEqual(antes);
  });

  it('no se abandona lo que el artefacto ya demuestra: se reconcilia', async () => {
    await handleRequestSitePublication(ctx(req('POST'), { trigger: spyTrigger().trigger }));
    const id = await lastSiteRequestId();

    const response = await handleAbandonSitePublication(
      ctx(req('DELETE'), { deployed: siteArtifact(id) }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);

    const fila = await db.select().from(publicationRequests).where(eq(publicationRequests.id, id));
    expect(fila[0]?.status).toBe('building');
  });

  it('cerrarla libera el sistema para la siguiente', async () => {
    const espia = spyTrigger();
    await handleRequestSitePublication(ctx(req('POST'), { trigger: espia.trigger }));

    await handleAbandonSitePublication(ctx(req('DELETE')));

    const otra = await handleRequestSitePublication(ctx(req('POST'), { trigger: espia.trigger }));
    expect(otra.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Control                                                                    */
/* -------------------------------------------------------------------------- */

describe('la foto del estado editorial', () => {
  /*
   * Sin esto, cada `expect(await editorialSnapshot()).toEqual(antes)` podria
   * estar pasando porque la foto no mira nada. Aqui se comprueba que SI
   * detecta un cambio de verdad.
   */
  it('detecta un cambio cuando lo hay', async () => {
    const propertyId = await approvedProperty();
    const antes = await editorialSnapshot();

    await db
      .update(properties)
      .set({ publicationStatus: 'published', publishedAt: new Date(1_700_000_000_000) })
      .where(eq(properties.id, propertyId));

    const despues = await editorialSnapshot();

    expect(despues).not.toEqual(antes);
    expect(despues[0]?.status).toBe('published');
    expect(despues[0]?.publishedAt).not.toBeNull();
  });
});
