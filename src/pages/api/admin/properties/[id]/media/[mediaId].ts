import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import {
  handleDeleteMedia,
  handleUpdateMedia,
} from '../../../../../../lib/admin/http/media-handlers';

export const prerender = false;

export const PATCH: APIRoute = (context) => handleUpdateMedia(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleDeleteMedia(toAdminContext(context));
