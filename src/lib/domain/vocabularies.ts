/**
 * Vocabularios compartidos de CodeLoba.
 *
 * Fuente unica de verdad para los conjuntos cerrados de valores. Los consumen
 * a la vez:
 *
 * - Drizzle, para tipar las columnas y generar los CHECK del esquema;
 * - Zod, para validar la entrada del panel;
 * - la logica de dominio.
 *
 * Anadir un valor aqui cambia el CHECK generado, asi que cualquier cambio en
 * este archivo exige una migracion nueva.
 */

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const PUBLICATION_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'published',
  'archived',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const COMMERCIAL_STATUSES = ['available', 'offer_received', 'reserved', 'sold'] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];

export const PRICE_MODES = ['exact', 'negotiable', 'contact'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const LOCATION_PRECISIONS = ['exact', 'approximate'] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export const MEDIA_KINDS = ['image', 'video', 'document', 'panorama'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** `r2` para archivos propios; `youtube` para los videos largos del MVP. */
export const SOURCE_PROVIDERS = ['r2', 'youtube'] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

/** Como prefiere que le contacten. El dato en si va en `contact_value`. */
export const CONTACT_METHODS = ['email', 'whatsapp', 'phone', 'social', 'other'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

/** Bandeja de entrada, no un pipeline de CRM. */
export const CONTACT_STATUSES = ['new', 'reviewed'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const REVIEW_STATUSES = ['pending', 'approved', 'changes_requested', 'cancelled'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Tipos de propiedad predefinidos (`property_types.system_key`).
 *
 * No es un vocabulario cerrado del esquema: el admin puede crear tipos
 * personalizados, que llevan `system_key = NULL`. Solo identifica los que
 * instala el seed.
 */
export const SYSTEM_PROPERTY_TYPE_KEYS = [
  'lot',
  'house',
  'farm',
  'land',
  'commercial',
  'other',
] as const;
export type SystemPropertyTypeKey = (typeof SYSTEM_PROPERTY_TYPE_KEYS)[number];

/**
 * Que se le pide al flujo de publicacion.
 *
 * `publish` lleva una propiedad aprobada al sitio publico; `unpublish` la
 * retira y la devuelve a `approved`. No hay un tercer verbo: archivar sigue
 * siendo una decision editorial que no toca la web publicada.
 */
export const PUBLICATION_ACTIONS = ['publish', 'unpublish'] as const;
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

/**
 * Vida de una peticion de publicacion.
 *
 * `pending` es "anotada, todavia sin lanzar"; `building` es "el ejecutor la
 * acepto y esta trabajando"; `done` y `failed` son finales. NO son estados
 * editoriales de la propiedad: son el estado de la OPERACION.
 */
export const PUBLICATION_REQUEST_STATUSES = ['pending', 'building', 'done', 'failed'] as const;
export type PublicationRequestStatus = (typeof PUBLICATION_REQUEST_STATUSES)[number];

/** Una peticion sigue viva —y bloquea otra— mientras no termine. */
export const ACTIVE_PUBLICATION_REQUEST_STATUSES: readonly PublicationRequestStatus[] = [
  'pending',
  'building',
];
