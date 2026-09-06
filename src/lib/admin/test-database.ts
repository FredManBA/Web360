/**
 * Base de datos de pruebas: SQLite REAL, en memoria.
 *
 * Se ejecutan las migraciones de `drizzle/` tal cual, de modo que los tests
 * corren contra el mismo esquema que produccion, con sus UNIQUE, CHECK y
 * claves foraneas de verdad. No se mockea el acceso a datos: si una consulta
 * genera SQL invalido, el test falla.
 *
 * Por que este montaje y no otro:
 *
 * - `@cloudflare/vitest-pool-workers` exige vitest ^4 y el proyecto usa 5;
 * - el `miniflare` disponible es una version alpha, y el proyecto no admite
 *   dependencias alpha.
 *
 * `node:sqlite` viene con Node 24, asi que no anade ninguna dependencia. D1
 * es SQLite, por lo que la semantica de constraints es la misma; aun asi, el
 * comportamiento sobre D1 real ya se verifico al crear cada migracion.
 */

import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import * as schema from '../../db/schema';
import type { AdminBatchDatabase } from './types';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle');
const STATEMENT_SEPARATOR = '--> statement-breakpoint';

function applyMigrations(db: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    for (const statement of sql.split(STATEMENT_SEPARATOR)) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) db.exec(trimmed);
    }
  }
}

export interface TestDatabase {
  db: AdminBatchDatabase;
  sqlite: DatabaseSync;
  close: () => void;
}

type ProxyMethod = 'run' | 'all' | 'values' | 'get';

/** Ejecuta una sentencia con la forma de filas que espera `sqlite-proxy`. */
function runStatement(
  sqlite: DatabaseSync,
  sql: string,
  params: unknown[],
  method: ProxyMethod,
): { rows: unknown[] } {
  const statement = sqlite.prepare(sql);

  if (method === 'run') {
    statement.run(...(params as never[]));
    return { rows: [] };
  }

  // sqlite-proxy espera las filas como arrays de valores, no objetos.
  statement.setReturnArrays(true);
  const rows = statement.all(...(params as never[])) as unknown as unknown[][];

  return method === 'get' ? { rows: rows[0] ?? [] } : { rows };
}

/**
 * Crea una base en memoria con el esquema aplicado.
 *
 * `PRAGMA foreign_keys = ON` es imprescindible: SQLite las trae desactivadas
 * por defecto, mientras que D1 las aplica siempre. Sin esta linea los tests
 * de integridad referencial pasarian sin comprobar nada.
 */
export function createTestDatabase(): TestDatabase {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');

  applyMigrations(sqlite);

  const db = drizzle<typeof schema>(
    (sql, params, method) => Promise.resolve(runStatement(sqlite, sql, params, method)),
    /*
     * Lote en una transaccion real. D1 envuelve cada `batch()` en una
     * transaccion implicita; aqui se reproduce con BEGIN/COMMIT para que los
     * tests comprueben la atomicidad de verdad y no solo la intencion.
     */
    (batch) => {
      sqlite.exec('BEGIN');

      try {
        const results = batch.map((item) =>
          runStatement(sqlite, item.sql, item.params, item.method),
        );
        sqlite.exec('COMMIT');
        return Promise.resolve(results);
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    { schema },
  );

  return { db, sqlite, close: () => sqlite.close() };
}

/** Aplica el seed real del proyecto, para no duplicar datos iniciales. */
export function applySeed(sqlite: DatabaseSync): void {
  const seed = readFileSync(path.resolve(process.cwd(), 'src/db/seed/seed.sql'), 'utf8');
  sqlite.exec(seed);
}
