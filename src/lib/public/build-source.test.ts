/**
 * Tests de la frontera de datos del build.
 *
 * Aqui se decide de donde salen las filas con las que se genera el sitio, y
 * eso tiene dos consecuencias que se prueban con insistencia:
 *
 * - un build que no puede leer sus datos debe MORIR, no salir vacio. Un sitio
 *   sin catalogo desplegado por accidente es peor que un build roto;
 * - construir la version de una operacion concreta no puede depender de lo que
 *   diga el entorno mas alla del numero de peticion: la propiedad y la accion
 *   salen de la base.
 *
 * El camino remoto se prueba con `fetch` inyectado. No se toca la red, no hay
 * credenciales de verdad y no se crea ningun recurso.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { createRemoteD1, readRemoteConfig, RemoteD1Error } from './d1-remote';
import {
  BuildDataError,
  readBuildData,
  readPublicationRequestId,
  readSourceKind,
} from './snapshot-source';

/* -------------------------------------------------------------------------- */
/* Base de pruebas en disco                                                   */
/* -------------------------------------------------------------------------- */

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
  temporary.length = 0;
});

const MIGRATIONS = path.resolve(process.cwd(), 'drizzle');
const SEPARATOR = '--> statement-breakpoint';

/**
 * Una base real, en un fichero, con las migraciones aplicadas.
 *
 * En disco y no en memoria porque lo que se prueba es justo el camino que abre
 * un fichero: el que usa el build local.
 */
function databaseFile(fill: (sqlite: DatabaseSync) => void): string {
  const root = mkdtempSync(path.join(tmpdir(), 'codeloba-build-'));
  temporary.push(root);

  const file = path.join(root, 'datos.sqlite');
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA foreign_keys = ON');

  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    for (const statement of readFileSync(path.join(MIGRATIONS, name), 'utf8').split(SEPARATOR)) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) sqlite.exec(trimmed);
    }
  }

  fill(sqlite);
  sqlite.close();

  return file;
}

/** Una propiedad completa y publicable, escrita a pelo. */
function seedProperty(
  sqlite: DatabaseSync,
  options: { id: number; code: string; slug: string; status: string },
): void {
  sqlite.exec(
    `INSERT INTO property_types (id, system_key, is_active) VALUES (1, 'lot', 1)
     ON CONFLICT(id) DO NOTHING`,
  );
  sqlite.exec(
    `INSERT INTO property_type_translations (property_type_id, locale, name)
     VALUES (1, 'es', 'Lote') ON CONFLICT DO NOTHING`,
  );

  sqlite.exec(
    `INSERT INTO properties (
       id, code, property_type_id, publication_status, commercial_status,
       price_mode, price_amount_minor, currency_code, area_square_meters,
       location_precision, public_latitude, public_longitude, show_when_sold, is_featured
     ) VALUES (
       ${options.id}, '${options.code}', 1, '${options.status}', 'available',
       'exact', 9000000, 'USD', 2500,
       'approximate', 9.95, -85.65, 1, 0
     )`,
  );

  sqlite.exec(
    `INSERT INTO property_translations (property_id, locale, slug, title)
     VALUES (${options.id}, 'es', '${options.slug}', 'Lote de prueba')`,
  );

  sqlite.exec(
    `INSERT INTO property_media (
       id, property_id, media_kind, source_provider, object_key, sort_order,
       is_hero, is_catalog_cover
     ) VALUES (
       ${options.id * 10}, ${options.id}, 'image', 'r2',
       'propiedades/${options.id}/foto.jpg', 0, 1, 1
     )`,
  );
}

function seedRequest(
  sqlite: DatabaseSync,
  options: { id: number; propertyId: number; action: string; status?: string },
): void {
  sqlite.exec(
    `INSERT INTO publication_requests (id, property_id, action, status, callback_token_hash)
     VALUES (${options.id}, ${options.propertyId}, '${options.action}',
             '${options.status ?? 'building'}', 'hash-${options.id}')`,
  );
}

