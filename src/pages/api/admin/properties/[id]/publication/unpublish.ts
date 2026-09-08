import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleRequestUnpublish } from '../../../../../../lib/admin/http/publication-handlers';

export const prerender = false;

/** Pide retirar. La propiedad sigue publicada hasta la confirmacion. */
export const POST: APIRoute = (context) => handleRequestUnpublish(toAdminContext(context));
