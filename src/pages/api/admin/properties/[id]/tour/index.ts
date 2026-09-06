import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleGetTour } from '../../../../../../lib/admin/http/tour-handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleGetTour(toAdminContext(context));
