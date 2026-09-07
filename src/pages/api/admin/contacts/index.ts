import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../lib/admin/http/astro';
import { handleListContacts } from '../../../../lib/admin/http/contact-handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleListContacts(toAdminContext(context));