/* -------------------------------------------------------------------------- */
/* Lectura del entorno                                                        */
/* -------------------------------------------------------------------------- */

describe('el entorno del build', () => {
  it('por defecto se lee en local', () => {
    expect(readSourceKind({})).toBe('local');
    expect(readSourceKind({ CODELOBA_D1_SOURCE: '' })).toBe('local');
    expect(readSourceKind({ CODELOBA_D1_SOURCE: 'LOCAL' })).toBe('local');
  });

  it('el origen remoto hay que pedirlo explicitamente', () => {
    expect(readSourceKind({ CODELOBA_D1_SOURCE: 'remote' })).toBe('remote');
  });

  it('un origen que no existe no se interpreta a la ligera', () => {
    expect(() => readSourceKind({ CODELOBA_D1_SOURCE: 'produccion' })).toThrow(BuildDataError);
  });

  it('la peticion a construir es opcional, pero si esta debe ser un entero', () => {
    expect(readPublicationRequestId({})).toBeNull();
    expect(readPublicationRequestId({ CODELOBA_PUBLICATION_REQUEST: '7' })).toBe(7);

    for (const raw of ['0', '-3', 'siete', '1.5']) {
      expect(() => readPublicationRequestId({ CODELOBA_PUBLICATION_REQUEST: raw })).toThrow(
        BuildDataError,
      );
    }
  });

  it('sin ninguna variable de Cloudflare no hay configuracion remota', () => {
    expect(readRemoteConfig({})).toBeNull();
  });

  it('media configuracion es un despiste, y se dice cual falta', () => {
    expect(() => readRemoteConfig({ CF_ACCOUNT_ID: 'cuenta' })).toThrow(/CF_D1_DATABASE_ID/);
    expect(() => readRemoteConfig({ CF_ACCOUNT_ID: 'cuenta' })).toThrow(/CF_API_TOKEN/);
  });
});

/* -------------------------------------------------------------------------- */
/* Build local                                                                */
/* -------------------------------------------------------------------------- */

describe('build local', () => {
  it('sin base local construye un catalogo vacio y sin manifiesto', async () => {
    const data = await readBuildData({}, { databaseFile: null });

    expect(data.snapshot.properties.es).toEqual([]);
    expect(data.manifest).toBeNull();
  });

  it('lee la base local y no afirma pertenecer a ninguna release', async () => {
    const file = databaseFile((sqlite) => {
      seedProperty(sqlite, { id: 1, code: 'QA-001', slug: 'lote-uno', status: 'published' });
    });

    const data = await readBuildData({}, { databaseFile: file });

    expect(data.snapshot.properties.es).toHaveLength(1);
    expect(data.manifest).toBeNull();
  });

  it('una base ilegible aborta el build en vez de salir vacia', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'codeloba-roto-'));
    temporary.push(root);

    const file = path.join(root, 'roto.sqlite');
    // Un fichero que existe pero no es una base: leerlo tiene que doler.
    new DatabaseSync(file).close();

    await expect(readBuildData({}, { databaseFile: file })).rejects.toThrow(BuildDataError);
  });
});

/* -------------------------------------------------------------------------- */
/* Version candidata                                                          */
/* -------------------------------------------------------------------------- */

