import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Database = DrizzleD1Database<typeof schema>;

/**
 * Crea el cliente Drizzle sobre el binding D1 del Worker.
 *
 * El binding solo existe dentro de una peticion on-demand, asi que se llama
 * desde rutas que declaran `export const prerender = false`:
 *
 *   const db = getDb(Astro.locals.runtime.env);
 */
export function getDb(env: Env): Database {
  return drizzle(env.DB, { schema });
}
