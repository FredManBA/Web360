import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleAbandonPublication } from '../../../../../../lib/admin/http/publication-handlers';

export const prerender = false;

/**
 * Abandona la operacion viva por decision humana.
 *
 * No publica ni despublica: cierra la peticion sin afirmar que el despliegue
 * fallara, y libera la propiedad para poder pedir otra cosa.
 */
export const POST: APIRoute = (context) => handleAbandonPublication(toAdminContext(context));