describe('build de una version candidata', () => {
  it('construye la candidata de la peticion y la identifica', async () => {
    const file = databaseFile((sqlite) => {
      seedProperty(sqlite, { id: 1, code: 'QA-001', slug: 'lote-uno', status: 'approved' });
      seedRequest(sqlite, { id: 4, propertyId: 1, action: 'publish' });
    });

    const data = await readBuildData({ CODELOBA_PUBLICATION_REQUEST: '4' }, { databaseFile: file });

    expect(data.manifest?.requestId).toBe(4);
    expect(data.manifest?.releaseId).toBe('publish-p1-r4');

    // El HTML de esa version ya contiene la propiedad, todavia sin publicarla.
    expect(data.snapshot.properties.es).toHaveLength(1);
    expect(data.manifest?.mediaIds).toEqual([10]);
  });

  it('la retirada deja fuera la propiedad y sus archivos', async () => {
    const file = databaseFile((sqlite) => {
      seedProperty(sqlite, { id: 1, code: 'QA-001', slug: 'lote-uno', status: 'published' });
      seedProperty(sqlite, { id: 2, code: 'QA-002', slug: 'lote-dos', status: 'published' });
      seedRequest(sqlite, { id: 9, propertyId: 2, action: 'unpublish' });
    });

    const data = await readBuildData({ CODELOBA_PUBLICATION_REQUEST: '9' }, { databaseFile: file });

    expect(data.snapshot.properties.es.map((p) => p.code)).toEqual(['QA-001']);
    expect(data.manifest?.mediaIds).toEqual([10]);
    expect(data.manifest?.releaseId).toBe('unpublish-p2-r9');
  });

  it('el manifiesto solo contiene los archivos que el HTML referencia', async () => {
    const file = databaseFile((sqlite) => {
      seedProperty(sqlite, { id: 1, code: 'QA-001', slug: 'lote-uno', status: 'approved' });
      seedRequest(sqlite, { id: 1, propertyId: 1, action: 'publish' });
    });

    const data = await readBuildData({ CODELOBA_PUBLICATION_REQUEST: '1' }, { databaseFile: file });

    const referenced = JSON.stringify(data.snapshot).match(/\/media\/(\d+)/g) ?? [];
    const ids = [...new Set(referenced.map((url) => Number(url.replace('/media/', ''))))].sort();

    expect(data.manifest?.mediaIds).toEqual(ids);
  });

  it('una peticion que no existe aborta el build', async () => {
    const file = databaseFile((sqlite) => {
      seedProperty(sqlite, { id: 1, code: 'QA-001', slug: 'lote-uno', status: 'approved' });
    });

    await expect(
      readBuildData({ CODELOBA_PUBLICATION_REQUEST: '77' }, { databaseFile: file }),
    ).rejects.toThrow(BuildDataError);
  });

  it('una peticion ya cerrada no se puede volver a construir', async () => {
    const file = databaseFile((sqlite) => {
      seedProperty(sqlite, { id: 1, code: 'QA-001', slug: 'lote-uno', status: 'approved' });
      seedRequest(sqlite, { id: 3, propertyId: 1, action: 'publish', status: 'done' });
    });

    await expect(
      readBuildData({ CODELOBA_PUBLICATION_REQUEST: '3' }, { databaseFile: file }),
    ).rejects.toThrow(BuildDataError);
  });

  it('una peticion que ya no encaja con el estado de su propiedad aborta', async () => {
    const file = databaseFile((sqlite) => {
      // Pide publicar, pero alguien la devolvio a borrador entretanto.
      seedProperty(sqlite, { id: 1, code: 'QA-001', slug: 'lote-uno', status: 'draft' });
      seedRequest(sqlite, { id: 5, propertyId: 1, action: 'publish' });
    });

    await expect(
      readBuildData({ CODELOBA_PUBLICATION_REQUEST: '5' }, { databaseFile: file }),
    ).rejects.toThrow(/draft/);
  });

  it('cambiar la variable solo puede apuntar a otra peticion, no a otra propiedad', async () => {
    const file = databaseFile((sqlite) => {
      seedProperty(sqlite, { id: 1, code: 'QA-001', slug: 'lote-uno', status: 'approved' });
      seedProperty(sqlite, { id: 2, code: 'QA-002', slug: 'lote-dos', status: 'draft' });
      seedRequest(sqlite, { id: 1, propertyId: 1, action: 'publish' });
    });

    const data = await readBuildData({ CODELOBA_PUBLICATION_REQUEST: '1' }, { databaseFile: file });

    // La propiedad la dice la peticion; el borrador sigue sin salir.
    expect(data.snapshot.properties.es.map((p) => p.code)).toEqual(['QA-001']);
  });

  it('sin base local no se construye una version de publicacion', async () => {
    await expect(
      readBuildData({ CODELOBA_PUBLICATION_REQUEST: '1' }, { databaseFile: null }),
    ).rejects.toThrow(BuildDataError);
  });
});

