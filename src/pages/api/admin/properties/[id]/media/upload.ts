import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleUploadMedia } from '../../../../../../lib/admin/http/media-handlers';

export const prerender = false;

export const POST: APIRoute = (context) => handleUploadMedia(toAdminContext(context));
