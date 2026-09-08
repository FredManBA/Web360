import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

import { getDb } from '../../../db/client';
import { deployedReleaseManifest } from '../../../lib/publication/deployed-release';
import {
  handleMachineReport,
  MACHINE_SECRET_ENV_KEY,
} from '../../../lib/publication/machine-handler';

export const prerender = false;

/**
 * Parte de resultado del runner que construye y despliega el sitio.
 *
 * Fuera de `/api/admin/*` a proposito: quien llama es un proceso y no puede
 * pasar por el login de Access. Su credencial es un secreto compartido que
 * vive solo en los secretos del Worker y en los de Actions.
 *
 * Cerrar como exito exige, ademas de la credencial, que el manifiesto de este
 * mismo artefacto sea el de esa operacion.
 */
export const POST: APIRoute = (context) =>
  handleMachineReport({
    request: context.request,
    db: getDb(env),
    /*
     * No se declara en `wrangler.jsonc`: es un secreto, se configura con
     * `wrangler secret put` y en local llega desde `.dev.vars`. Por eso hay
     * que leerlo con un acceso dinamico.
     */
    secret: (env as unknown as Record<string, string | undefined>)[MACHINE_SECRET_ENV_KEY],
    deployedRelease: deployedReleaseManifest(),
  });
