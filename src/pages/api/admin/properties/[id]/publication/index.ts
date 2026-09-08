import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleGetPublication } from '../../../../../../lib/admin/http/publication-handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleGetPublication(toAdminContext(context));
