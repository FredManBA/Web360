import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../lib/admin/http/astro';
import {
  handleDeleteSocialLink,
  handleUpdateSocialLink,
} from '../../../../../lib/admin/http/settings-handlers';

export const prerender = false;

export const PATCH: APIRoute = (context) => handleUpdateSocialLink(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleDeleteSocialLink(toAdminContext(context));
