/**
 * Tests de la capa HTTP administrativa.
 *
 * Se invocan los handlers REALES con objetos `Request` reales y la base
 * SQLite del arnes de la Fase 2B. No se repiten los tests de dominio: aqui se
 * comprueba la adaptacion HTTP (acceso, cabeceras, codigos de estado, parseo
 * del cuerpo y mapeo de errores).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import {
  handleArchiveProperty,
  handleCreateProperty,
  handleCreatePropertyType,
  handleGetProperty,
  handleListProperties,
  handleListPropertyTypes,
  handleUpdateProperty,
  handleUpdateStatus,
  handleUpsertTranslation,
  type AdminHttpContext,
} from './handlers';

const BASE = 'https://panel.codeloba.test';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

/** Contexto con el bypass de desarrollo activado. */
function ctx(
  request: Request,
  params: Record<string, string | undefined> = {},
  bypass = true,
): AdminHttpContext {
  return {
    request,
    params,
    db,
    // `isDev` siempre true: lo que se prueba aqui es que la variable por si
    // sola no abre nada. El caso "produccion + bypass" vive en auth.test.ts.
    env: bypass ? { isDev: true, ADMIN_DEV_BYPASS: 'true' } : { isDev: true },
  };
}

function jsonRequest(method: string, path: string, body?: unknown, headers: HeadersInit = {}) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function readBody(response: Response): Promise<Record<string, never>> {
  return (await response.json()) as Record<string, never>;
}

async function createDraft(): Promise<number> {
  const response = await handleCreateProperty(
    ctx(jsonRequest('POST', '/api/admin/properties', {})),
  );
  const body = (await response.json()) as { data: { id: number } };
  return body.data.id;
}

/* -------------------------------------------------------------------------- */
/* Acceso                                                                     */
/* -------------------------------------------------------------------------- */

describe('guardia de acceso', () => {
  it('(1) sin bypass, la API administrativa esta cerrada', async () => {
    const response = await handleListProperties(
      ctx(new Request(`${BASE}/api/admin/properties`), {}, false),
    );

    expect(response.status).toBe(403);

    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('forbidden');
  });

  it('cierra tambien las escrituras', async () => {
    const response = await handleCreateProperty(
      ctx(jsonRequest('POST', '/api/admin/properties', {}), {}, false),
    );
    expect(response.status).toBe(403);
  });

  it('un valor distinto de "true" no abre la API', async () => {
    for (const value of ['1', 'yes', 'TRUE', '']) {
      const response = await handleListProperties({
        request: new Request(`${BASE}/api/admin/properties`),
        params: {},
        db,
        env: { isDev: true, ADMIN_DEV_BYPASS: value },
      });
      expect(response.status).toBe(403);
    }
  });

  it('(2) con el bypass explicito, permite el acceso', async () => {
    const response = await handleListProperties(ctx(new Request(`${BASE}/api/admin/properties`)));
    expect(response.status).toBe(200);
  });

  it('no se filtra informacion util en el rechazo', async () => {
    const response = await handleListProperties(
      ctx(new Request(`${BASE}/api/admin/properties`), {}, false),
    );
    const text = await response.text();

    expect(text).not.toContain('ADMIN_DEV_BYPASS');
    expect(text).not.toContain('properties');
  });
});

