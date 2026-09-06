/**
 * Tests HTTP de caracteristicas.
 *
 * Se invocan los handlers reales con `Request` reales sobre SQLite real. No se
 * repiten los tests de dominio: aqui se comprueba la adaptacion HTTP.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { createMemoryBucket } from '../media/bucket';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import { createPropertyDraft } from '../properties/create-property';
import {
  handleCreateFeature,
  handleCreateFeatureGroup,
  handleDeleteFeature,
  handleDeleteFeatureGroup,
  handleGetFeatures,
  handleReorderFeatureGroups,
  handleReorderFeatures,
  handleUpdateFeature,
  handleUpdateFeatureGroup,
} from './feature-handlers';
import type { AdminHttpContext } from './handlers';

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
  return new Request(`${BASE}/api/admin/properties/1/features`, {
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

async function dataOf(response: Response): Promise<Record<string, never>> {
  const body = (await response.json()) as { data: Record<string, never> };
  return body.data;
}

async function newGroup(id: string, nameEs = 'Terreno'): Promise<number> {
  const response = await handleCreateFeatureGroup(ctx(jsonRequest('POST', { nameEs }), { id }));
  const data = (await response.json()) as { data: { id: number } };
  return data.data.id;
}

async function newFeature(id: string, body: Record<string, unknown> = {}): Promise<number> {
  const response = await handleCreateFeature(ctx(jsonRequest('POST', body), { id }));
  const data = (await response.json()) as { data: { id: number } };
  return data.data.id;
}

/* -------------------------------------------------------------------------- */
/* Acceso                                                                     */
/* -------------------------------------------------------------------------- */

