import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../lib/admin/http/astro';
import { handleCreateProperty, handleListProperties } from '../../../../lib/admin/http/handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleListProperties(toAdminContext(context));
export const POST: APIRoute = (context) => handleCreateProperty(toAdminContext(context));
