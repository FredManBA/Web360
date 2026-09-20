import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { media, properties } from '../../db/schema';
import type { Tour } from '../domain/content';
import { getProperty, propertyMedia } from './core';
import { handleAdmin } from './http/core-handlers';
import { createMemoryBucket } from './media/bucket';
import { createTestDatabase, type TestDatabase } from './test-database';

let test: TestDatabase;

const node = (mediaId: number, links: Tour['nodes'][number]['links'] = []) => ({
  mediaId,
  name_es: null,
  name_en: null,
  initialView: null,
  links,
});

beforeEach(async () => {
  test = createTestDatabase();
  await test.db.insert(properties).values([
    { id: 1, code: 'CR360-001' },
    { id: 2, code: 'CR360-002' },
  ]);
  await test.db.insert(media).values([
    { id: 1, propertyId: 1, kind: 'panorama', objectKey: 'fixture/a.jpg' },
    { id: 2, propertyId: 1, kind: 'panorama', objectKey: 'fixture/b.jpg' },
    { id: 3, propertyId: 1, kind: 'image', objectKey: 'fixture/c.jpg' },
    { id: 4, propertyId: 2, kind: 'panorama', objectKey: 'fixture/d.jpg' },
  ]);
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

const twoPanoramas: Tour = {
  startMediaId: 1,
  nodes: [node(1, [{ toMediaId: 2, yaw: 1.4, pitch: -0.1 }]), node(2)],
};

describe('R3: guardado del recorrido', () => {
  it('guarda el recorrido completo en una escritura', async () => {
    const response = await request('properties/1/tour', 'PUT', { tour: twoPanoramas });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: twoPanoramas });
    expect((await getProperty(test.db, 1))?.tourJson).toEqual(twoPanoramas);
  });

  it('rechaza un panorama de otra propiedad o inexistente', async () => {
    for (const mediaId of [4, 99]) {
      const response = await request('properties/1/tour', 'PUT', {
        tour: { startMediaId: mediaId, nodes: [node(mediaId)] },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'validation_failed', message: expect.stringContaining('panoramas') },
      });
    }
    expect((await getProperty(test.db, 1))?.tourJson).toBeNull();
  });

  it('borrar un panorama del recorrido limpia el tour y la fila', async () => {
    await request('properties/1/tour', 'PUT', { tour: twoPanoramas });
    const response = await request('properties/1/media/2', 'DELETE');

    expect(response.status).toBe(200);
    expect(await propertyMedia(test.db, 1)).toHaveLength(2);
    expect((await getProperty(test.db, 1))?.tourJson).toEqual({
      startMediaId: 1,
      nodes: [node(1)],
    });
  });

  it('borrar el último panorama del recorrido lo deja sin recorrido', async () => {
    await request('properties/1/tour', 'PUT', { tour: twoPanoramas });
    await request('properties/1/media/1', 'DELETE');
    await request('properties/1/media/2', 'DELETE');

    expect((await getProperty(test.db, 1))?.tourJson).toBeNull();
  });
});
