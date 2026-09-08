/**
 * Lo que cada pagina publica declara sobre si misma.
 *
 * Una sola forma —`PageSeo`— y una sola plantilla que la pinta, para que el
 * `<head>` no se escriba cinco veces con cinco criterios distintos. Las
 * paginas construyen su `PageSeo` con los ayudantes de aqui y no tocan
 * ninguna etiqueta.
 *
 * Dos decisiones que atraviesan todo el archivo:
 *
 * - LAS RUTAS SON RELATIVAS mientras el proyecto no tenga dominio. Cuando
 *   `astro.config.mjs` declare `site`, las mismas rutas se emiten absolutas
 *   sin tocar una sola pagina. Inventar un host para que "quede bonito" seria
 *   publicar enlaces a un sitio que no existe;
 * - NADA se rellena por rellenar. Si no hay descripcion, no se inventa; si no
 *   hay imagen social publicable, no se declara. Un `<meta>` con un valor
 *   falso es peor que no tenerlo.
 */

import type { Locale } from '../domain/vocabularies';
import { catalogueHref, type PublicPropertyDetail, type PublicSite } from './read-model';
import { labelsFor } from './labels';
import { contactHref, mapHref } from './navigation';

/* -------------------------------------------------------------------------- */
/* Forma                                                                      */
/* -------------------------------------------------------------------------- */

export interface PageSeo {
  locale: Locale;
  title: string;
  /** `null` cuando no hay nada honesto que decir. */
  description: string | null;
  /** Ruta canonica de ESTA pagina, siempre la de su propio idioma. */
  path: string;
  /** La misma pagina en el otro idioma. `null` si esa version no existe. */
  alternatePath: string | null;
  /**
   * La portada es la unica que declara `x-default`: es la unica a la que se
   * llega sin haber elegido idioma.
   */
  isHome: boolean;
  /** Si los buscadores deben indexarla. Seguir enlaces se permite siempre. */
  indexable: boolean;
  /** Ruta de la imagen social, si hay una publicable. */
  imagePath: string | null;
  imageAlt: string | null;
  /** `article` para una ficha; `website` para el resto. */
  type: 'website' | 'article';
}

/* -------------------------------------------------------------------------- */
/* URLs                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Una ruta, absoluta si se sabe con respecto a que.
 *
 * `site` es lo que Astro expone como `Astro.site`: existe solo cuando el
 * proyecto declara dominio. Sin el se devuelve la ruta tal cual, que es
 * valida en un `<link rel="canonical">` y resuelve bien en cualquier navegador.
 */
export function absoluteUrl(site: URL | undefined, path: string): string {
  return site === undefined ? path : new URL(path, site).href;
}

/** Territorio de cada idioma, para `og:locale`. */
const OG_LOCALES: Record<Locale, string> = {
  es: 'es_CR',
  en: 'en_US',
};

export function ogLocale(locale: Locale): string {
  return OG_LOCALES[locale];
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'es' ? 'en' : 'es';
}

/* -------------------------------------------------------------------------- */
/* Textos                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cuanto texto cabe en una descripcion antes de que los buscadores la corten.
 *
 * No es un limite duro de nadie; es donde se corta en la practica. Se recorta
 * por palabras para no dejar una a medias.
 */
export const MAX_DESCRIPTION = 160;

export function trimDescription(text: string | null | undefined): string | null {
  const clean = text?.replace(/\s+/g, ' ').trim() ?? '';
  if (clean.length === 0) return null;
  if (clean.length <= MAX_DESCRIPTION) return clean;

  const cut = clean.slice(0, MAX_DESCRIPTION - 1);
  const lastSpace = cut.lastIndexOf(' ');

  return `${(lastSpace > MAX_DESCRIPTION / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * El titulo de la pestana.
 *
 * "Propiedades" a secas no dice de quien es; con la marca detras, si. La
 * portada compone el suyo aparte, que ya lleva el nombre delante.
 */
export function pageTitle(title: string, brand: string): string {
  return title.includes(brand) ? title : `${title} · ${brand}`;
}

/**
 * Descripcion de una ficha cuando no hay texto de marketing.
 *
 * Se compone SOLO con datos ya publicados —tipo, ubicacion, superficie—, no
 * con adjetivos inventados. Es lo unico honesto que se puede decir de una
 * ficha que todavia no tiene texto escrito.
 */
export function factualSummary(property: PublicPropertyDetail): string | null {
  const place = [
    property.location.locality,
    property.location.district,
    property.location.canton,
    property.location.province,
  ].find((part) => part !== null && part.trim().length > 0);

  /*
   * Se enumeran con separadores en vez de componer una frase: asi vale igual
   * en los dos idiomas y no hay que traducir nada que no sea un dato.
   */
  const parts = [property.propertyType, place ?? null, property.area?.text ?? null].filter(
    (part): part is string => part !== null && part.trim().length > 0,
  );

  return parts.length === 0 ? null : parts.join(' · ');
}

/* -------------------------------------------------------------------------- */
/* Constructores                                                              */
/* -------------------------------------------------------------------------- */

export interface SectionSeoInput {
  locale: Locale;
  brand: string;
  title: string;
  description: string | null;
  path: string;
  alternatePath: string | null;
  isHome?: boolean;
}

/** Portada, catalogo, mapa y contacto: paginas del sitio, siempre indexables. */
export function sectionSeo(input: SectionSeoInput): PageSeo {
  return {
    locale: input.locale,
    title: pageTitle(input.title, input.brand),
    description: trimDescription(input.description),
    path: input.path,
    alternatePath: input.alternatePath,
    isHome: input.isHome === true,
    indexable: true,
    imagePath: null,
    imageAlt: null,
    type: 'website',
  };
}

/**
 * La ficha de una propiedad.
 *
 * El titulo y la descripcion salen del contenido publicado de ESE idioma. El
 * modelo no tiene todavia campos de SEO por propiedad, asi que no hay nada
 * personalizado que respetar: cuando los tenga, se leeran aqui y el resto del
 * sitio no se entera.
 *
 * La imagen social es la portada publica —una ruta `/media/N`, nunca una clave
 * de R2—, que es la unica imagen de la propiedad que ya es publica de todas
 * formas.
 */
export function propertySeo(
  property: PublicPropertyDetail,
  locale: Locale,
  brand: string,
  alternatePath: string | null,
): PageSeo {
  const social = property.media.cover ?? property.media.hero;

  return {
    locale,
    title: pageTitle(property.title, brand),
    description:
      trimDescription(property.marketingDescription) ??
      trimDescription(property.technicalDescription) ??
      trimDescription(factualSummary(property)),
    path: property.href,
    alternatePath,
    isHome: false,
    /*
     * Una ficha que existe en el sitio publico ya paso la regla de
     * visibilidad, incluida la de vendida: si esta aqui, se indexa.
     */
    indexable: true,
    imagePath: social?.url ?? null,
    imageAlt: social?.altText ?? property.title,
    type: 'article',
  };
}

/* -------------------------------------------------------------------------- */
/* Rutas del sitio                                                            */
/* -------------------------------------------------------------------------- */

export function homeHref(locale: Locale): string {
  return `/${locale}/`;
}

/** Las cuatro paginas fijas de cada idioma, en el orden en que se navegan. */
export function sectionPaths(locale: Locale): string[] {
  return [homeHref(locale), catalogueHref(locale), mapHref(locale), contactHref(locale)];
}

/** El nombre comercial, con el respaldo de la marca por defecto del idioma. */
export function brandOf(site: PublicSite, locale: Locale): string {
  return site.businessName ?? labelsFor(locale).brandName;
}
