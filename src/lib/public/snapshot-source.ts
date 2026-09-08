/**
 * Origen de los datos del build.
 *
 * Este modulo se ejecuta en NODE, durante el build, dentro del proceso de
 * Vite. No forma parte de ninguna pagina ni llega al Worker.
 *
 * Por que hace falta separarlo: el adaptador de Cloudflare prerenderiza las
 * paginas dentro de workerd, no en Node, asi que una pagina NO puede abrir el
 * fichero de la base local. Se lee aqui y el resultado se inyecta como modulo
 * virtual, de modo que al prerenderizar ya son datos, no una consulta.
 *
 * Es la FRONTERA de datos, y solo eso: el read model no sabe de donde vienen
 * las filas. Por eso ampliar el origen —local o D1 de produccion— se hace
 * entero aqui y `buildPublicSnapshot` sigue igual.
 *
 * Dos ejes, independientes entre si:
 *
 * - DE DONDE se lee: la base local de Miniflare (lo normal) o la D1 de
 *   produccion por su API HTTP (`CODELOBA_D1_SOURCE=remote`);
 * - QUE se construye: el sitio publico de siempre, o la version candidata de
 *   una operacion de publicacion concreta (`CODELOBA_PUBLICATION_REQUEST`).
 *
 * Y una regla que no se negocia: un build que no puede leer sus datos FALLA.
 * La unica tolerancia es la de siempre —un clon recien hecho sin base local
 * construye un catalogo vacio, que es la verdad—, y no se aplica ni al origen
 * remoto ni a una version candidata, donde un sitio vacio seria una mentira
 * desplegada.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import * as schema from '../../db/schema';
import type { AdminDatabase } from '../admin/types';
import { buildRequestedRelease } from '../publication/candidate';
import type { ReleaseManifest } from '../publication/release';
import { createRemoteD1, readRemoteConfig, RemoteD1Error, type EnvLike } from './d1-remote';
import { buildPublicSnapshot, EMPTY_SNAPSHOT, type PublicSnapshot } from './read-model';

/** Donde deja Miniflare la base local de D1. */
const LOCAL_D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

/** Variables que gobiernan el build. Nombres, no valores. */
export const BUILD_ENV_KEYS = {
  source: 'CODELOBA_D1_SOURCE',
  publicationRequest: 'CODELOBA_PUBLICATION_REQUEST',
} as const;

/**
 * Lo que el build necesita saber del mundo.
 *
 * El manifiesto es `null` en un build normal: solo una version candidata
 * afirma pertenecer a una operacion de publicacion, y afirmarlo sin serlo
 * seria justo lo que hay que evitar.
 */
export interface BuildData {
  snapshot: PublicSnapshot;
  manifest: ReleaseManifest | null;
}

/** Fallo de la frontera de datos. Aborta el build. */
export class BuildDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildDataError';
  }
}

/**
 * Localiza el fichero de la base local buscando hacia arriba.
 *
 * Devuelve `null` si no hay ninguna: un clon recien hecho, o una integracion
 * continua, deben poder construir el sitio sin base. En ese caso el catalogo
 * sale vacio, que es la verdad.
 */
