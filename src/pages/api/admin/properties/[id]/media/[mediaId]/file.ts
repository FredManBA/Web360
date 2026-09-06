import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../../lib/admin/http/astro';
import { handleGetMediaFile } from '../../../../../../../lib/admin/http/media-handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleGetMediaFile(toAdminContext(context));
