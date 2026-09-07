import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../lib/admin/http/astro';
import { handleDeleteContact, handleGetContact } from '../../../../lib/admin/http/contact-handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleGetContact(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleDeleteContact(toAdminContext(context));
