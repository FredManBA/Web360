import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../../lib/admin/http/astro';
import {
  handleDeleteTourNode,
  handleUpdateTourNode,
} from '../../../../../../../lib/admin/http/tour-handlers';

export const prerender = false;

export const PATCH: APIRoute = (context) => handleUpdateTourNode(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleDeleteTourNode(toAdminContext(context));
