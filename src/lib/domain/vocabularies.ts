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
 * retira y la devuelve a `approved`. Archivar no esta aqui: sigue siendo una
 * decision editorial que no toca la web publicada.
 *
 * `publish_site` es de otra naturaleza y por eso se distingue en el tipo, no
 * solo en el valor: no habla de ninguna propiedad. Reconstruye el sitio
 * entero para que los cambios globales —marca, textos, media del sitio—
 * lleguen al HTML, que es estatico y no se entera de que la base cambio.
 * **No mueve el estado editorial de nada.** No tiene pareja: "despublicar el
 * sitio" no es una operacion que nadie quiera a un clic.
 */
export const PROPERTY_PUBLICATION_ACTIONS = ['publish', 'unpublish'] as const;
export type PropertyPublicationAction = (typeof PROPERTY_PUBLICATION_ACTIONS)[number];

export const SITE_PUBLICATION_ACTION = 'publish_site';

export const PUBLICATION_ACTIONS = [
  ...PROPERTY_PUBLICATION_ACTIONS,
  SITE_PUBLICATION_ACTION,
] as const;
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

/** Si la accion habla de una propiedad concreta o del sitio entero. */
export function isSitePublicationAction(
  action: PublicationAction,
): action is typeof SITE_PUBLICATION_ACTION {
  return action === SITE_PUBLICATION_ACTION;
}

/**
 * Vida de una peticion de publicacion.
 *
 * `pending` es "anotada, todavia sin lanzar"; `building` es "el ejecutor la
 * acepto y esta trabajando". NO son estados editoriales de la propiedad: son
 * el estado de la OPERACION.
 *
 * Los tres desenlaces finales dicen cosas distintas, y no son intercambiables:
 *
 * - `done`: la operacion salio bien y la propiedad cambio de estado;
 * - `failed`: algo salio mal y consta como tal;
 * - `abandoned`: una persona decidio dejarla, y NO se afirma nada sobre si el
 *   build o el despliegue llegaron a ocurrir. Es lo unico honesto cuando no
 *   hay forma de saberlo, y por eso no se mete en `failed`.
 */
export const PUBLICATION_REQUEST_STATUSES = [
  'pending',
  'building',
  'done',
  'failed',
  'abandoned',
] as const;
export type PublicationRequestStatus = (typeof PUBLICATION_REQUEST_STATUSES)[number];

/**
 * Una peticion sigue viva —y bloquea otra— mientras no termine.
 *
 * `abandoned` es terminal: deja de bloquear en cuanto se decide, igual que
 * `done` y `failed`.
 */
export const ACTIVE_PUBLICATION_REQUEST_STATUSES: readonly PublicationRequestStatus[] = [
  'pending',
  'building',
];