/* -------------------------------------------------------------------------- */
/* D1 de produccion                                                           */
/* -------------------------------------------------------------------------- */

/** Un `fetch` que responde como la API de D1, sin red. */
function fakeD1(
  answer: (sql: string, params: unknown[]) => unknown[][],
  calls: { url: string; headers: Record<string, string>; body: string }[] = [],
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    const payload = JSON.parse(body) as { sql: string; params: unknown[] };

    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
    });

    return new Response(
      JSON.stringify({
        success: true,
        errors: [],
        result: [{ results: { columns: [], rows: answer(payload.sql, payload.params) } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

const REMOTE_ENV = {
  CODELOBA_D1_SOURCE: 'remote',
  CF_ACCOUNT_ID: 'cuenta-de-prueba',
  CF_D1_DATABASE_ID: 'base-de-prueba',
  CF_API_TOKEN: 'token-de-prueba',
};

describe('build contra D1 de produccion', () => {
  it('consulta la API de D1 con el token en la cabecera', async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];

    const data = await readBuildData(REMOTE_ENV, {
      fetchImpl: fakeD1(() => [], calls),
      apiBase: 'https://api.example.test/client/v4',
    });

    expect(data.snapshot.properties.es).toEqual([]);
    expect(data.manifest).toBeNull();

    const first = calls[0];
    expect(first?.url).toBe(
      'https://api.example.test/client/v4/accounts/cuenta-de-prueba/d1/database/base-de-prueba/raw',
    );
    expect(first?.headers.authorization).toBe('Bearer token-de-prueba');
    // El secreto viaja en la cabecera, nunca en la URL ni en el cuerpo.
    expect(first?.url).not.toContain('token-de-prueba');
    expect(first?.body).not.toContain('token-de-prueba');
  });

  it('pedir remoto sin credenciales aborta el build', async () => {
    await expect(readBuildData({ CODELOBA_D1_SOURCE: 'remote' })).rejects.toThrow(BuildDataError);
  });

  it('con credenciales a medias tambien aborta', async () => {
    await expect(
      readBuildData({ CODELOBA_D1_SOURCE: 'remote', CF_ACCOUNT_ID: 'cuenta' }),
    ).rejects.toThrow(BuildDataError);
  });

  it('un error de la API aborta el build en vez de generar un sitio vacio', async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ success: false, errors: [{ message: 'sin permisos' }] }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    await expect(readBuildData(REMOTE_ENV, { fetchImpl: failing })).rejects.toThrow(BuildDataError);
  });

  it('una caida de red tambien aborta, sin filtrar el token', async () => {
    const offline = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(readBuildData(REMOTE_ENV, { fetchImpl: offline })).rejects.toThrow(
      /no se pudo leer la D1 de producción/,
    );

    await readBuildData(REMOTE_ENV, { fetchImpl: offline }).catch((error: unknown) => {
      expect(String(error)).not.toContain('token-de-prueba');
    });
  });

  it('el cliente remoto no traga una respuesta sin resultado', async () => {
    const empty = (async () =>
      new Response(JSON.stringify({ success: true, errors: [], result: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const db = createRemoteD1({
      accountId: 'c',
      databaseId: 'd',
      apiToken: 't',
      fetchImpl: empty,
    });

    /* Drizzle envuelve el error del driver; el motivo real va en `cause`. */
    await expect(db.run('SELECT 1' as never)).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && error.cause instanceof RemoteD1Error,
    );
  });
});
