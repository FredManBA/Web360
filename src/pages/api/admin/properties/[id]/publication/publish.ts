import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleRequestPublish } from '../../../../../../lib/admin/http/publication-handlers';

export const prerender = false;

/**
 * Pide publicar. No publica: anota la peticion y avisa a quien construye el
 * sitio. La propiedad no cambia de estado hasta que llega la confirmacion.
 */
export const POST: APIRoute = (context) => handleRequestPublish(toAdminContext(context));
