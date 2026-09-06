import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleCreateMediaGroup } from '../../../../../../lib/admin/http/media-handlers';

export const prerender = false;

export const POST: APIRoute = (context) => handleCreateMediaGroup(toAdminContext(context));
