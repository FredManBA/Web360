/**
 * Lectura de la D1 de produccion durante el build.
 *
 * Se ejecuta en NODE, en el proceso de Vite. No entra en el bundle ni llega
 * al Worker: nada de lo que hay aqui —y desde luego ninguna credencial— viaja
 * en el artefacto.
 *
 * Por que la API HTTP y no otra cosa. El build corre fuera de Cloudflare, asi
 * que no hay binding `DB` al que agarrarse; el endpoint REST de D1 es la via
 * oficial y solo necesita `fetch`, que Node 24 ya trae. No se anade ninguna
 * dependencia, no hace falta un servicio intermedio y no se crea ningun
 * recurso: esto solo LEE.
 *
 * Se usa `/raw` y no `/query` a proposito: `/raw` devuelve las filas como
 * arrays de valores en el orden de las columnas, que es exactamente lo que
 * espera el driver proxy de Drizzle. Con `/query` habria que reconstruir ese
 * orden a mano, y equivocarse ahi seria un error silencioso.
 *
 * Las credenciales solo salen del entorno. El token debe ser de SOLO LECTURA
 * sobre D1; este modulo nunca escribe.
 */

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import * as schema from '../../db/schema';
import type { AdminDatabase } from '../admin/types';

/** Variables que configuran el acceso remoto. Nombres, no valores. */
export const REMOTE_ENV_KEYS = {
  accountId: 'CF_ACCOUNT_ID',
  databaseId: 'CF_D1_DATABASE_ID',
  apiToken: 'CF_API_TOKEN',
} as const;

export interface RemoteD1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
  /** Punto de entrada, inyectable para poder probar sin red. */
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

const DEFAULT_API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * Error de la frontera de datos remota.
 *
 * Lleva un mensaje utilizable, y NUNCA el token: un fallo de red no puede
 * acabar imprimiendo la credencial en el log del build.
 */
export class RemoteD1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteD1Error';
  }
}

export type EnvLike = Record<string, string | undefined>;

/**
 * Lee la configuracion del entorno.
 *
 * Devuelve `null` cuando no hay ninguna de las tres variables: eso no es un
 * error, es "aqui no se construye contra produccion". Que falte SOLO alguna
 * si lo es, y se dice cual: media configuracion es casi siempre un despiste,
 * y seguir adelante en local sin avisar seria peor.
 */
export function readRemoteConfig(env: EnvLike): RemoteD1Config | null {
  const accountId = env[REMOTE_ENV_KEYS.accountId]?.trim() ?? '';
  const databaseId = env[REMOTE_ENV_KEYS.databaseId]?.trim() ?? '';
  const apiToken = env[REMOTE_ENV_KEYS.apiToken]?.trim() ?? '';

  if (accountId.length === 0 && databaseId.length === 0 && apiToken.length === 0) return null;

  const missing = Object.entries(REMOTE_ENV_KEYS)
    .filter(([key]) => {
      const value = { accountId, databaseId, apiToken }[key as keyof typeof REMOTE_ENV_KEYS];
      return value.length === 0;
    })
    .map(([, name]) => name);

  if (missing.length > 0) {
    throw new RemoteD1Error(`falta configuracion para leer D1 remota: ${missing.join(', ')}`);
  }

  return { accountId, databaseId, apiToken };
}

interface RawResult {
  results?: { columns?: string[]; rows?: unknown[][] };
}

interface RawResponse {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: RawResult[];
}

/** Un mensaje de error legible a partir de la respuesta de la API. */
function describeFailure(status: number, body: RawResponse | null): string {
  const first = body?.errors?.[0]?.message;

  if (first !== undefined && first.length > 0) return `D1 respondio ${status}: ${first}`;
  return `D1 respondio ${status}`;
}

/**
 * Una base Drizzle que consulta la D1 remota por HTTP.
 *
 * Cualquier fallo lanza. Es deliberado: quien construye el sitio prefiere no
 * tener sitio a tener uno con medio catalogo.
 */
export function createRemoteD1(config: RemoteD1Config): AdminDatabase {
  const doFetch = config.fetchImpl ?? fetch;
  const url = `${config.apiBase ?? DEFAULT_API_BASE}/accounts/${config.accountId}/d1/database/${config.databaseId}/raw`;

  const run = async (sql: string, params: unknown[]): Promise<unknown[][]> => {
    let response: Response;

    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
      });
    } catch (error) {
      // El detalle de red se resume: nunca se incluye la peticion ni el token.
      throw new RemoteD1Error(
        `no se pudo contactar con D1: ${error instanceof Error ? error.message : 'error de red'}`,
      );
    }

    let body: RawResponse | null;
    try {
      body = (await response.json()) as RawResponse;
    } catch {
      // Una respuesta que ni siquiera es JSON se trata como fallo, no se ignora.
      body = null;
    }

    if (!response.ok || body?.success !== true) {
      throw new RemoteD1Error(describeFailure(response.status, body));
    }

    const first = body.result?.[0];
    if (first === undefined) {
      throw new RemoteD1Error('D1 no devolvio ningun resultado.');
    }

    return first.results?.rows ?? [];
  };

  return drizzle<typeof schema>(
    async (sql, params, method) => {
      const rows = await run(sql, params);

      if (method === 'run') return { rows: [] };
      return method === 'get' ? { rows: rows[0] ?? [] } : { rows };
    },
    { schema },
  );
}
