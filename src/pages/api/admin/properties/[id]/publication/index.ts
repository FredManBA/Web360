import type { APIRoute } from 'astro';
import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleDirectPublicationState } from '../../../../../../lib/admin/http/direct-publication-handlers';

export const prerender = false;
export const GET: APIRoute = (context) => handleDirectPublicationState(toAdminContext(context));
