import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../lib/admin/http/astro';
import { handleGetDeployedRelease } from '../../../../lib/admin/http/publication-handlers';

export const prerender = false;

/** Que version de publicacion esta ejecutando el artefacto que responde. */
export const GET: APIRoute = (context) => handleGetDeployedRelease(toAdminContext(context));
