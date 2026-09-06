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
  /** Se anuncia lo que habra cuando exista entrega publica de multimedia. */
  mediaPending: string;
  tourAvailable: string;
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
  mediaPending: 'Las fotografías estarán disponibles próximamente.',
  tourAvailable: 'Esta propiedad tiene recorrido 360°.',
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
  mediaPending: 'Photographs will be available soon.',
  tourAvailable: 'This property has a 360° tour.',
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
