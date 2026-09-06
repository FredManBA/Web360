import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../../lib/admin/http/astro';
import { handleCreateTourLink } from '../../../../../../../lib/admin/http/tour-handlers';

export const prerender = false;

export const POST: APIRoute = (context) => handleCreateTourLink(toAdminContext(context));
