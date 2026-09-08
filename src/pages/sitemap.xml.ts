import type { APIRoute } from 'astro';

import { loadPublicSnapshot } from '../lib/public/snapshot';
import { renderSitemap, sitemapEntries } from '../lib/public/sitemap';

/**
 * El sitemap sale del mismo snapshot que el sitio.
 *
 * Se prerenderiza como el resto del sitio publico: es un fichero estatico mas.
 */
export const GET: APIRoute = ({ site }) =>
  new Response(renderSitemap(sitemapEntries(loadPublicSnapshot()), site), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
