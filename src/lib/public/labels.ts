/**
 * Textos del sitio publico.
 *
 * ES y EN son arboles independientes, asi que cada idioma trae los suyos. No
 * hay traduccion automatica ni respaldo de un idioma a otro: si algo falta,
 * falta.
 */

import type { CommercialStatus, Locale } from '../domain/vocabularies';

export interface PublicLabels {
  catalogueTitle: string;
  catalogueDescription: string;
  empty: string;
  code: string;
  area: string;
  location: string;
  features: string;
  description: string;
  technical: string;
  backToCatalogue: string;
  otherLanguage: string;
  tourAvailable: string;
  /** Cuando la propiedad todavia no tiene ninguna foto. */
  noImages: string;
  gallery: string;
  documents: string;
  watchOnYoutube: string;
  /** Se usa cuando la imagen no trae texto alternativo propio. */
  imageOf: (title: string) => string;

  /* -- Shell ------------------------------------------------------------- */
  skipToContent: string;
  menu: string;
  mainNavigation: string;
  comingSoon: string;
  footerNote: string;

  /* -- Filtros ----------------------------------------------------------- */
  filters: string;
  filterType: string;
  filterLocation: string;
  filterPriceMax: string;
  filterAreaMin: string;
  sortBy: string;
  sortNewest: string;
  sortPriceAsc: string;
  sortPriceDesc: string;
  sortAreaAsc: string;
  sortAreaDesc: string;
  anyOption: string;
  clearFilters: string;
  results: (count: number) => string;
  noMatches: string;
  noMatchesHint: string;
  showMore: string;

  /* -- Ficha ------------------------------------------------------------- */
  price: string;
  overview: string;
  video: string;
  photographs: string;
  mapComingSoon: string;
  contactComingSoon: string;
  /** Navegacion de la galeria. */
  previousPhoto: string;
  nextPhoto: string;
  photoPosition: (index: number, total: number) => string;
  playVideo: string;
  videoCover: (title: string) => string;
  /** Se usa cuando el video no trae titulo propio. */
  videoOf: (title: string) => string;

  /* -- Recorrido 360 ----------------------------------------------------- */
  tourTitle: string;
  tourLead: string;
  tourOpen: string;
  tourClose: string;
  tourPoints: string;
  tourPointCount: (count: number) => string;
  tourPointName: (position: number) => string;
  tourGoTo: (name: string) => string;
  tourCurrentPoint: string;
  tourUnavailable: string;
  tourLoading: string;
}

const ES: PublicLabels = {
  catalogueTitle: 'Propiedades',
  catalogueDescription: 'Terrenos y propiedades disponibles en Costa Rica.',
  empty: 'Todavía no hay propiedades publicadas.',
  code: 'Código',
  area: 'Superficie',
  location: 'Ubicación',
  features: 'Características',
  description: 'Descripción',
  technical: 'Detalles técnicos',
  backToCatalogue: 'Volver a propiedades',
  otherLanguage: 'English',
  tourAvailable: 'Esta propiedad tiene recorrido 360°.',
  noImages: 'Todavía no hay fotografías de esta propiedad.',
  gallery: 'Galería',
  documents: 'Documentos',
  watchOnYoutube: 'Ver el vídeo en YouTube',
  imageOf: (title) => `Fotografía de ${title}`,

  skipToContent: 'Ir al contenido',
  menu: 'Menú',
  mainNavigation: 'Navegación principal',
  comingSoon: 'Próximamente',
  footerNote: 'Terrenos y propiedades en la costa de Costa Rica.',

  filters: 'Filtros',
  filterType: 'Tipo',
  filterLocation: 'Zona',
  filterPriceMax: 'Precio máximo',
  filterAreaMin: 'Superficie mínima',
  sortBy: 'Ordenar por',
  sortNewest: 'Más recientes',
  sortPriceAsc: 'Precio: de menor a mayor',
  sortPriceDesc: 'Precio: de mayor a menor',
  sortAreaAsc: 'Superficie: de menor a mayor',
  sortAreaDesc: 'Superficie: de mayor a menor',
  anyOption: 'Todas',
  clearFilters: 'Limpiar filtros',
  results: (count) => (count === 1 ? '1 propiedad' : `${count} propiedades`),
  noMatches: 'Ninguna propiedad coincide con estos filtros.',
  noMatchesHint: 'Prueba a ampliar el precio o la superficie, o quita algún filtro.',
  showMore: 'Ver más',

  price: 'Precio',
  overview: 'Resumen',
  video: 'Vídeo',
  photographs: 'Fotografías',
  mapComingSoon: 'El mapa de la zona llegará en breve.',
  contactComingSoon: 'El formulario de contacto llegará en breve.',
  previousPhoto: 'Fotografía anterior',
  nextPhoto: 'Fotografía siguiente',
  photoPosition: (index, total) => `Fotografía ${index} de ${total}`,
  playVideo: 'Reproducir el vídeo',
  videoCover: (title) => `Portada del vídeo ${title}`,
  videoOf: (title) => `Vídeo de ${title}`,

  tourTitle: 'Recorrido 360°',
  tourLead: 'Camina por la propiedad desde donde estés.',
  tourOpen: 'Abrir el recorrido 360°',
  tourClose: 'Cerrar el recorrido',
  tourPoints: 'Puntos del recorrido',
  tourPointCount: (count) => (count === 1 ? '1 punto' : `${count} puntos`),
  tourPointName: (position) => `Punto ${position}`,
  tourGoTo: (name) => `Ir a ${name}`,
  tourCurrentPoint: 'Punto actual',
  tourUnavailable:
    'No se pudo abrir el visor 360° en este navegador. Puedes ver cada panorama por separado.',
  tourLoading: 'Cargando el recorrido…',
};

