import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleUpsertTranslation } from '../../../../../../lib/admin/http/handlers';

export const prerender = false;

export const PUT: APIRoute = (context) => handleUpsertTranslation(toAdminContext(context));
