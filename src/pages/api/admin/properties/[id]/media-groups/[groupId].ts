import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import {
  handleDeleteMediaGroup,
  handleUpdateMediaGroup,
} from '../../../../../../lib/admin/http/media-handlers';

export const prerender = false;

export const PATCH: APIRoute = (context) => handleUpdateMediaGroup(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleDeleteMediaGroup(toAdminContext(context));