const EN: PublicLabels = {
  catalogueTitle: 'Properties',
  catalogueDescription: 'Land and properties available in Costa Rica.',
  empty: 'There are no published properties yet.',
  code: 'Reference',
  area: 'Area',
  location: 'Location',
  features: 'Features',
  description: 'Description',
  technical: 'Technical details',
  backToCatalogue: 'Back to properties',
  otherLanguage: 'Español',
  tourAvailable: 'This property has a 360° tour.',
  noImages: 'There are no photographs of this property yet.',
  gallery: 'Gallery',
  documents: 'Documents',
  watchOnYoutube: 'Watch the video on YouTube',
  imageOf: (title) => `Photograph of ${title}`,

  skipToContent: 'Skip to content',
  menu: 'Menu',
  mainNavigation: 'Main navigation',
  comingSoon: 'Coming soon',
  footerNote: 'Land and properties on the coast of Costa Rica.',

  filters: 'Filters',
  filterType: 'Type',
  filterLocation: 'Area',
  filterPriceMax: 'Maximum price',
  filterAreaMin: 'Minimum area',
  sortBy: 'Sort by',
  sortNewest: 'Most recent',
  sortPriceAsc: 'Price: low to high',
  sortPriceDesc: 'Price: high to low',
  sortAreaAsc: 'Area: small to large',
  sortAreaDesc: 'Area: large to small',
  anyOption: 'All',
  clearFilters: 'Clear filters',
  results: (count) => (count === 1 ? '1 property' : `${count} properties`),
  noMatches: 'No property matches these filters.',
  noMatchesHint: 'Try widening the price or area, or remove a filter.',
  showMore: 'Show more',

  price: 'Price',
  overview: 'Overview',
  video: 'Video',
  photographs: 'Photographs',
  mapComingSoon: 'The area map is coming soon.',
  contactComingSoon: 'The contact form is coming soon.',
  previousPhoto: 'Previous photograph',
  nextPhoto: 'Next photograph',
  photoPosition: (index, total) => `Photograph ${index} of ${total}`,
  playVideo: 'Play the video',
  videoCover: (title) => `Cover of the video ${title}`,
  videoOf: (title) => `Video of ${title}`,

  tourTitle: '360° tour',
  tourLead: 'Walk the property from wherever you are.',
  tourOpen: 'Open the 360° tour',
  tourClose: 'Close the tour',
  tourPoints: 'Tour points',
  tourPointCount: (count) => (count === 1 ? '1 point' : `${count} points`),
  tourPointName: (position) => `Point ${position}`,
  tourGoTo: (name) => `Go to ${name}`,
  tourCurrentPoint: 'Current point',
  tourUnavailable:
    'The 360° viewer could not be opened in this browser. You can still view each panorama on its own.',
  tourLoading: 'Loading the tour…',
};

export function labelsFor(locale: Locale): PublicLabels {
  return locale === 'en' ? EN : ES;
}

/** Solo se muestran los estados que dicen algo; `available` no aparece. */
const COMMERCIAL_STATUS_LABELS: Record<Locale, Record<CommercialStatus, string>> = {
  es: {
    available: 'Disponible',
    offer_received: 'Con oferta',
    reserved: 'Reservada',
    sold: 'Vendida',
  },
  en: {
    available: 'Available',
    offer_received: 'Offer received',
    reserved: 'Reserved',
    sold: 'Sold',
  },
};

export function commercialStatusLabel(status: CommercialStatus, locale: Locale): string {
  return COMMERCIAL_STATUS_LABELS[locale][status];
}

/** La otra version del sitio, para el enlace de idioma. */
export function otherLocale(locale: Locale): Locale {
  return locale === 'es' ? 'en' : 'es';
}

/**
 * Ubicacion en una linea.
 *
 * Se ordena de lo mas concreto a lo mas general, que es como se dice una
 * direccion en Costa Rica, y se saltan las partes vacias.
 */
export function locationLine(location: {
  province: string | null;
  canton: string | null;
  district: string | null;
  locality: string | null;
}): string | null {
  const parts = [location.locality, location.district, location.canton, location.province]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part.length > 0);

  return parts.length === 0 ? null : parts.join(', ');
}
