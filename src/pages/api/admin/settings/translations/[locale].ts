import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../lib/admin/http/astro';
import { handleUpdateSettingsTranslation } from '../../../../../lib/admin/http/settings-handlers';

export const prerender = false;

export const PUT: APIRoute = (context) => handleUpdateSettingsTranslation(toAdminContext(context));
