import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleRevokeReviewLinks } from '../../../../../../lib/admin/http/review-handlers';

export const prerender = false;

export const POST: APIRoute = (context) => handleRevokeReviewLinks(toAdminContext(context));
