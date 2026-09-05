import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../lib/admin/http/astro';
import { handleGetProperty, handleUpdateProperty } from '../../../../lib/admin/http/handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleGetProperty(toAdminContext(context));
export const PATCH: APIRoute = (context) => handleUpdateProperty(toAdminContext(context));
