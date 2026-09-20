export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const PUBLICATION_STATUSES = ['draft', 'published'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
export const COMMERCIAL_STATUSES = ['available', 'offer_received', 'reserved', 'sold'] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];
export const PRICE_MODES = ['exact', 'negotiable', 'contact'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];
export const LOCATION_PRECISIONS = ['exact', 'approximate'] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];
export const MEDIA_KINDS = ['image', 'panorama', 'youtube'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const CONTACT_METHODS = ['email', 'whatsapp', 'phone', 'social', 'other'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];
export const CONTACT_STATUSES = ['new', 'reviewed'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export const SYSTEM_PROPERTY_TYPE_KEYS = [
  'lot',
  'house',
  'farm',
  'land',
  'commercial',
  'other',
] as const;
export type SystemPropertyTypeKey = (typeof SYSTEM_PROPERTY_TYPE_KEYS)[number];
export const TYPE_LABELS: Record<Locale, Record<SystemPropertyTypeKey, string>> = {
  es: {
    lot: 'Lote',
    house: 'Casa',
    farm: 'Finca',
    land: 'Terreno',
    commercial: 'Comercial',
    other: 'Otro',
  },
  en: {
    lot: 'Lot',
    house: 'House',
    farm: 'Farm',
    land: 'Land',
    commercial: 'Commercial',
    other: 'Other',
  },
};
