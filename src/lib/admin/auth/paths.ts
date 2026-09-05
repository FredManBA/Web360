/**
 * Que rutas son administrativas.
 *
 * Funcion pura y separada del middleware para poder probarla: el middleware
 * importa `cloudflare:workers`, que solo existe dentro del Worker.
 */

/** Paginas del panel: `/admin` y todo lo que cuelgue de el. */
export function isAdminPagePath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** API administrativa: `/api/admin/...`. */
export function isAdminApiPath(pathname: string): boolean {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

/**
 * Superficie administrativa completa.
 *
 * Las rutas publicas (`/`, `/es/*`, `/en/*`) quedan fuera y por tanto nunca
 * ejecutan la comprobacion de Access.
 */
export function isAdminPath(pathname: string): boolean {
  return isAdminPagePath(pathname) || isAdminApiPath(pathname);
}
