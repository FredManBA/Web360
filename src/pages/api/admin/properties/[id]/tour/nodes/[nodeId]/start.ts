import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../../../lib/admin/http/astro';
import { handleSetStartNode } from '../../../../../../../../lib/admin/http/tour-handlers';

export const prerender = false;

export const PUT: APIRoute = (context) => handleSetStartNode(toAdminContext(context));
