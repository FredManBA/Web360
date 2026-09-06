import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../../lib/admin/http/astro';
import { handleCreateTourNode } from '../../../../../../../lib/admin/http/tour-handlers';

export const prerender = false;

export const POST: APIRoute = (context) => handleCreateTourNode(toAdminContext(context));
