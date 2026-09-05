/**
 * Puente entre el contexto de Astro y la capa administrativa.
 *
 * `Astro.locals.runtime.env` fue eliminado en Astro v6: el binding se obtiene
 * ahora del modulo `cloudflare:workers`, que solo existe dentro del Worker.
 * Por eso este archivo es el unico que lo importa; handlers, guard y
 * validador se mantienen libres de dependencias del runtime y por tanto se
 * pueden probar.
 */

import { env } from 'cloudflare:workers';
import type { APIContext } from 'astro';

import { getDb } from '../../../db/client';
import type { AdminAuthEnv } from '../auth/authorize';
import type { AdminHttpContext } from './handlers';

/**
 * Variables que no se declaran en `wrangler.jsonc` a proposito.
 *
 * `ADMIN_DEV_BYPASS` no debe viajar nunca al despliegue, y el team domain y el
 * AUD de Access se cargaran cuando exista la Access Application. Al no estar
 * en la configuracion, tampoco aparecen en el tipo `Env` generado y hay que
 * leerlas con un acceso dinamico. En local llegan desde `.dev.vars`.
 */
type RuntimeVars = Record<string, string | undefined>;

export function readAdminAuthEnv(): AdminAuthEnv {
  const vars = env as unknown as RuntimeVars;

  return {
    ADMIN_DEV_BYPASS: vars.ADMIN_DEV_BYPASS,
    CF_ACCESS_TEAM_DOMAIN: vars.CF_ACCESS_TEAM_DOMAIN,
    CF_ACCESS_AUD: vars.CF_ACCESS_AUD,

    /*
     * Senal de entorno explicita. `import.meta.env.DEV` lo resuelve Vite en
     * tiempo de build: en una build productiva queda fijado a `false`, asi que
     * el bypass no puede activarse por mucho que alguien defina la variable.
     */
    isDev: import.meta.env.DEV,
  };
}

export function toAdminContext(context: APIContext): AdminHttpContext {
  return {
    request: context.request,
    params: context.params,
    db: getDb(env),
    env: readAdminAuthEnv(),
  };
}