describe('acceso', () => {
  it('(26) sin autenticacion responde 403', async () => {
    const id = await newProperty();

    const responses = [
      await handleGetFeatures(ctx(new Request(`${BASE}/x`), { id }, false)),
      await handleCreateFeatureGroup(ctx(jsonRequest('POST', {}), { id }, false)),
      await handleCreateFeature(ctx(jsonRequest('POST', {}), { id }, false)),
      await handleDeleteFeature(ctx(jsonRequest('DELETE'), { id, featureId: '1' }, false)),
    ];

    for (const response of responses) expect(response.status).toBe(403);
  });

  it('(37) rechaza una escritura cross-origin', async () => {
    const id = await newProperty();
    const request = jsonRequest('POST', { nameEs: 'X' }, { origin: 'https://atacante.test' });

    const response = await handleCreateFeatureGroup(ctx(request, { id }));

    expect(response.status).toBe(403);
  });

  it('(39) todas las respuestas llevan Cache-Control: no-store', async () => {
    const id = await newProperty();

    const responses = [
      await handleGetFeatures(ctx(new Request(`${BASE}/x`), { id })),
      await handleGetFeatures(ctx(new Request(`${BASE}/x`), { id: '99999' })),
      await handleCreateFeatureGroup(ctx(jsonRequest('POST', {}), { id })),
      await handleGetFeatures(ctx(new Request(`${BASE}/x`), { id }, false)),
    ];

    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toContain('application/json');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Lectura                                                                    */
/* -------------------------------------------------------------------------- */

describe('GET features', () => {
  it('(25) devuelve la estructura completa', async () => {
    const id = await newProperty();
    const groupId = await newGroup(id, 'Terreno');
    await newFeature(id, { groupId, labelEs: 'Vista al mar', valueEs: 'Sí' });
    await newFeature(id, { labelEs: 'Sin grupo' });

    const response = await handleGetFeatures(ctx(new Request(`${BASE}/x`), { id }));

    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      ok: boolean;
      data: { groups: { features: unknown[] }[]; ungrouped: unknown[] };
    };

    expect(data.ok).toBe(true);
    expect(data.data.groups).toHaveLength(1);
    expect(data.data.groups[0]?.features).toHaveLength(1);
    expect(data.data.ungrouped).toHaveLength(1);
  });

  it('(33) un id invalido responde 422', async () => {
    for (const id of ['abc', '0', '-1', '']) {
      const response = await handleGetFeatures(ctx(new Request(`${BASE}/x`), { id }));
      expect(response.status).toBe(422);
    }
  });

  it('(34) una propiedad inexistente responde 404', async () => {
    const response = await handleGetFeatures(ctx(new Request(`${BASE}/x`), { id: '99999' }));

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

describe('grupos por HTTP', () => {
  it('(27) POST crea el grupo y responde 201', async () => {
    const id = await newProperty();
    const response = await handleCreateFeatureGroup(
      ctx(jsonRequest('POST', { nameEs: 'Terreno', nameEn: 'Land' }), { id }),
    );

    expect(response.status).toBe(201);
    const data = await dataOf(response);
    expect(data).toHaveProperty('id');
  });

  it('POST admite cuerpo vacio', async () => {
    const id = await newProperty();
    const request = new Request(`${BASE}/x`, { method: 'POST' });

    expect((await handleCreateFeatureGroup(ctx(request, { id }))).status).toBe(201);
  });

  it('(28) PATCH actualiza el grupo', async () => {
    const id = await newProperty();
    const groupId = await newGroup(id);

    const response = await handleUpdateFeatureGroup(
      ctx(jsonRequest('PATCH', { nameEs: 'Terreno y accesos', sortOrder: 3 }), {
        id,
        groupId: String(groupId),
      }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { data: { sortOrder: number } };
    expect(data.data.sortOrder).toBe(3);
  });

  it('(29) DELETE elimina el grupo sin exigir cuerpo', async () => {
    const id = await newProperty();
    const groupId = await newGroup(id);

    const request = new Request(`${BASE}/x`, { method: 'DELETE' });
    const response = await handleDeleteFeatureGroup(ctx(request, { id, groupId: String(groupId) }));

    expect(response.status).toBe(200);
  });

  it('(35) un grupo inexistente responde 404', async () => {
    const id = await newProperty();
    const response = await handleUpdateFeatureGroup(
      ctx(jsonRequest('PATCH', { nameEs: 'X' }), { id, groupId: '99999' }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('feature_group_not_found');
  });

  it('un grupo de otra propiedad responde 422', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const groupId = await newGroup(first);

    const response = await handleUpdateFeatureGroup(
      ctx(jsonRequest('PATCH', { nameEs: 'X' }), { id: second, groupId: String(groupId) }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('feature_group_property_mismatch');
  });

  it('(33) un groupId invalido responde 422', async () => {
    const id = await newProperty();
    const response = await handleDeleteFeatureGroup(
      ctx(new Request(`${BASE}/x`, { method: 'DELETE' }), { id, groupId: 'abc' }),
    );

    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Caracteristicas                                                            */
/* -------------------------------------------------------------------------- */

describe('caracteristicas por HTTP', () => {
  it('(30) POST crea y responde 201', async () => {
    const id = await newProperty();
    const response = await handleCreateFeature(
      ctx(jsonRequest('POST', { labelEs: 'Vista al mar', valueEs: 'Sí' }), { id }),
    );

    expect(response.status).toBe(201);
  });

  it('(31) PATCH actualiza', async () => {
    const id = await newProperty();
    const featureId = await newFeature(id, { labelEs: 'Frente' });

    const response = await handleUpdateFeature(
      ctx(jsonRequest('PATCH', { valueEs: '80 m' }), { id, featureId: String(featureId) }),
    );

    expect(response.status).toBe(200);
  });

  it('(32) DELETE elimina', async () => {
    const id = await newProperty();
    const featureId = await newFeature(id);

    const response = await handleDeleteFeature(
      ctx(new Request(`${BASE}/x`, { method: 'DELETE' }), { id, featureId: String(featureId) }),
    );

    expect(response.status).toBe(200);
  });

  it('(36) una caracteristica inexistente responde 404', async () => {
    const id = await newProperty();
    const response = await handleUpdateFeature(
      ctx(jsonRequest('PATCH', { labelEs: 'X' }), { id, featureId: '99999' }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('feature_not_found');
  });

  it('un grupo de otra propiedad responde 422', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const foreignGroup = await newGroup(first);

    const response = await handleCreateFeature(
      ctx(jsonRequest('POST', { groupId: foreignGroup }), { id: second }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('feature_group_property_mismatch');
  });

  it('(38) un content-type no JSON se rechaza', async () => {
    const id = await newProperty();
    const request = new Request(`${BASE}/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'labelEs=Vista',
    });

    const response = await handleCreateFeature(ctx(request, { id }));

    expect(response.status).toBe(415);
  });

  it('un JSON invalido responde 400', async () => {
    const id = await newProperty();
    const request = new Request(`${BASE}/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ roto',
    });

    expect((await handleCreateFeature(ctx(request, { id }))).status).toBe(400);
  });

  it('la propiedad la define la URL: propertyId en el cuerpo se rechaza', async () => {
    const id = await newProperty();

    for (const body of [{ propertyId: 99 }, { property_id: 99 }, { inventado: 1 }]) {
      const response = await handleCreateFeature(ctx(jsonRequest('POST', body), { id }));
      expect(response.status).toBe(422);
    }
  });

  it('un sortOrder no numerico se rechaza', async () => {
    const id = await newProperty();
    const response = await handleCreateFeature(
      ctx(jsonRequest('POST', { sortOrder: 'primero' }), { id }),
    );

    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Errores internos                                                           */
/* -------------------------------------------------------------------------- */

describe('errores inesperados', () => {
  it('(40) no filtran SQL, tablas ni stack traces', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const brokenDb = {
      select: () => {
        throw new Error(
          'SQLITE_ERROR: no such table: property_features\n    at Statement.all (node:sqlite:120:15)',
        );
      },
    } as unknown as AdminBatchDatabase;

    const response = await handleGetFeatures({
      request: new Request(`${BASE}/x`),
      params: { id: '1' },
      db: brokenDb,
      bucket: createMemoryBucket(),
      env: { isDev: true, ADMIN_DEV_BYPASS: 'true' },
    });

    expect(response.status).toBe(500);

    const text = await response.text();
    expect(text).not.toContain('SQLITE');
    expect(text).not.toContain('no such table');
    expect(text).not.toContain('property_features');
    expect(text).not.toContain('node:sqlite');
    expect(text).not.toContain('at Statement');

    const body = JSON.parse(text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toBe('Error interno del servidor.');
    expect(response.headers.get('cache-control')).toBe('no-store');

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */
/* Reordenacion                                                               */
/* -------------------------------------------------------------------------- */

describe('endpoints de orden', () => {
  it('(24) PUT de grupos aplica el orden completo', async () => {
    const id = await newProperty();
    const first = await newGroup(id, 'A');
    const second = await newGroup(id, 'B');

    const response = await handleReorderFeatureGroups(
      ctx(jsonRequest('PUT', { groupIds: [second, first] }), { id }),
    );

    expect(response.status).toBe(200);

    const view = await handleGetFeatures(ctx(jsonRequest('GET'), { id }));
    const data = (await view.json()) as { data: { groups: { id: number }[] } };
    expect(data.data.groups.map((group) => group.id)).toEqual([second, first]);
  });

  it('(25)(26) PUT de caracteristicas admite un grupo y tambien "Sin grupo"', async () => {
    const id = await newProperty();
    const groupId = await newGroup(id, 'Terreno');

    const inGroup = await newFeature(id, { groupId });
    const alsoInGroup = await newFeature(id, { groupId });
    const loose = await newFeature(id, {});
    const alsoLoose = await newFeature(id, {});

    const grouped = await handleReorderFeatures(
      ctx(jsonRequest('PUT', { groupId, featureIds: [alsoInGroup, inGroup] }), { id }),
    );
    expect(grouped.status).toBe(200);

    const ungrouped = await handleReorderFeatures(
      ctx(jsonRequest('PUT', { groupId: null, featureIds: [alsoLoose, loose] }), { id }),
    );
    expect(ungrouped.status).toBe(200);

    const view = await handleGetFeatures(ctx(jsonRequest('GET'), { id }));
    const data = (await view.json()) as {
      data: { groups: { features: { id: number }[] }[]; ungrouped: { id: number }[] };
    };

    expect(data.data.groups[0]?.features.map((f) => f.id)).toEqual([alsoInGroup, inGroup]);
    expect(data.data.ungrouped.map((f) => f.id)).toEqual([alsoLoose, loose]);
  });

  it('(30) una lista que no coincide devuelve 409 y no cambia nada', async () => {
    const id = await newProperty();
    const first = await newGroup(id, 'A');
    const second = await newGroup(id, 'B');

    const response = await handleReorderFeatureGroups(
      ctx(jsonRequest('PUT', { groupIds: [second] }), { id }),
    );

    expect(response.status).toBe(409);

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('feature_order_conflict');

    const view = await handleGetFeatures(ctx(jsonRequest('GET'), { id }));
    const data = (await view.json()) as { data: { groups: { id: number }[] } };
    expect(data.data.groups.map((group) => group.id)).toEqual([first, second]);
  });

  it('el cuerpo es estricto: no admite propertyId', async () => {
    const id = await newProperty();

    const response = await handleReorderFeatureGroups(
      ctx(jsonRequest('PUT', { groupIds: [], propertyId: 99 }), { id }),
    );

    expect(response.status).toBe(422);
  });

  it('los identificadores deben ser enteros positivos', async () => {
    const id = await newProperty();

    const response = await handleReorderFeatures(
      ctx(jsonRequest('PUT', { groupId: null, featureIds: [0] }), { id }),
    );

    expect(response.status).toBe(422);
  });

  it('el grupo es obligatorio y explicito en el cuerpo', async () => {
    const id = await newProperty();

    const response = await handleReorderFeatures(
      ctx(jsonRequest('PUT', { featureIds: [] }), { id }),
    );

    expect(response.status).toBe(422);
  });

  it('sin acceso administrativo no se puede reordenar', async () => {
    const id = await newProperty();

    const response = await handleReorderFeatureGroups(
      ctx(jsonRequest('PUT', { groupIds: [] }), { id }, false),
    );

    expect(response.status).toBe(403);
  });

  it('(36) el conflicto no filtra SQL ni nombres de tabla', async () => {
    const id = await newProperty();
    await newGroup(id, 'A');

    const response = await handleReorderFeatureGroups(
      ctx(jsonRequest('PUT', { groupIds: [] }), { id }),
    );

    const text = await response.text();
    expect(text).not.toContain('property_feature');
    expect(text).not.toContain('UPDATE');
    expect(text).not.toContain('SQLITE');
  });
});