describe('proteccion de origen', () => {
  it('(23) rechaza una escritura cross-origin', async () => {
    const request = jsonRequest(
      'POST',
      '/api/admin/properties',
      {},
      {
        origin: 'https://atacante.test',
      },
    );

    const response = await handleCreateProperty(ctx(request));

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
  });

  it('acepta una escritura del mismo origen', async () => {
    const request = jsonRequest('POST', '/api/admin/properties', {}, { origin: BASE });
    const response = await handleCreateProperty(ctx(request));
    expect(response.status).toBe(201);
  });

  it('no bloquea lecturas cross-origin (no modifican datos)', async () => {
    const request = new Request(`${BASE}/api/admin/properties`, {
      headers: { origin: 'https://otro.test' },
    });
    const response = await handleListProperties(ctx(request));
    expect(response.status).toBe(200);
  });

  it('no emite cabeceras CORS permisivas', async () => {
    const response = await handleListProperties(ctx(new Request(`${BASE}/api/admin/properties`)));
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Cabeceras                                                                  */
/* -------------------------------------------------------------------------- */

describe('cabeceras', () => {
  it('(24) toda respuesta administrativa lleva Cache-Control: no-store', async () => {
    const id = await createDraft();

    const responses = [
      await handleListProperties(ctx(new Request(`${BASE}/api/admin/properties`))),
      await handleGetProperty(ctx(new Request(`${BASE}/x`), { id: String(id) })),
      await handleGetProperty(ctx(new Request(`${BASE}/x`), { id: '99999' })),
      await handleListProperties(ctx(new Request(`${BASE}/api/admin/properties`), {}, false)),
      await handleCreateProperty(ctx(jsonRequest('POST', '/x', {}))),
    ];

    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toContain('application/json');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Listado                                                                    */
/* -------------------------------------------------------------------------- */

describe('GET /api/admin/properties', () => {
  it('(3) devuelve la lista', async () => {
    await createDraft();
    const response = await handleListProperties(ctx(new Request(`${BASE}/api/admin/properties`)));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it('(4) acepta filtros validos', async () => {
    await createDraft();

    const response = await handleListProperties(
      ctx(new Request(`${BASE}/api/admin/properties?publicationStatus=draft`)),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: unknown[] }).data).toHaveLength(1);

    const vacio = await handleListProperties(
      ctx(new Request(`${BASE}/api/admin/properties?publicationStatus=published`)),
    );
    expect(((await vacio.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it('convierte propertyTypeId a numero', async () => {
    const response = await handleListProperties(
      ctx(new Request(`${BASE}/api/admin/properties?propertyTypeId=1`)),
    );
    expect(response.status).toBe(200);
  });

  it('(5) rechaza un filtro invalido con 422', async () => {
    const response = await handleListProperties(
      ctx(new Request(`${BASE}/api/admin/properties?publicationStatus=publicada`)),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  it('rechaza parametros desconocidos', async () => {
    const response = await handleListProperties(
      ctx(new Request(`${BASE}/api/admin/properties?buscar=lote`)),
    );
    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Creacion                                                                   */
/* -------------------------------------------------------------------------- */

describe('POST /api/admin/properties', () => {
  it('(6) crea el borrador con LOBA-001 y responde 201', async () => {
    const response = await handleCreateProperty(ctx(jsonRequest('POST', '/x', {})));

    expect(response.status).toBe(201);
    const body = (await response.json()) as { ok: boolean; data: { code: string } };
    expect(body.ok).toBe(true);
    expect(body.data.code).toBe('LOBA-001');
  });

  it('admite cuerpo vacio', async () => {
    const request = new Request(`${BASE}/x`, { method: 'POST' });
    const response = await handleCreateProperty(ctx(request));
    expect(response.status).toBe(201);
  });

  it('(7) rechaza JSON invalido con 400', async () => {
    const request = new Request(`${BASE}/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ esto no es json',
    });

    const response = await handleCreateProperty(ctx(request));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_json');
  });

  it('(8) rechaza un content-type no JSON', async () => {
    const request = new Request(`${BASE}/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'title=Lote',
    });

    const response = await handleCreateProperty(ctx(request));

    expect(response.status).toBe(415);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unsupported_media_type');
  });

  it('no permite fijar el codigo ni el estado desde el cliente', async () => {
    for (const body of [
      { code: 'HACK-001' },
      { publicationStatus: 'published' },
      { commercialStatus: 'sold' },
      { createdAt: 0 },
    ]) {
      const response = await handleCreateProperty(ctx(jsonRequest('POST', '/x', body)));
      expect(response.status).toBe(422);
    }
  });

  it('acepta tipo, idioma y titulo iniciales', async () => {
    const typeId = (
      sqlite.prepare("SELECT id FROM property_types WHERE system_key = 'lot'").get() as {
        id: number;
      }
    ).id;

    const response = await handleCreateProperty(
      ctx(jsonRequest('POST', '/x', { propertyTypeId: typeId, locale: 'es', title: 'Lote uno' })),
    );

    expect(response.status).toBe(201);
  });
});

/* -------------------------------------------------------------------------- */
/* Lectura individual                                                         */
/* -------------------------------------------------------------------------- */

describe('GET /api/admin/properties/:id', () => {
  it('devuelve la propiedad', async () => {
    const id = await createDraft();
    const response = await handleGetProperty(ctx(new Request(`${BASE}/x`), { id: String(id) }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { property: { code: string } } };
    expect(body.data.property.code).toBe('LOBA-001');
  });

  it('(9) rechaza un id invalido con 422', async () => {
    for (const id of ['abc', '-1', '0', '1.5', '']) {
      const response = await handleGetProperty(ctx(new Request(`${BASE}/x`), { id }));
      expect(response.status).toBe(422);
    }
  });

  it('(10) devuelve 404 si no existe', async () => {
    const response = await handleGetProperty(ctx(new Request(`${BASE}/x`), { id: '99999' }));

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Actualizacion                                                              */
/* -------------------------------------------------------------------------- */

describe('PATCH /api/admin/properties/:id', () => {
  it('(11) actualiza y responde 200', async () => {
    const id = await createDraft();
    const response = await handleUpdateProperty(
      ctx(jsonRequest('PATCH', '/x', { locality: 'Jaco', isFeatured: true }), { id: String(id) }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { locality: string; isFeatured: boolean } };
    expect(body.data.locality).toBe('Jaco');
    expect(body.data.isFeatured).toBe(true);
  });

  it('(12) rechaza un campo prohibido con 422', async () => {
    const id = await createDraft();

    for (const body of [
      { publicationStatus: 'published' },
      { id: 5 },
      { createdAt: 0 },
      { publishedAt: 0 },
      { campoInventado: 1 },
    ]) {
      const response = await handleUpdateProperty(
        ctx(jsonRequest('PATCH', '/x', body), { id: String(id) }),
      );
      expect(response.status).toBe(422);
    }
  });

  it('(13) devuelve 409 si el codigo ya existe', async () => {
    const first = await createDraft();
    const second = await createDraft();

    const firstCode = (
      sqlite.prepare('SELECT code FROM properties WHERE id = ?').get(first) as { code: string }
    ).code;

    const response = await handleUpdateProperty(
      ctx(jsonRequest('PATCH', '/x', { code: firstCode }), { id: String(second) }),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; field: string } };
    expect(body.error.code).toBe('code_taken');
    expect(body.error.field).toBe('code');
  });

  it('devuelve 422 con detalle cuando el precio es incoherente', async () => {
    const id = await createDraft();
    const response = await handleUpdateProperty(
      ctx(jsonRequest('PATCH', '/x', { priceMode: 'exact' }), { id: String(id) }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; details: { issues: { path: string }[] } };
    };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('devuelve 404 si la propiedad no existe', async () => {
    const response = await handleUpdateProperty(
      ctx(jsonRequest('PATCH', '/x', { isFeatured: true }), { id: '99999' }),
    );
    expect(response.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* Traducciones                                                               */
/* -------------------------------------------------------------------------- */

describe('PUT /api/admin/properties/:id/translations/:locale', () => {
  it('(14) crea la traduccion espanola', async () => {
    const id = await createDraft();
    const response = await handleUpsertTranslation(
      ctx(jsonRequest('PUT', '/x', { title: 'Lote con vista al mar' }), {
        id: String(id),
        locale: 'es',
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { slug: string; locale: string } };
    expect(body.data.locale).toBe('es');
    expect(body.data.slug).toBe('lote-con-vista-al-mar');
  });

  it('el ingles usa el mismo endpoint y la misma forma de respuesta', async () => {
    const id = await createDraft();
    const response = await handleUpsertTranslation(
      ctx(jsonRequest('PUT', '/x', { title: 'Sea view lot' }), { id: String(id), locale: 'en' }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { locale: string } };
    expect(body.data.locale).toBe('en');
  });

  it('(15) rechaza un locale invalido con 422', async () => {
    const id = await createDraft();
    const response = await handleUpsertTranslation(
      ctx(jsonRequest('PUT', '/x', { title: 'X' }), { id: String(id), locale: 'fr' }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { field: string } };
    expect(body.error.field).toBe('locale');
  });

  it('(16) devuelve 409 si el slug ya esta en uso', async () => {
    const first = await createDraft();
    const second = await createDraft();

    await handleUpsertTranslation(
      ctx(jsonRequest('PUT', '/x', { slug: 'lote-vista-al-mar' }), {
        id: String(first),
        locale: 'es',
      }),
    );

    const response = await handleUpsertTranslation(
      ctx(jsonRequest('PUT', '/x', { slug: 'lote-vista-al-mar' }), {
        id: String(second),
        locale: 'es',
      }),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('slug_taken');
  });

  it('rechaza campos desconocidos en el cuerpo', async () => {
    const id = await createDraft();
    const response = await handleUpsertTranslation(
      ctx(jsonRequest('PUT', '/x', { titulo: 'X' }), { id: String(id), locale: 'es' }),
    );
    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Estado                                                                     */
/* -------------------------------------------------------------------------- */

describe('PATCH /api/admin/properties/:id/status', () => {
  it('(17) aplica una transicion valida', async () => {
    const id = await createDraft();
    const response = await handleUpdateStatus(
      ctx(jsonRequest('PATCH', '/x', { publicationStatus: 'in_review' }), { id: String(id) }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { publicationStatus: string } };
    expect(body.data.publicationStatus).toBe('in_review');
  });

  it('(18) rechaza una transicion invalida con 422', async () => {
    const id = await createDraft();
    const response = await handleUpdateStatus(
      ctx(jsonRequest('PATCH', '/x', { publicationStatus: 'approved' }), { id: String(id) }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_status_transition');
  });

  it('(19) rechaza publicar directamente', async () => {
    const id = await createDraft();
    const response = await handleUpdateStatus(
      ctx(jsonRequest('PATCH', '/x', { publicationStatus: 'published' }), { id: String(id) }),
    );

    expect(response.status).toBe(422);
  });

  it('(19) tampoco publica desde approved', async () => {
    const id = await createDraft();
    const p = { id: String(id) };

    await handleUpdateStatus(
      ctx(jsonRequest('PATCH', '/x', { publicationStatus: 'in_review' }), p),
    );
    await handleUpdateStatus(ctx(jsonRequest('PATCH', '/x', { publicationStatus: 'approved' }), p));

    const response = await handleUpdateStatus(
      ctx(jsonRequest('PATCH', '/x', { publicationStatus: 'published' }), p),
    );
    expect(response.status).toBe(422);

    const row = sqlite.prepare('SELECT published_at FROM properties WHERE id = ?').get(id) as {
      published_at: number | null;
    };
    expect(row.published_at).toBeNull();
  });

  it('no permite cambiar el estado comercial por esta ruta', async () => {
    const id = await createDraft();
    const response = await handleUpdateStatus(
      ctx(jsonRequest('PATCH', '/x', { commercialStatus: 'sold' }), { id: String(id) }),
    );

    expect(response.status).toBe(422);
  });

  it('rechaza un estado inexistente', async () => {
    const id = await createDraft();
    const response = await handleUpdateStatus(
      ctx(jsonRequest('PATCH', '/x', { publicationStatus: 'publicada' }), { id: String(id) }),
    );
    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Archivado                                                                  */
/* -------------------------------------------------------------------------- */

describe('POST /api/admin/properties/:id/archive', () => {
  it('(20) archiva la propiedad', async () => {
    const id = await createDraft();
    const request = new Request(`${BASE}/x`, { method: 'POST' });
    const response = await handleArchiveProperty(ctx(request, { id: String(id) }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { publicationStatus: string } };
    expect(body.data.publicationStatus).toBe('archived');
  });

  it('archivar dos veces es idempotente', async () => {
    const id = await createDraft();
    const request = () => new Request(`${BASE}/x`, { method: 'POST' });

    await handleArchiveProperty(ctx(request(), { id: String(id) }));
    const second = await handleArchiveProperty(ctx(request(), { id: String(id) }));

    expect(second.status).toBe(200);
    const body = (await second.json()) as { data: { publicationStatus: string } };
    expect(body.data.publicationStatus).toBe('archived');
  });

  it('devuelve 404 si no existe', async () => {
    const request = new Request(`${BASE}/x`, { method: 'POST' });
    const response = await handleArchiveProperty(ctx(request, { id: '99999' }));
    expect(response.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* Tipos de propiedad                                                         */
/* -------------------------------------------------------------------------- */

describe('/api/admin/property-types', () => {
  it('(21) lista los tipos activos', async () => {
    const response = await handleListPropertyTypes(
      ctx(new Request(`${BASE}/api/admin/property-types`)),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { systemKey: string | null; names: Record<string, string> }[];
    };
    expect(body.data).toHaveLength(6);
    expect(body.data.find((t) => t.systemKey === 'lot')?.names.es).toBe('Lote');
  });

  it('(22) crea un tipo personalizado y responde 201', async () => {
    const response = await handleCreatePropertyType(
      ctx(jsonRequest('POST', '/x', { nameEs: 'Bodega', nameEn: 'Warehouse' })),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: { systemKey: string | null; names: Record<string, string> };
    };
    expect(body.data.systemKey).toBeNull();
    expect(body.data.names.es).toBe('Bodega');
    expect(body.data.names.en).toBe('Warehouse');
  });

  it('el nombre en ingles es opcional', async () => {
    const response = await handleCreatePropertyType(
      ctx(jsonRequest('POST', '/x', { nameEs: 'Bodega' })),
    );
    expect(response.status).toBe(201);
  });

  it('rechaza el nombre espanol vacio con 422', async () => {
    const response = await handleCreatePropertyType(
      ctx(jsonRequest('POST', '/x', { nameEs: '   ' })),
    );
    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Errores internos                                                           */
/* -------------------------------------------------------------------------- */

describe('errores inesperados', () => {
  it('(25) no filtran SQL, tablas ni stack traces', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Base rota a proposito: cualquier consulta lanzara un error del driver.
    const brokenDb = {
      select: () => {
        throw new Error(
          'SQLITE_ERROR: no such table: properties\n    at Statement.all (node:sqlite:120:15)',
        );
      },
    } as unknown as AdminBatchDatabase;

    const response = await handleListProperties({
      request: new Request(`${BASE}/api/admin/properties`),
      params: {},
      db: brokenDb,
      env: { isDev: true, ADMIN_DEV_BYPASS: 'true' },
    });

    expect(response.status).toBe(500);

    const text = await response.text();
    expect(text).not.toContain('SQLITE');
    expect(text).not.toContain('no such table');
    expect(text).not.toContain('properties');
    expect(text).not.toContain('node:sqlite');
    expect(text).not.toContain('at Statement');

    const body = JSON.parse(text) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toBe('Error interno del servidor.');

    // El detalle si queda registrado para desarrollo.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('la respuesta de error interno tambien lleva no-store', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const brokenDb = {
      select: () => {
        throw new Error('boom');
      },
    } as unknown as AdminBatchDatabase;

    const response = await handleListProperties({
      request: new Request(`${BASE}/api/admin/properties`),
      params: {},
      db: brokenDb,
      env: { isDev: true, ADMIN_DEV_BYPASS: 'true' },
    });

    expect(response.headers.get('cache-control')).toBe('no-store');
    consoleError.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */
/* Formato de respuesta                                                       */
/* -------------------------------------------------------------------------- */

describe('formato de respuesta', () => {
  it('el exito envuelve los datos en { ok: true, data }', async () => {
    const response = await handleListProperties(ctx(new Request(`${BASE}/api/admin/properties`)));
    const body = await readBody(response);

    expect(Object.keys(body).sort()).toEqual(['data', 'ok']);
  });

  it('el error envuelve el detalle en { ok: false, error }', async () => {
    const response = await handleGetProperty(ctx(new Request(`${BASE}/x`), { id: '99999' }));
    const body = (await response.json()) as { ok: boolean; error: Record<string, unknown> };

    expect(body.ok).toBe(false);
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
  });

  it('ningun error de negocio responde 200', async () => {
    const id = await createDraft();

    const responses = [
      await handleGetProperty(ctx(new Request(`${BASE}/x`), { id: '99999' })),
      await handleUpdateStatus(
        ctx(jsonRequest('PATCH', '/x', { publicationStatus: 'published' }), { id: String(id) }),
      ),
      await handleUpdateProperty(
        ctx(jsonRequest('PATCH', '/x', { publicationStatus: 'draft' }), { id: String(id) }),
      ),
    ];

    for (const response of responses) {
      expect(response.status).not.toBe(200);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
});
