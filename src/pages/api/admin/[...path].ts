import type { APIRoute } from 'astro';
import { toAdminContext } from '../../../lib/admin/http/astro';
import { handleAdmin } from '../../../lib/admin/http/core-handlers';
export const prerender = false;
export const ALL: APIRoute = (context) => handleAdmin(toAdminContext(context));
