import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../lib/admin/http/astro';
import {
  handleCreatePropertyType,
  handleListPropertyTypes,
} from '../../../../lib/admin/http/handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleListPropertyTypes(toAdminContext(context));
export const POST: APIRoute = (context) => handleCreatePropertyType(toAdminContext(context));
