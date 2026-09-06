import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../../lib/admin/http/astro';
import {
  handleDeleteTourLink,
  handleUpdateTourLink,
} from '../../../../../../../lib/admin/http/tour-handlers';

export const prerender = false;

export const PATCH: APIRoute = (context) => handleUpdateTourLink(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleDeleteTourLink(toAdminContext(context));
