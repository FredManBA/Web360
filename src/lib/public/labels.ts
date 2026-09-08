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

  /* -- Mapa -------------------------------------------------------------- */
  mapTitle: string;
  mapDescription: string;
  mapEmpty: string;
  mapEmptyHint: string;
  /** Sin token o con Mapbox caido: el listado sigue sirviendo. */
  mapUnavailable: string;
  mapListTitle: string;
  mapCount: (count: number) => string;
  showOnMap: string;
  openProperty: string;
  locationOnMap: string;
  approximateLocation: string;
  approximateLocationNote: string;
  noMapLocation: string;
  zoomIn: string;
  zoomOut: string;
  resetNorth: string;

  /* -- Contacto ---------------------------------------------------------- */
  contactTitle: string;
  contactDescription: string;
  contactChannels: string;
  contactWhatsapp: string;
  contactPhone: string;
  contactEmail: string;
  contactSocial: string;
  contactNoChannels: string;
  /** CTA de la ficha. */
  contactAbout: (title: string) => string;
  contactAboutLead: string;
  writeToUs: string;

  /* -- Formulario -------------------------------------------------------- */
  formTitle: string;
  formName: string;
  formMethod: string;
  formMethodEmail: string;
  formMethodWhatsapp: string;
  formMethodPhone: string;
  formValueEmail: string;
  formValueWhatsapp: string;
  formValuePhone: string;
  formMessage: string;
  formMessageOptional: string;
  formConsent: string;
  formSubmit: string;
  formSending: string;
  formSent: string;
  formSentHint: string;
  formAbout: string;
  /** Trampa antispam: visible solo para quien no debe rellenarla. */
  formHoneypot: string;
  formRequired: string;
  errorInvalid: string;
  errorPropertyGone: string;
  errorTooFast: string;
  errorServer: string;

  /* -- Portada ----------------------------------------------------------- */
  homeSeoTitle: string;
  homeSeoDescription: string;
  homeHeroTitle: string;
  homeHeroSubtitle: string;
  homeSeeProperties: string;
  homeSeeMap: string;
  homeFeaturedTitle: string;
  homeFeaturedLead: string;
  homeFeaturedEmpty: string;
  homeSeeAll: string;
  homeIntroTitle: string;
  homeIntroLead: string;
  homeIntroPhotos: string;
  homeIntroPhotosText: string;
  homeIntroTour: string;
  homeIntroTourText: string;
  homeIntroMap: string;
  homeIntroMapText: string;
  homeMapTitle: string;
  homeMapLead: string;
  homeContactTitle: string;
  homeContactLead: string;
  /** Marca por defecto, mientras `site_settings` este vacio. */
  brandName: string;
  /** Solo para el `/`, que elige idioma con JavaScript. */
  chooseLanguage: string;
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

  mapTitle: 'Mapa',
  mapDescription: 'Dónde está cada propiedad en la costa de Costa Rica.',
  mapEmpty: 'Todavía no hay propiedades situadas en el mapa.',
  mapEmptyHint: 'Mientras tanto puedes verlas todas en Propiedades.',
  mapUnavailable:
    'El mapa no está disponible en este momento. El listado de abajo lleva a cada propiedad.',
  mapListTitle: 'Propiedades en el mapa',
  mapCount: (count) => (count === 1 ? '1 propiedad situada' : `${count} propiedades situadas`),
  showOnMap: 'Ver en el mapa',
  openProperty: 'Ver la propiedad',
  locationOnMap: 'Ubicación',
  approximateLocation: 'Ubicación aproximada',
  approximateLocationNote:
    'La posición en el mapa es aproximada; la ubicación exacta se comparte al visitar.',
  noMapLocation: 'Esta propiedad todavía no está situada en el mapa.',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  resetNorth: 'Orientar al norte',

  contactTitle: 'Contacto',
  contactDescription: 'Escríbenos y te respondemos por donde prefieras.',
  contactChannels: 'Canales directos',
  contactWhatsapp: 'WhatsApp',
  contactPhone: 'Teléfono',
  contactEmail: 'Correo',
  contactSocial: 'Redes',
  contactNoChannels: 'Todavía no hay canales directos publicados. El formulario sí funciona.',
  contactAbout: (title) => `¿Te interesa ${title}?`,
  contactAboutLead: 'Escríbenos y te contamos lo que necesites saber.',
  writeToUs: 'Escríbenos',

  formTitle: 'Escríbenos',
  formName: 'Nombre',
  formMethod: '¿Cómo prefieres que te respondamos?',
  formMethodEmail: 'Por correo',
  formMethodWhatsapp: 'Por WhatsApp',
  formMethodPhone: 'Por teléfono',
  formValueEmail: 'Tu correo',
  formValueWhatsapp: 'Tu número de WhatsApp',
  formValuePhone: 'Tu teléfono',
  formMessage: 'Mensaje',
  formMessageOptional: 'opcional',
  formConsent: 'Acepto que uséis mis datos para responderme a esta consulta.',
  formSubmit: 'Enviar consulta',
  formSending: 'Enviando…',
  formSent: 'Consulta enviada. Te respondemos en breve.',
  formSentHint: 'Gracias por escribir.',
  formAbout: 'Consultas sobre',
  formHoneypot: 'No rellenes este campo',
  formRequired: 'obligatorio',
  errorInvalid: 'Revisa los datos: falta algo o no tiene el formato correcto.',
  errorPropertyGone:
    'Esta propiedad ya no está disponible. Escríbenos desde la página de contacto.',
  errorTooFast: 'El envío llegó demasiado rápido. Inténtalo otra vez.',
  errorServer: 'No hemos podido enviar la consulta. Inténtalo de nuevo en un momento.',

  homeSeoTitle: 'Propiedades en la costa de Costa Rica',
  homeSeoDescription:
    'Lotes, casas y fincas en la costa de Costa Rica, con fotografía, recorrido 360° y mapa.',
  homeHeroTitle: 'Un pedazo de costa, contado como se merece',
  homeHeroSubtitle:
    'Lotes, casas y fincas en el Pacífico de Costa Rica. Míralos con calma antes de venir.',
  homeSeeProperties: 'Ver propiedades',
  homeSeeMap: 'Explorar el mapa',
  homeFeaturedTitle: 'Selección',
  homeFeaturedLead: 'Unas pocas, escogidas a mano.',
  homeFeaturedEmpty: 'Todavía no hay una selección. Mientras tanto, están todas en Propiedades.',
  homeSeeAll: 'Ver todas las propiedades',
  homeIntroTitle: 'Verla antes de verla',
  homeIntroLead:
    'Cada propiedad se cuenta con lo que hace falta para entenderla desde lejos, sin adornos ni prisa.',
  homeIntroPhotos: 'Fotografía y vídeo',
  homeIntroPhotosText: 'La propiedad tal como es, con luz de verdad.',
  homeIntroTour: 'Recorrido 360°',
  homeIntroTourText: 'Camina por el terreno desde donde estés.',
  homeIntroMap: 'Ubicación',
  homeIntroMapText: 'Dónde está, y qué tiene alrededor.',
  homeMapTitle: 'Empieza por el dónde',
  homeMapLead: 'De Guanacaste al Pacífico sur. Mira qué hay en la zona que te interesa.',
  homeContactTitle: '¿Hablamos?',
  homeContactLead: 'Cuéntanos qué buscas y te respondemos por donde prefieras.',
  brandName: 'Loba',
  chooseLanguage: 'Elige idioma',
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

  mapTitle: 'Map',
  mapDescription: 'Where each property sits on the coast of Costa Rica.',
  mapEmpty: 'No properties are placed on the map yet.',
  mapEmptyHint: 'In the meantime you can see them all under Properties.',
  mapUnavailable: 'The map is unavailable right now. The list below links to every property.',
  mapListTitle: 'Properties on the map',
  mapCount: (count) => (count === 1 ? '1 property placed' : `${count} properties placed`),
  showOnMap: 'Show on the map',
  openProperty: 'View the property',
  locationOnMap: 'Location',
  approximateLocation: 'Approximate location',
  approximateLocationNote:
    'The position on the map is approximate; the exact location is shared on a visit.',
  noMapLocation: 'This property is not placed on the map yet.',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetNorth: 'Reset north',

  contactTitle: 'Contact',
  contactDescription: 'Write to us and we will reply however you prefer.',
  contactChannels: 'Direct channels',
  contactWhatsapp: 'WhatsApp',
  contactPhone: 'Phone',
  contactEmail: 'Email',
  contactSocial: 'Social',
  contactNoChannels: 'No direct channels are published yet. The form does work.',
  contactAbout: (title) => `Interested in ${title}?`,
  contactAboutLead: 'Write to us and we will tell you whatever you need to know.',
  writeToUs: 'Write to us',

  formTitle: 'Write to us',
  formName: 'Name',
  formMethod: 'How would you like us to reply?',
  formMethodEmail: 'By email',
  formMethodWhatsapp: 'By WhatsApp',
  formMethodPhone: 'By phone',
  formValueEmail: 'Your email',
  formValueWhatsapp: 'Your WhatsApp number',
  formValuePhone: 'Your phone',
  formMessage: 'Message',
  formMessageOptional: 'optional',
  formConsent: 'I agree that you use my details to reply to this enquiry.',
  formSubmit: 'Send enquiry',
  formSending: 'Sending…',
  formSent: 'Enquiry sent. We will get back to you shortly.',
  formSentHint: 'Thank you for writing.',
  formAbout: 'Enquiries about',
  formHoneypot: 'Do not fill in this field',
  formRequired: 'required',
  errorInvalid: 'Check the details: something is missing or has the wrong format.',
  errorPropertyGone: 'This property is no longer available. Write to us from the contact page.',
  errorTooFast: 'That submission arrived too fast. Please try again.',
  errorServer: 'We could not send the enquiry. Please try again in a moment.',

  homeSeoTitle: 'Property on the coast of Costa Rica',
  homeSeoDescription:
    'Lots, houses and farms on the coast of Costa Rica, with photography, a 360° tour and a map.',
  homeHeroTitle: 'A piece of the coast, told properly',
  homeHeroSubtitle:
    'Lots, houses and farms on the Pacific coast of Costa Rica. Take your time before you fly out.',
  homeSeeProperties: 'See properties',
  homeSeeMap: 'Explore the map',
  homeFeaturedTitle: 'Selection',
  homeFeaturedLead: 'A few, picked by hand.',
  homeFeaturedEmpty: 'There is no selection yet. In the meantime, they are all under Properties.',
  homeSeeAll: 'See every property',
  homeIntroTitle: 'See it before you see it',
  homeIntroLead:
    'Every property is shown with what it takes to understand it from far away, with no frills and no rush.',
  homeIntroPhotos: 'Photography and video',
  homeIntroPhotosText: 'The property as it is, in real light.',
  homeIntroTour: '360° tour',
  homeIntroTourText: 'Walk the land from wherever you are.',
  homeIntroMap: 'Location',
  homeIntroMapText: 'Where it sits, and what surrounds it.',
  homeMapTitle: 'Start with the where',
  homeMapLead: 'From Guanacaste to the southern Pacific. See what is in the area you care about.',
  homeContactTitle: 'Shall we talk?',
  homeContactLead: 'Tell us what you are after and we will reply however you prefer.',
  brandName: 'Loba',
  chooseLanguage: 'Choose a language',
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
