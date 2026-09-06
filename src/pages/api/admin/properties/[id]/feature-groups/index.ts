import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleCreateFeatureGroup } from '../../../../../../lib/admin/http/feature-handlers';

export const prerender = false;

export const POST: APIRoute = (context) => handleCreateFeatureGroup(toAdminContext(context));