export function findLocalDatabaseFile(start: string = process.cwd()): string | null {
  let current = path.resolve(start);

  for (;;) {
    const directory = path.join(current, LOCAL_D1_DIR);

    if (existsSync(directory)) {
      const candidates = readdirSync(directory)
        .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
        .sort();

      const first = candidates[0];
      if (first !== undefined) return path.join(directory, first);
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Abre la base local en SOLO LECTURA.
 *
 * Mismo montaje que usan los tests: `node:sqlite` de Node 24 con el driver
 * proxy de Drizzle. Sin dependencias nuevas y con el esquema real.
 */
function openLocalDatabase(file: string): { db: AdminDatabase; close: () => void } {
  const sqlite = new DatabaseSync(file, { readOnly: true });

  const db = drizzle<typeof schema>(
    (sql, params, method) => {
      const statement = sqlite.prepare(sql);

      if (method === 'run') {
        statement.run(...(params as never[]));
        return Promise.resolve({ rows: [] });
      }

      // sqlite-proxy espera las filas como arrays de valores, no objetos.
      statement.setReturnArrays(true);
      const rows = statement.all(...(params as never[])) as unknown as unknown[][];

      return Promise.resolve(method === 'get' ? { rows: rows[0] ?? [] } : { rows });
    },
    { schema },
  );

  return { db, close: () => sqlite.close() };
}

/**
 * Lee la base local y construye el snapshot publico.
 *
 * Nunca lanza: si la base no esta o esta a medias, el catalogo sale vacio y se
 * avisa. Un catalogo vacio en silencio seria peor que uno vacio explicado, y
 * romper el build entero por una base local ausente seria peor todavia.
 */
export async function readLocalSnapshot(): Promise<PublicSnapshot> {
  const file = findLocalDatabaseFile();

  if (file === null) {
    console.warn('[snapshot] sin base local de D1: el catálogo público se genera vacío.');
    return EMPTY_SNAPSHOT;
  }

  try {
    const { db, close } = openLocalDatabase(file);

    try {
      return await buildPublicSnapshot(db);
    } finally {
      close();
    }
  } catch (error) {
    console.warn(
      `[snapshot] no se pudo leer la base local: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EMPTY_SNAPSHOT;
  }
}

/* -------------------------------------------------------------------------- */
/* Origen                                                                     */
/* -------------------------------------------------------------------------- */

export type SourceKind = 'local' | 'remote';

export interface SourceOptions {
  /** Punto de inyeccion para probar el camino remoto sin red. */
  fetchImpl?: typeof fetch;
  apiBase?: string;
  /**
   * Base local concreta, en vez de la que se encuentre subiendo desde el
   * directorio actual; `null` para decir "aqui no hay ninguna". Solo lo usan
   * las pruebas.
   */
  databaseFile?: string | null;
}

export function readSourceKind(env: EnvLike): SourceKind {
  const value = env[BUILD_ENV_KEYS.source]?.trim().toLowerCase() ?? '';

  if (value.length === 0 || value === 'local') return 'local';
  if (value === 'remote') return 'remote';

  throw new BuildDataError(
    `${BUILD_ENV_KEYS.source} solo admite "local" o "remote" (llego "${value}").`,
  );
}

/** El numero de peticion que se esta construyendo, si lo hay. */
export function readPublicationRequestId(env: EnvLike): number | null {
  const raw = env[BUILD_ENV_KEYS.publicationRequest]?.trim() ?? '';
  if (raw.length === 0) return null;

  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BuildDataError(
      `${BUILD_ENV_KEYS.publicationRequest} debe ser un entero positivo (llego "${raw}").`,
    );
  }

  return id;
}

/**
 * Abre el origen que pida el entorno.
 *
 * Que el acceso remoto sea EXPLICITO y no automatico es deliberado: tener las
 * credenciales exportadas en la terminal no puede significar que un build de
 * desarrollo se ponga a leer produccion sin que nadie lo haya pedido.
 */
async function openSource(
  env: EnvLike,
  options: SourceOptions,
): Promise<{ db: AdminDatabase | null; close: () => void; kind: SourceKind }> {
  const kind = readSourceKind(env);

  if (kind === 'remote') {
    const config = readRemoteConfig(env);

    if (config === null) {
      throw new BuildDataError(
        `se pidio ${BUILD_ENV_KEYS.source}=remote pero no hay credenciales de Cloudflare en el entorno.`,
      );
    }

    return {
      db: createRemoteD1({
        ...config,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.apiBase === undefined ? {} : { apiBase: options.apiBase }),
      }),
      close: () => {},
      kind,
    };
  }

  const file = options.databaseFile === undefined ? findLocalDatabaseFile() : options.databaseFile;
  if (file === null) return { db: null, close: () => {}, kind };

  const opened = openLocalDatabase(file);

  return { db: opened.db, close: opened.close, kind };
}

/**
 * Todo lo que el build necesita, leido una sola vez.
 *
 * Lanza `BuildDataError` cuando no se puede responder con la verdad. El unico
 * caso tolerado sigue siendo el de siempre: build normal, en local, sin base.
 */
export async function readBuildData(
  env: EnvLike = process.env,
  options: SourceOptions = {},
): Promise<BuildData> {
  let requestId: number | null;
  let source;

  try {
    requestId = readPublicationRequestId(env);
    source = await openSource(env, options);
  } catch (error) {
    if (error instanceof BuildDataError) throw error;
    if (error instanceof RemoteD1Error) throw new BuildDataError(error.message);
    throw error;
  }

  const { db, close, kind } = source;

  try {
    if (db === null) {
      if (requestId !== null) {
        throw new BuildDataError(
          'no hay base local de D1: no se puede construir una versión de publicación.',
        );
      }

      console.warn('[snapshot] sin base local de D1: el catálogo público se genera vacío.');
      return { snapshot: EMPTY_SNAPSHOT, manifest: null };
    }

    if (requestId === null) {
      return {
        snapshot: await buildDataOrFail(() => buildPublicSnapshot(db), kind),
        manifest: null,
      };
    }

    const candidate = await buildDataOrFail(() => buildRequestedRelease(db, requestId), kind);

    if (!candidate.ok) {
      throw new BuildDataError(
        `no se puede construir la operación ${requestId}: ${candidate.error.message}`,
      );
    }

    console.info(
      `[snapshot] versión candidata ${candidate.data.manifest.releaseId} ` +
        `(${candidate.data.manifest.mediaIds.length} archivos).`,
    );

    return { snapshot: candidate.data.snapshot, manifest: candidate.data.manifest };
  } finally {
    close();
  }
}

/**
 * Ejecuta una lectura y traduce su fallo.
 *
 * Un fallo del origen remoto aborta; uno de la base local tambien, porque
 * llegados aqui la base EXISTE y no ha podido leerse, que es un problema de
 * verdad y no un clon sin datos.
 */
async function buildDataOrFail<T>(read: () => Promise<T>, kind: SourceKind): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    throw new BuildDataError(
      kind === 'remote'
        ? `no se pudo leer la D1 de producción: ${detail}`
        : `no se pudo leer la base local: ${detail}`,
    );
  }
}
