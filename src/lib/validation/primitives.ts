/**
 * Piezas Zod reutilizables.
 *
 * Los vocabularios vienen de `src/lib/domain/vocabularies.ts`, la misma fuente
 * que usa Drizzle para generar los CHECK del esquema. Asi la validacion de
 * entrada y la de base de datos no pueden desincronizarse.
 */

import { z } from 'zod';

import { isValidCurrencyCode, SUPPORTED_CURRENCY_CODES } from '../domain/money';
import { isValidSlug, SLUG_MAX_LENGTH } from '../domain/slug';
import {
  COMMERCIAL_STATUSES,
  CONTACT_METHODS,
  CONTACT_STATUSES,
  LOCALES,
  LOCATION_PRECISIONS,
  MEDIA_KINDS,
  PRICE_MODES,
  PUBLICATION_STATUSES,
  REVIEW_STATUSES,
  SOURCE_PROVIDERS,
} from '../domain/vocabularies';

export const localeSchema = z.enum(LOCALES);
export const publicationStatusSchema = z.enum(PUBLICATION_STATUSES);
export const commercialStatusSchema = z.enum(COMMERCIAL_STATUSES);
export const priceModeSchema = z.enum(PRICE_MODES);
export const locationPrecisionSchema = z.enum(LOCATION_PRECISIONS);
export const mediaKindSchema = z.enum(MEDIA_KINDS);
export const sourceProviderSchema = z.enum(SOURCE_PROVIDERS);
export const contactMethodSchema = z.enum(CONTACT_METHODS);
export const contactStatusSchema = z.enum(CONTACT_STATUSES);
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const slugSchema = z
  .string()
  .max(SLUG_MAX_LENGTH)
  .refine(isValidSlug, { message: 'Slug invalido: usa minusculas, digitos y guiones simples.' });

/** Cualquier ISO 4217 que reconozca `Intl`. */
export const currencyCodeSchema = z
  .string()
  .refine(isValidCurrencyCode, { message: 'Codigo de moneda ISO 4217 invalido.' });

/** Las que ofrece el panel por ahora. */
export const supportedCurrencyCodeSchema = z.enum(SUPPORTED_CURRENCY_CODES);

/** Texto que, si viene, no puede quedar en blanco. */
export const nonBlankString = z.string().refine((value) => value.trim().length > 0, {
  message: 'No puede estar vacio.',
});

/**
 * Campo opcional de un borrador: admite ausencia, `null` y cadena vacia, y
 * normaliza todo eso a `null`. Los formularios envian "" cuando el usuario
 * deja el campo sin rellenar.
 */
export function optionalText(max?: number): z.ZodType<string | null> {
  const base = max === undefined ? z.string() : z.string().max(max);

  return base
    .nullish()
    .transform((value) => {
      if (value === undefined || value === null) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .pipe(z.string().nullable());
}

export const optionalPositiveNumber = z
  .number()
  .positive()
  .nullish()
  .transform((value) => value ?? null);

export const optionalNonNegativeInt = z
  .number()
  .int()
  .nonnegative()
  .nullish()
  .transform((value) => value ?? null);
