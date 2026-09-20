import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { media, properties } from '../../db/schema';
import { getProperty, propertyMedia } from './core';
import { handleAdmin } from './http/core-handlers';
import { createMemoryBucket } from './media/bucket';
import { createTestDatabase, type TestDatabase } from './test-database';
import type { PropertyInput } from './validation';

let test: TestDatabase;
const input: PropertyInput = {
  type: 'lot',
  commercialStatus: 'available',
  featured: false,
  priceMode: 'contact',
  priceAmountMinor: null,
  currencyCode: 'USD',
  areaSquareMeters: 1200,
  province: null,
  canton: null,
  district: null,
  locality: null,
  mapLatitude: 9.9,
  mapLongitude: -84.1,
  locationPrecision: 'approximate',
  titleEs: 'Lote publicado',
  slugEs: 'lote-publicado',
  descriptionEs: null,
  detailsEs: null,
  titleEn: null,
  slugEn: null,
  descriptionEn: null,
  detailsEn: null,
  featuresJson: [],
};

beforeEach(async () => {
  test = createTestDatabase();
  await test.db.insert(properties).values({
    id: 1,
    code: 'CR360-001',
    status: 'published',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    ...input,
  });
  await test.db.insert(media).values({
    id: 1,
    propertyId: 1,
    kind: 'image',
    objectKey: 'fixture/cover.jpg',
    isCover: true,
  });
});

afterEach(() => test.close());

function request(path: string, method: string, body?: unknown) {
  return handleAdmin({
    request: new Request(`http://localhost/api/admin/${path}`, {
      method,
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    params: { path },
    db: test.db,
    bucket: createMemoryBucket(),
    env: { isDev: true, ADMIN_DEV_BYPASS: 'true' },
  });
}

describe('R2.1: invariantes de una propiedad publicada', () => {
  it('PUT sin título ES devuelve 422 e issues sin modificar la publicada', async () => {
    const before = await getProperty(test.db, 1);
    const response = await request('properties/1', 'PUT', {
      ...input,
      titleEs: null,
      descriptionEs: 'Este cambio tampoco debe persistirse',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'publication_incomplete',
        message: expect.stringContaining('propiedad publicada'),
        details: { issues: [{ path: 'titleEs', message: expect.any(String) }] },
      },
    });
    expect(await getProperty(test.db, 1)).toEqual(before);
  });

  it('PUT permite quitar el título ES de un borrador', async () => {
    await test.db.update(properties).set({ status: 'draft' }).where(eq(properties.id, 1));
    const response = await request('properties/1', 'PUT', { ...input, titleEs: null });

    expect(response.status).toBe(200);
    expect(await getProperty(test.db, 1)).toMatchObject({ status: 'draft', titleEs: null });
  });

  it('rechaza borrar la portada publicada y pide elegir otra primero', async () => {
    const before = await propertyMedia(test.db, 1);
    const response = await request('properties/1/media/1', 'DELETE');

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'media_in_use',
        message: expect.stringContaining('Primero elige otra portada'),
      },
    });
    expect(await propertyMedia(test.db, 1)).toEqual(before);
    expect((await getProperty(test.db, 1))?.status).toBe('published');
  });

  it('permite cambiar portada y borrar la anterior manteniendo la publicación', async () => {
    await test.db.insert(media).values({
      id: 2,
      propertyId: 1,
      kind: 'image',
      objectKey: 'fixture/replacement.jpg',
    });
    expect((await request('properties/1/media/2', 'PATCH', { isCover: true })).status).toBe(200);
    expect((await request('properties/1/media/1', 'DELETE')).status).toBe(200);

    const files = await propertyMedia(test.db, 1);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ id: 2, kind: 'image', isCover: true });
    expect((await getProperty(test.db, 1))?.status).toBe('published');
  });
});
