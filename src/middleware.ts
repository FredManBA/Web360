/**
 * Middleware de proteccion del panel.
 *
 * Cubre las PAGINAS administrativas (`/admin` y `/admin/*`). La API
 * (`/api/admin/*`) se protege en su propio envoltorio de handlers, que ya
 * resuelve la autorizacion una unica vez por peticion; hacerlo tambien aqui
 * verificaria el mismo JWT dos veces sin ganar nada.
 *
 * Las rutas publicas (`/`, `/es/*`, `/en/*`) no pasan por ninguna
 * comprobacion de Access.
 *
 * CodeLoba no construye pantalla de login: cuando exista la Access
 * Application, es el borde de Cloudflare quien presenta el login al usuario.
 * Aqui solo se deniega el paso a lo que llegue sin credencial valida.
 */

import type { MiddlewareHandler } from 'astro';

import { authorizeAdminRequest } from './lib/admin/auth/authorize';
import { isAdminPagePath } from './lib/admin/auth/paths';
import { readAdminAuthEnv } from './lib/admin/http/astro';

export const onRequest: MiddlewareHandler = async (context, next) => {
  if (!isAdminPagePath(context.url.pathname)) return next();

  const auth = await authorizeAdminRequest(context.request, readAdminAuthEnv());

  if (!auth.ok) {
    // Respuesta minima y sin diseno: la fase de UI llegara despues.
    return new Response('Acceso administrativo denegado.', {
      status: 403,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  return next();
};
