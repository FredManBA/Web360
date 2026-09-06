import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import {
  handleCreateFeature,
  handleGetFeatures,
} from '../../../../../../lib/admin/http/feature-handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleGetFeatures(toAdminContext(context));
export const POST: APIRoute = (context) => handleCreateFeature(toAdminContext(context));
