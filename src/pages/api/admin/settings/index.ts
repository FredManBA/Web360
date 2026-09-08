import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../lib/admin/http/astro';
import {
  handleGetSettings,
  handleUpdateSettings,
} from '../../../../lib/admin/http/settings-handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleGetSettings(toAdminContext(context));
export const PATCH: APIRoute = (context) => handleUpdateSettings(toAdminContext(context));
