import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../lib/admin/http/astro';
import {
  handleAbandonSitePublication,
  handleGetSitePublication,
  handleReconcileSitePublication,
  handleRequestSitePublication,
} from '../../../../lib/admin/http/publication-handlers';

export const prerender = false;

/**
 * Publicacion del sitio entero.
 *
 * Una sola ruta sin identificador: el candado global garantiza que como mucho
 * hay una operacion viva, asi que "la del sitio" no es ambigua y no hace
 * falta nombrarla en la URL.
 *
 * - `GET`    estado;
 * - `POST`   pide reconstruir el sitio;
 * - `PUT`    comprueba si la que espera ya esta desplegada;
 * - `DELETE` abandona la que espera, sin afirmar que fallara.
 */
export const GET: APIRoute = (context) => handleGetSitePublication(toAdminContext(context));
export const POST: APIRoute = (context) => handleRequestSitePublication(toAdminContext(context));
export const PUT: APIRoute = (context) => handleReconcileSitePublication(toAdminContext(context));
export const DELETE: APIRoute = (context) => handleAbandonSitePublication(toAdminContext(context));
