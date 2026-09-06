import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import {
  handleDeleteFeature,
  handleUpdateFeature,
} from '../../../../../../lib/admin/http/feature-handlers';

export const prerender = false;

export const PATCH: APIRoute = (context) => handleUpdateFeature(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleDeleteFeature(toAdminContext(context));
