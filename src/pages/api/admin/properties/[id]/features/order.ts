import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleReorderFeatures } from '../../../../../../lib/admin/http/feature-handlers';

export const prerender = false;

export const PUT: APIRoute = (context) => handleReorderFeatures(toAdminContext(context));
