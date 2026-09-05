import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../lib/admin/http/astro';
import { handleUpdateStatus } from '../../../../../lib/admin/http/handlers';

export const prerender = false;

export const PATCH: APIRoute = (context) => handleUpdateStatus(toAdminContext(context));
