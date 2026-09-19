import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { properties, publicationRequests } from '../../../db/schema';
import { createTestDatabase, applySeed, type TestDatabase } from '../test-database';
import { createMemoryBucket } from '../media/bucket';
import { uploadMedia } from '../media/upload';
import { SAMPLE_JPEG, toArrayBuffer } from '../media/test-files';
import { setMediaRoles } from '../media/media';
import { createPropertyDraft } from './create-property';
import { updateProperty } from './update-property';
import { publishProperty, unpublishProperty } from './direct-publication';
import {
  handlePublishProperty,
  handleUnpublishProperty,
} from '../http/direct-publication-handlers';
import type { AdminHttpContext } from '../http/handlers';
import { buildPublicSnapshot } from '../../public/read-model';

let test: TestDatabase;
let bucket: ReturnType<typeof createMemoryBucket>;
beforeEach(() => {
  test = createTestDatabase();
  applySeed(test.sqlite);
  bucket = createMemoryBucket();
});
afterEach(() => {
  test.close();
  vi.restoreAllMocks();
});

async function completeDraft() {
  const draft = await createPropertyDraft(test.db, { propertyTypeId: 1, title: 'Lote R1' });
  if (!draft.ok) throw new Error('fixture draft');
  const id = draft.data.id;
  expect(
    (
      await updateProperty(test.db, id, {
        areaSquareMeters: 1200,
        priceMode: 'contact',
        locationPrecision: 'approximate',
        publicLatitude: 9.9,
        publicLongitude: -84.1,
        privateLatitude: 9.87654321,
        privateLongitude: -84.98765432,
      })
    ).ok,
  ).toBe(true);
  const image = await uploadMedia(test.db, bucket, id, {
    mediaKind: 'image',
    fileName: 'fixture.jpg',
    declaredMimeType: 'image/jpeg',
    bytes: toArrayBuffer(SAMPLE_JPEG),
  });
  if (!image.ok) throw new Error('fixture image');
  expect(
    (await setMediaRoles(test.db, id, image.data.id, { isHero: true, isCatalogCover: true })).ok,
  ).toBe(true);
  return id;
}

function context(id: string, overrides: Partial<AdminHttpContext> = {}): AdminHttpContext {
  return {
    request: new Request('https://local.test/api/admin/properties/1/publication/publish', {
      method: 'POST',
      headers: { origin: 'https://local.test' },
    }),
    params: { id },
    db: test.db,
    bucket,
    env: { isDev: true, ADMIN_DEV_BYPASS: 'true' },
    ...overrides,
  };
}

describe('publicacion directa', () => {
  it('una peticion historica pendiente no bloquea ni se modifica', async () => {
    const id = await completeDraft();
    await test.db.insert(publicationRequests).values({
      propertyId: id,
      action: 'publish',
      status: 'pending',
      callbackTokenHash: 'fixture-historica-local',
    });
    expect((await handlePublishProperty(context(String(id)))).status).toBe(200);
    expect((await handleUnpublishProperty(context(String(id)))).status).toBe(200);
    expect(await test.db.select().from(publicationRequests)).toMatchObject([
      { propertyId: id, status: 'pending' },
    ]);
  });
  it('publica sin revision, no crea peticiones ni usa el trigger, y retira a draft', async () => {
    const id = await completeDraft();
    const trigger = vi.fn();
    const response = await handlePublishProperty(
      context(String(id), { publishTrigger: { name: 'unused', start: trigger } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      data: { publicationStatus: 'published', href: '/es/propiedades/lote-r1' },
    });
    expect(trigger).not.toHaveBeenCalled();
    expect(await test.db.select().from(publicationRequests)).toEqual([]);
    const [published] = await test.db.select().from(properties).where(eq(properties.id, id));
    expect(published?.publishedAt).toBeInstanceOf(Date);
    expect((await publishProperty(test.db, id)).ok).toBe(true);
    expect((await handleUnpublishProperty(context(String(id)))).status).toBe(200);
    const [draft] = await test.db.select().from(properties).where(eq(properties.id, id));
    expect(draft).toMatchObject({ publicationStatus: 'draft', publishedAt: null });
    expect((await unpublishProperty(test.db, id)).ok).toBe(true);
  });
  it('acepta los estados editoriales heredados y no restaura un archivo por accidente', async () => {
    const id = await completeDraft();
    for (const publicationStatus of ['in_review', 'approved'] as const) {
      await test.db.update(properties).set({ publicationStatus }).where(eq(properties.id, id));
      expect((await publishProperty(test.db, id)).ok).toBe(true);
    }
    await test.db
      .update(properties)
      .set({ publicationStatus: 'archived' })
      .where(eq(properties.id, id));
    expect((await handlePublishProperty(context(String(id)))).status).toBe(409);
  });
  it('devuelve todos los problemas de contenido con 422, y 404 para una propiedad inexistente', async () => {
    const draft = await createPropertyDraft(test.db);
    if (!draft.ok) throw new Error('fixture');
    const response = await handlePublishProperty(context(String(draft.data.id)));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { details: { issues: { path: string }[] } } };
    expect(body.error.details.issues.length).toBeGreaterThan(3);
    expect(body.error.details.issues.some((issue) => issue.path === 'publicationStatus')).toBe(
      false,
    );
    expect((await handlePublishProperty(context('99999'))).status).toBe(404);
    expect((await handleUnpublishProperty(context('99999'))).status).toBe(404);
  });
  it('conserva Access fail-closed y same-origin en ambas escrituras', async () => {
    const id = await completeDraft();
    for (const handler of [handlePublishProperty, handleUnpublishProperty]) {
      expect(
        (await handler(context(String(id), { env: { isDev: false, ADMIN_DEV_BYPASS: 'true' } })))
          .status,
      ).toBe(403);
      expect(
        (
          await handler(
            context(String(id), {
              request: new Request('https://local.test/x', {
                method: 'POST',
                headers: { origin: 'https://other.test' },
              }),
            }),
          )
        ).status,
      ).toBe(403);
      expect((await handler(context('1.5'))).status).toBe(422);
    }
  });
  it('reutiliza el DTO publico sin coordenadas privadas y mide sus consultas', async () => {
    const id = await completeDraft();
    const select = vi.spyOn(test.db, 'select');
    await buildPublicSnapshot(test.db);
    expect(select).toHaveBeenCalledTimes(5);
    await publishProperty(test.db, id);
    select.mockClear();
    const snapshot = await buildPublicSnapshot(test.db);
    expect(select).toHaveBeenCalledTimes(18);
    expect(snapshot.properties.es).toHaveLength(1);
    expect(snapshot.properties.en).toHaveLength(0);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /privateLatitude|privateLongitude|9\.87654321|-84\.98765432/,
    );
  });
});
