/**
 * Origen del snapshot publico.
 *
 * Este modulo se ejecuta en NODE, durante el build, dentro del proceso de
 * Vite. No forma parte de ninguna pagina ni llega al Worker.
 *
 * Por que hace falta separarlo: el adaptador de Cloudflare prerenderiza las
 * paginas dentro de workerd, no en Node, asi que una pagina NO puede abrir el
 * fichero de la base local. Se lee aqui y el resultado se inyecta como modulo
 * virtual, de modo que al prerenderizar ya son datos, no una consulta.
 *
 * Y como se adapta luego a D1 remoto: lo unico atado al entorno local es
 * `readLocalSnapshot`. Cuando exista publicacion contra la base remota, esa
 * funcion pasa a leer de donde toque (un volcado de `wrangler d1 export`, la
 * API de D1, o el JSON que deje el flujo de publicacion) y ni las paginas ni
 * el read model cambian.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import * as schema from '../../db/schema';
import type { AdminDatabase } from '../admin/types';
import { buildPublicSnapshot, EMPTY_SNAPSHOT, type PublicSnapshot } from './read-model';

/** Donde deja Miniflare la base local de D1. */
const LOCAL_D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

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
