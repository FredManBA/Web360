import type { APIRoute } from 'astro';

import { renderRobots } from '../lib/public/sitemap';

/**
 * `robots.txt`.
 *
 * No protege nada: es una indicacion para buscadores. Lo que de verdad cierra
 * el panel es Cloudflare Access, y lo que cierra la revision es su token.
 */
export const GET: APIRoute = ({ site }) =>
  new Response(renderRobots(site), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
