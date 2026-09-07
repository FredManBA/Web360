import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../lib/admin/http/astro';
import { handleUpdateContactStatus } from '../../../../../lib/admin/http/contact-handlers';

export const prerender = false;

export const PATCH: APIRoute = (context) => handleUpdateContactStatus(toAdminContext(context));
