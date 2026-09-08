import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../lib/admin/http/astro';
import { handleCreateSocialLink } from '../../../../../lib/admin/http/settings-handlers';

export const prerender = false;

export const POST: APIRoute = (context) => handleCreateSocialLink(toAdminContext(context));
