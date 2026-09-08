/**
 * Portada: lo que se decide sin pintar nada.
 *
 * Que propiedades encabezan, con que textos abre el hero y si merece la pena
 * ofrecer el mapa son preguntas de datos. Viven aqui para poder probarlas.
 *
 * Ningun texto comercial esta escrito en el codigo del sitio: lo que hay son
 * valores por defecto para cuando la configuracion todavia esta vacia, y en
 * cuanto alguien escribe el suyo en `site_settings`, manda el suyo.
 */

import type { Locale } from '../domain/vocabularies';
import type { PublicPropertyCard, PublicSite, PublicSiteTexts } from './read-model';

/**
 * Cuantas propiedades caben en la portada.
 *
 * Tres. Una portada no es el catalogo: si se llena de tarjetas deja de
 * distinguir nada, y para verlas todas ya esta Propiedades.
 */
export const MAX_FEATURED = 3;

/**
 * Las destacadas que se ensenan.
 *
 * La seleccion es manual —el campo `isFeatured` que marca una persona en el
 * panel— y no hay ningun ranking automatico detras. Que una propiedad este
 * aqui ya implica que es publicamente visible: el snapshot no trae otras.
 */
export function featuredOf(properties: readonly PublicPropertyCard[]): PublicPropertyCard[] {
  return properties.filter((property) => property.isFeatured).slice(0, MAX_FEATURED);
}

/**
 * El mapa solo se ofrece si lleva a alguna parte.
 *
 * Sin una sola propiedad situada, la seccion del mapa seria una invitacion a
 * mirar un mapa vacio.
 */
export function hasPlacedProperties(properties: readonly PublicPropertyCard[]): boolean {
  return properties.some((property) => property.location.coordinates !== null);
}

/* -------------------------------------------------------------------------- */
/* Textos                                                                     */
/* -------------------------------------------------------------------------- */

export interface HomeCopy {
  brand: string;
  heroTitle: string;
  heroSubtitle: string;
  tagline: string | null;
  seoTitle: string;
  seoDescription: string;
}

/** Lo que dice la portada mientras nadie ha configurado nada. */
export interface HomeDefaults {
  brand: string;
  heroTitle: string;
  heroSubtitle: string;
  seoTitle: string;
  seoDescription: string;
}

function pick(configured: string | null, fallback: string): string {
  return configured === null ? fallback : configured;
}

/**
 * Resuelve los textos de la portada.
 *
 * Cada campo se decide por separado: tener el titulo configurado y el
 * subtitulo vacio es normal mientras se rellena el panel, y no debe dejar
 * media portada en blanco.
 */
export function homeCopy(site: PublicSite, locale: Locale, defaults: HomeDefaults): HomeCopy {
  const texts: PublicSiteTexts = site.texts[locale];
  const brand = pick(site.businessName, defaults.brand);

  return {
    brand,
    heroTitle: pick(texts.heroTitle, defaults.heroTitle),
    heroSubtitle: pick(texts.heroSubtitle, defaults.heroSubtitle),
    tagline: texts.tagline,
    /*
     * El titulo de la pestana lleva la marca detras cuando no hay un SEO
     * escrito a mano: "Loba" solo no dice a que se dedica, y el titulo
     * configurado se respeta tal cual.
     */
    seoTitle: texts.seoTitle ?? `${brand} · ${defaults.seoTitle}`,
    seoDescription: pick(texts.seoDescription, defaults.seoDescription),
  };
}

/* -------------------------------------------------------------------------- */
/* Idioma en la raiz                                                          */
/* -------------------------------------------------------------------------- */

export const LOCALES: readonly Locale[] = ['es', 'en'];

/** Espanol: el negocio esta en Costa Rica. */
export const DEFAULT_LOCALE: Locale = 'es';

function isLocale(value: string | null | undefined): value is Locale {
  return value === 'es' || value === 'en';
}

/**
 * Que idioma abrir cuando alguien llega a `/`.
 *
 * Manda lo que la persona eligio a proposito. Si no ha elegido nunca, se mira
 * lo que pide su navegador, y si tampoco dice nada util, espanol.
 *
 * Solo se aplica en `/`. A quien ya esta dentro de `/es` o `/en` no se le
 * mueve: seria hostil y romperia los enlaces compartidos.
 */
export function resolveRootLocale(
  stored: string | null,
  languages: readonly string[] = [],
): Locale {
  if (isLocale(stored)) return stored;

  for (const language of languages) {
    // `es-CR`, `en-US`: solo importa la parte de delante.
    const base = language.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}
