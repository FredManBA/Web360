import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import {
  handleGetReview,
  handleRequestReview,
} from '../../../../../../lib/admin/http/review-handlers';

export const prerender = false;

export const GET: APIRoute = (context) => handleGetReview(toAdminContext(context));
export const POST: APIRoute = (context) => handleRequestReview(toAdminContext(context));
