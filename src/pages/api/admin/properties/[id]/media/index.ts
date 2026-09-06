import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleCreateMedia, handleGetMedia } from '../../../../../../lib/admin/http/media-handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleGetMedia(toAdminContext(context));
export const POST: APIRoute = (context) => handleCreateMedia(toAdminContext(context));
