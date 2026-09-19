import type { APIRoute } from 'astro';
import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleUnpublishProperty } from '../../../../../../lib/admin/http/direct-publication-handlers';

export const prerender = false;
export const POST: APIRoute = (context) => handleUnpublishProperty(toAdminContext(context));
