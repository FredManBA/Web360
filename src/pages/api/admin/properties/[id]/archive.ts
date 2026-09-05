import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../lib/admin/http/astro';
import { handleArchiveProperty } from '../../../../../lib/admin/http/handlers';

export const prerender = false;

export const POST: APIRoute = (context) => handleArchiveProperty(toAdminContext(context));
