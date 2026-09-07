/**
 * Navegacion del sitio publico.
 *
 * Las rutas son arboles independientes por idioma, asi que cada enlace se
 * construye con su locale. Contacto todavia no existe: se declara aqui para
 * que el menu este completo desde el principio y la fase que lo cree solo
 * tenga que anadir la pagina.
 */

import type { Locale } from '../domain/vocabularies';
import { LANGUAGE_STORAGE_KEY } from './language-preference';
import { catalogueHref } from './read-model';

/** Una sola definicion, y vive en el modulo ligero que va al navegador. */
export { LANGUAGE_STORAGE_KEY };

export type SectionId = 'properties' | 'map' | 'contact';

export interface NavigationItem {
  id: SectionId;
  label: string;
  href: string;
  /** Falso mientras la pagina no exista: se muestra, pero no enlaza. */
  available: boolean;
}

const LABELS: Record<Locale, Record<SectionId, string>> = {
  es: { properties: 'Propiedades', map: 'Mapa', contact: 'Contacto' },
  en: { properties: 'Properties', map: 'Map', contact: 'Contact' },
};

/** El mapa tiene arbol propio por idioma, como el catalogo. */
const MAP_HREF: Record<Locale, string> = {
  es: '/es/mapa',
  en: '/en/map',
};

export function mapHref(locale: Locale): string {
  return MAP_HREF[locale];
}

/** Rutas de las secciones que aun no existen, por idioma. */
const PENDING_HREF: Record<Locale, Record<'contact', string>> = {
  es: { contact: '/es/contacto' },
  en: { contact: '/en/contact' },
};

export function navigationFor(locale: Locale): NavigationItem[] {
  const labels = LABELS[locale];

  return [
    { id: 'properties', label: labels.properties, href: catalogueHref(locale), available: true },
    { id: 'map', label: labels.map, href: mapHref(locale), available: true },
    { id: 'contact', label: labels.contact, href: PENDING_HREF[locale].contact, available: false },
  ];
}

/* -------------------------------------------------------------------------- */
/* Idioma                                                                     */
/* -------------------------------------------------------------------------- */

const LANGUAGE_NAMES: Record<Locale, string> = { es: 'Español', en: 'English' };

export interface LanguageOption {
  locale: Locale;
  label: string;
  href: string;
  current: boolean;
}

/**
 * Opciones del selector de idioma.
 *
 * `alternateHref` es la version equivalente de ESTA pagina en el otro idioma,
 * cuando existe. Si no existe —una ficha sin traducir, por ejemplo— se cae al
 * catalogo de ese idioma en vez de inventar una URL que daria 404.
 */
export function languageOptions(locale: Locale, alternateHref: string | null): LanguageOption[] {
  const other: Locale = locale === 'es' ? 'en' : 'es';

  return [
    { locale, label: LANGUAGE_NAMES[locale], href: '', current: true },
    {
      locale: other,
      label: LANGUAGE_NAMES[other],
      href: alternateHref ?? catalogueHref(other),
      current: false,
    },
  ];
}
