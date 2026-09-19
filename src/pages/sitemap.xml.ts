import type { APIRoute } from 'astro';
import { loadRuntimePublicSnapshot } from '../lib/public/snapshot';
import { renderSitemap, sitemapEntries } from '../lib/public/sitemap';

export const prerender = false;
export const GET: APIRoute = async ({ site }) =>
  new Response(renderSitemap(sitemapEntries(await loadRuntimePublicSnapshot()), site), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
