import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../../lib/admin/http/astro';
import { handleSetMediaRoles } from '../../../../../../../lib/admin/http/media-handlers';

export const prerender = false;

export const PUT: APIRoute = (context) => handleSetMediaRoles(toAdminContext(context));
