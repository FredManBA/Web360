import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import {
  handleDeleteFeatureGroup,
  handleUpdateFeatureGroup,
} from '../../../../../../lib/admin/http/feature-handlers';

export const prerender = false;

export const PATCH: APIRoute = (context) => handleUpdateFeatureGroup(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleDeleteFeatureGroup(toAdminContext(context));
