import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../lib/admin/http/astro';
import {
  handleDeleteSiteMedia,
  handleUploadSiteMedia,
} from '../../../../../lib/admin/http/settings-handlers';

export const prerender = false;

/**
 * La media global del sitio: logo, favicon, imagen social y portada.
 *
 * El hueco lo dice la ruta; el cuerpo solo lleva el archivo. Reemplazar es
 * subir otra vez sobre el mismo hueco.
 */
export const PUT: APIRoute = (context) => handleUploadSiteMedia(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleDeleteSiteMedia(toAdminContext(context));
