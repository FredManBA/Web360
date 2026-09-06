/**
 * Tests HTTP del recorrido 360.
 *
 * Se invocan los handlers reales con `Request` reales sobre SQLite real. No se
 * repiten los tests de dominio: aqui se comprueba la adaptacion HTTP.
 */

import type { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryBucket } from '../media/bucket';
import { createMedia } from '../media/media';
import { createPropertyDraft } from '../properties/create-property';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import type { AdminHttpContext } from './handlers';
import {
  handleCreateTourLink,
  handleCreateTourNode,
  handleDeleteTourLink,
  handleDeleteTourNode,
  handleGetTour,
  handleSetStartNode,
  handleUpdateTourLink,
  handleUpdateTourNode,
} from './tour-handlers';

const BASE = 'https://panel.codeloba.test';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
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
    bucket: createMemoryBucket(),
    env: bypass ? { isDev: true, ADMIN_DEV_BYPASS: 'true' } : { isDev: true },
  };
}

function jsonRequest(method: string, body?: unknown, headers: HeadersInit = {}): Request {
  return new Request(`${BASE}/api/admin/properties/1/tour`, {
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

let keyCounter = 0;
async function newPanorama(propertyId: string): Promise<number> {
  keyCounter += 1;
  const created = await createMedia(db, Number(propertyId), {
    mediaKind: 'panorama',
    sourceProvider: 'r2',
    objectKey: `tour-http/${keyCounter}.jpg`,
  });
  if (!created.ok) throw new Error('setup: panorama');
  return created.data.id;
}

async function idOf(response: Response): Promise<number> {
  const body = (await response.json()) as { data: { id: number } };
  return body.data.id;
}

async function newNode(id: string): Promise<number> {
  const response = await handleCreateTourNode(
    ctx(jsonRequest('POST', { propertyMediaId: await newPanorama(id) }), { id }),
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
  it('sin bypass ni Access, todo el recorrido responde 403', async () => {
    const id = await newProperty();

    const responses = [
      await handleGetTour(ctx(jsonRequest('GET'), { id }, false)),
      await handleCreateTourNode(ctx(jsonRequest('POST', {}), { id }, false)),
      await handleUpdateTourNode(ctx(jsonRequest('PATCH', {}), { id, nodeId: '1' }, false)),
      await handleDeleteTourNode(ctx(jsonRequest('DELETE'), { id, nodeId: '1' }, false)),
      await handleSetStartNode(ctx(jsonRequest('PUT', {}), { id, nodeId: '1' }, false)),
      await handleCreateTourLink(ctx(jsonRequest('POST', {}), { id }, false)),
      await handleUpdateTourLink(ctx(jsonRequest('PATCH', {}), { id, linkId: '1' }, false)),
      await handleDeleteTourLink(ctx(jsonRequest('DELETE'), { id, linkId: '1' }, false)),
    ];

    for (const response of responses) expect(response.status).toBe(403);
  });

  it('una escritura cross-origin se rechaza', async () => {
    const id = await newProperty();

    const request = jsonRequest(
      'POST',
      { propertyMediaId: 1 },
      { origin: 'https://atacante.test' },
    );
    const response = await handleCreateTourNode(ctx(request, { id }));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe('forbidden');
  });

  it('todas las respuestas llevan Cache-Control: no-store', async () => {
    const id = await newProperty();
    const nodeId = String(await newNode(id));

    const responses = [
      await handleGetTour(ctx(jsonRequest('GET'), { id })),
      await handleUpdateTourNode(ctx(jsonRequest('PATCH', { nameEs: 'x' }), { id, nodeId })),
      await handleSetStartNode(ctx(jsonRequest('PUT', { isStart: true }), { id, nodeId })),
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

    const request = new Request(`${BASE}/api/admin/properties/${id}/tour/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'propertyMediaId=1',
    });

    expect((await handleCreateTourNode(ctx(request, { id }))).status).toBe(415);
  });

  it('un identificador de ruta no numerico se rechaza con 422', async () => {
    const responses = [
      await handleGetTour(ctx(jsonRequest('GET'), { id: 'abc' })),
      await handleUpdateTourNode(ctx(jsonRequest('PATCH', {}), { id: '1', nodeId: '0' })),
      await handleDeleteTourLink(ctx(jsonRequest('DELETE'), { id: '1', linkId: '-2' })),
    ];

    for (const response of responses) expect(response.status).toBe(422);
  });

  it('el cuerpo es estricto: `propertyId` se rechaza, no se ignora', async () => {
    const id = await newProperty();

    const response = await handleCreateTourNode(
      ctx(jsonRequest('POST', { propertyMediaId: await newPanorama(id), propertyId: 99 }), { id }),
    );

    expect(response.status).toBe(422);
  });

  it('el panorama de un nodo no se puede cambiar despues', async () => {
    const id = await newProperty();
    const nodeId = String(await newNode(id));

    const response = await handleUpdateTourNode(
      ctx(jsonRequest('PATCH', { propertyMediaId: 2 }), { id, nodeId }),
    );

    expect(response.status).toBe(422);
  });

  it('los extremos de un enlace no se pueden cambiar despues', async () => {
    const id = await newProperty();

    const response = await handleUpdateTourLink(
      ctx(jsonRequest('PATCH', { toNodeId: 2 }), { id, linkId: '1' }),
    );

    expect(response.status).toBe(422);
  });

  it('un FOV no positivo se rechaza en el esquema', async () => {
    const id = await newProperty();

    const response = await handleCreateTourNode(
      ctx(jsonRequest('POST', { propertyMediaId: await newPanorama(id), initialFov: 0 }), { id }),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('validation_failed');
  });

  it('marcar el inicial exige decir si o no, explicitamente', async () => {
    const id = await newProperty();
    const nodeId = String(await newNode(id));

    expect((await handleSetStartNode(ctx(jsonRequest('PUT', {}), { id, nodeId }))).status).toBe(
      422,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Ciclo completo                                                             */
/* -------------------------------------------------------------------------- */

describe('crear, leer, actualizar y borrar', () => {
  it('el ciclo completo funciona de punta a punta', async () => {
    const id = await newProperty();

    const created = await handleCreateTourNode(
      ctx(
        jsonRequest('POST', {
          propertyMediaId: await newPanorama(id),
          nameEs: 'Entrada',
          nameEn: 'Entrance',
        }),
        { id },
      ),
    );
    expect(created.status).toBe(201);

    const nodeId = await idOf(created);
    const otherNode = await newNode(id);

    const link = await handleCreateTourLink(
      ctx(jsonRequest('POST', { fromNodeId: nodeId, toNodeId: otherNode, yaw: 1.2 }), { id }),
    );
    expect(link.status).toBe(201);

    const start = await handleSetStartNode(
      ctx(jsonRequest('PUT', { isStart: true }), { id, nodeId: String(nodeId) }),
    );
    expect(start.status).toBe(200);

    const listed = await handleGetTour(ctx(jsonRequest('GET'), { id }));
    const body = (await listed.json()) as {
      ok: boolean;
      data: {
        startNodeId: number | null;
        nodes: {
          id: number;
          names: Record<string, string | null>;
          panorama: { mediaKind: string } | null;
          links: { toNodeId: number; yaw: number }[];
        }[];
      };
    };

    expect(body.ok).toBe(true);
    expect(body.data.startNodeId).toBe(nodeId);
    expect(body.data.nodes[0]?.names).toEqual({ es: 'Entrada', en: 'Entrance' });
    expect(body.data.nodes[0]?.panorama?.mediaKind).toBe('panorama');
    expect(body.data.nodes[0]?.links[0]).toMatchObject({ toNodeId: otherNode, yaw: 1.2 });

    const removedLink = await handleDeleteTourLink(
      ctx(jsonRequest('DELETE'), { id, linkId: String(await idOf(link)) }),
    );
    expect(removedLink.status).toBe(200);

    const removedNode = await handleDeleteTourNode(
      ctx(jsonRequest('DELETE'), { id, nodeId: String(nodeId) }),
    );
    expect(removedNode.status).toBe(200);
  });

  it('una propiedad inexistente devuelve 404', async () => {
    const response = await handleGetTour(ctx(jsonRequest('GET'), { id: '9999' }));

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('not_found');
  });

  it('un nodo inexistente devuelve 404', async () => {
    const id = await newProperty();

    const response = await handleUpdateTourNode(
      ctx(jsonRequest('PATCH', { nameEs: 'x' }), { id, nodeId: '9999' }),
    );

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('tour_node_not_found');
  });

  it('un enlace inexistente devuelve 404', async () => {
    const id = await newProperty();

    const response = await handleDeleteTourLink(ctx(jsonRequest('DELETE'), { id, linkId: '9999' }));

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('tour_link_not_found');
  });

  it('un archivo que no es panorama devuelve 422', async () => {
    const id = await newProperty();

    const image = await createMedia(db, Number(id), {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: 'tour-http/imagen.jpg',
    });
    if (!image.ok) throw new Error('setup');

    const response = await handleCreateTourNode(
      ctx(jsonRequest('POST', { propertyMediaId: image.data.id }), { id }),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('tour_media_not_panorama');
  });

  it('un panorama de otra propiedad devuelve 422', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const foreign = await newPanorama(second);

    const response = await handleCreateTourNode(
      ctx(jsonRequest('POST', { propertyMediaId: foreign }), { id: first }),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('tour_media_property_mismatch');
  });

  it('reutilizar un panorama ya usado devuelve 409', async () => {
    const id = await newProperty();
    const mediaId = await newPanorama(id);

    await handleCreateTourNode(ctx(jsonRequest('POST', { propertyMediaId: mediaId }), { id }));
    const second = await handleCreateTourNode(
      ctx(jsonRequest('POST', { propertyMediaId: mediaId }), { id }),
    );

    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe('tour_media_in_use');
  });

  it('un autoenlace devuelve 422', async () => {
    const id = await newProperty();
    const nodeId = await newNode(id);

    const response = await handleCreateTourLink(
      ctx(jsonRequest('POST', { fromNodeId: nodeId, toNodeId: nodeId }), { id }),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('tour_link_invalid');
  });

  it('un enlace repetido devuelve 409', async () => {
    const id = await newProperty();
    const from = await newNode(id);
    const to = await newNode(id);

    await handleCreateTourLink(
      ctx(jsonRequest('POST', { fromNodeId: from, toNodeId: to }), { id }),
    );
    const second = await handleCreateTourLink(
      ctx(jsonRequest('POST', { fromNodeId: from, toNodeId: to }), { id }),
    );

    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe('tour_link_duplicate');
  });

  it('cambiar el nodo inicial deja uno solo', async () => {
    const id = await newProperty();
    const first = String(await newNode(id));
    const second = String(await newNode(id));

    await handleSetStartNode(ctx(jsonRequest('PUT', { isStart: true }), { id, nodeId: first }));
    const swap = await handleSetStartNode(
      ctx(jsonRequest('PUT', { isStart: true }), { id, nodeId: second }),
    );

    expect(swap.status).toBe(200);

    const listed = await handleGetTour(ctx(jsonRequest('GET'), { id }));
    const body = (await listed.json()) as {
      data: { startNodeId: number; nodes: { isStart: boolean }[] };
    };

    expect(body.data.startNodeId).toBe(Number(second));
    expect(body.data.nodes.filter((node) => node.isStart)).toHaveLength(1);
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
          'SQLITE_ERROR: no such table: property_tour_nodes\n    at Statement.all (node:sqlite:120:15)',
        );
      },
    } as unknown as AdminBatchDatabase;

    const response = await handleGetTour({
      request: jsonRequest('GET'),
      params: { id: '1' },
      db: brokenDb,
      bucket: createMemoryBucket(),
      env: { isDev: true, ADMIN_DEV_BYPASS: 'true' },
    });

    expect(response.status).toBe(500);

    const text = await response.text();
    expect(text).not.toContain('SQLITE');
    expect(text).not.toContain('no such table');
    expect(text).not.toContain('property_tour');
    expect(text).not.toContain('node:sqlite');
    expect(text).not.toContain('at Statement');

    const body = JSON.parse(text) as { error: { code: string } };
    expect(body.error.code).toBe('internal_error');
    expect(response.headers.get('cache-control')).toBe('no-store');

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
