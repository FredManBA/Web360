/**
 * El sitemap y el `robots.txt`.
 *
 * Las dos cosas se construyen del MISMO snapshot que genera el sitio, asi que
 * lo que aparece aqui es exactamente lo que existe como pagina: no hay una
 * segunda lista que mantener, ni forma de que una propiedad retirada siga
 * anunciandose.
 *
 * Lo privado no se excluye "quitandolo de la lista": es que nunca entra. El
 * panel, la revision, las APIs y los archivos no son paginas del snapshot, y
 * las propiedades que no son publicas tampoco estan en el. Un `robots.txt` no
 * protege nada —quien quiera entrar no lo lee—, y por eso el panel sigue
 * detras de Access: esto solo evita que un buscador pierda el tiempo.
 *
 * El dominio. Un sitemap exige URLs absolutas: es su formato. Mientras el
 * proyecto no declare `site` no se puede escribir ninguna sin inventar un
 * host, asi que el sitemap sale vacio y se explica por que. El dia que haya
 * dominio se llena solo.
 */

import type { Locale } from '../domain/vocabularies';
import { absoluteUrl, homeHref, otherLocale, sectionPaths } from './seo';
import { catalogueOf, type PublicSnapshot } from './read-model';

/** Rutas que nunca deben ofrecerse a un buscador. */
export const DISALLOWED_PATHS = ['/admin', '/api', '/review', '/media'] as const;

export interface SitemapEntry {
  /** Ruta de la pagina, sin dominio. */
  path: string;
  locale: Locale;
  /** La misma pagina en el otro idioma, si existe. */
  alternatePath: string | null;
}

/**
 * Todo lo indexable, en orden estable.
 *
 * Primero las paginas fijas de cada idioma y despues las fichas, que es el
 * orden en el que alguien las recorreria.
 */
export function sitemapEntries(snapshot: PublicSnapshot): SitemapEntry[] {
  const entries: SitemapEntry[] = [];

  for (const locale of ['es', 'en'] as const) {
    const other = otherLocale(locale);

    for (const [index, path] of sectionPaths(locale).entries()) {
      entries.push({
        path,
        locale,
        // Las paginas fijas existen en los dos idiomas, en el mismo orden.
        alternatePath: sectionPaths(other)[index] ?? null,
      });
    }
  }

  for (const locale of ['es', 'en'] as const) {
    const other = otherLocale(locale);
    const twins = catalogueOf(snapshot, other);

    for (const property of catalogueOf(snapshot, locale)) {
      entries.push({
        path: property.href,
        locale,
        /*
         * Se emparejan por CODIGO, que es lo unico publico que comparten las
         * dos versiones. Sin gemela no se declara alternate: apuntar a una
         * traduccion que no existe es peor que no apuntar a nada.
         */
        alternatePath: twins.find((twin) => twin.code === property.code)?.href ?? null,
      });
    }
  }

  return entries;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * El XML del sitemap.
 *
 * Sin dominio devuelve un sitemap vacio y valido, con un comentario que dice
 * por que. Es lo unico honesto: un `<loc>` relativo no lo acepta el formato, y
 * uno con un host inventado apuntaria a un sitio que no es este.
 */
export function renderSitemap(entries: SitemapEntry[], site: URL | undefined): string {
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  const open =
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:xhtml="http://www.w3.org/1999/xhtml">';

  if (site === undefined) {
    return [
      header,
      '<!-- Sin dominio configurado (`site` en astro.config.mjs) no se pueden',
      '     escribir URLs absolutas, que es lo unico que admite un sitemap. -->',
      open,
      '</urlset>',
      '',
    ].join('\n');
  }

  const urls = entries.map((entry) => {
    const alternates =
      entry.alternatePath === null
        ? []
        : [
            `    <xhtml:link rel="alternate" hreflang="${entry.locale}" href="${escapeXml(absoluteUrl(site, entry.path))}" />`,
            `    <xhtml:link rel="alternate" hreflang="${otherLocale(entry.locale)}" href="${escapeXml(absoluteUrl(site, entry.alternatePath))}" />`,
          ];

    return [
      '  <url>',
      `    <loc>${escapeXml(absoluteUrl(site, entry.path))}</loc>`,
      ...alternates,
      '  </url>',
    ].join('\n');
  });

  return [header, open, ...urls, '</urlset>', ''].join('\n');
}

/**
 * El `robots.txt`.
 *
 * Abre lo publico, cierra lo que no es para buscadores y apunta al sitemap
 * solo cuando existe una URL absoluta que dar. Sin dominio se omite esa linea
 * en vez de escribir una ruta relativa, que ningun buscador aceptaria.
 */
export function renderRobots(site: URL | undefined): string {
  const lines = ['User-agent: *', 'Allow: /'];

  for (const path of DISALLOWED_PATHS) lines.push(`Disallow: ${path}/`);

  if (site !== undefined) {
    lines.push('', `Sitemap: ${absoluteUrl(site, '/sitemap.xml')}`);
  }

  return `${lines.join('\n')}\n`;
}

/** La portada del idioma por defecto, para el `x-default`. */
export const DEFAULT_HOME = homeHref('es');
