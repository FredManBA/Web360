/**
 * Puente entre el contexto de Astro y los handlers administrativos.
 *
 * `Astro.locals.runtime.env` fue eliminado en Astro v6: el binding se obtiene
 * ahora del modulo `cloudflare:workers`, que solo existe dentro del Worker.
 * Por eso este archivo es el unico que lo importa; los handlers se mantienen
 * libres de dependencias del runtime y por tanto se pueden probar.
 */

import { env } from 'cloudflare:workers';
import type { APIContext } from 'astro';

import { getDb } from '../../../db/client';
import type { AdminHttpContext } from './handlers';

export function toAdminContext(context: APIContext): AdminHttpContext {
  return {
    request: context.request,
    params: context.params,
    db: getDb(env),
    /*
     * `ADMIN_DEV_BYPASS` NO se declara en `wrangler.jsonc` a proposito: si
     * estuviera en la configuracion viajaria al despliegue, que es justo lo
     * que hay que evitar. Por eso no aparece en el tipo `Env` generado y hay
     * que leerla con un acceso dinamico. En local llega desde `.dev.vars`.
     */
    env: {
      ADMIN_DEV_BYPASS: (env as unknown as Record<string, string | undefined>).ADMIN_DEV_BYPASS,
    },
  };
}
