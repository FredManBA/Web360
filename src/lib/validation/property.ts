/**
 * Validacion de los datos editables de una propiedad.
 *
 * Aqui solo vive la validacion de BORRADOR, que es deliberadamente permisiva:
 * comprueba formatos y rangos, pero no exige que la ficha este completa. Un
 * borrador puede guardarse a medias.
 *
 * Que una propiedad este LISTA PARA PUBLICAR lo decide
 * `validatePropertyForPublication`, en `src/lib/domain/publication.ts`.
 */

import { z } from 'zod';

import {
  commercialStatusSchema,
  latitudeSchema,
  localeSchema,
  locationPrecisionSchema,
  longitudeSchema,
  nonBlankString,
  optionalNonNegativeInt,
  optionalPositiveNumber,
  optionalText,
  priceModeSchema,
  publicationStatusSchema,
  slugSchema,
  supportedCurrencyCodeSchema,
} from './primitives';

/** Traduccion en borrador: todo el contenido puede faltar todavia. */
export const propertyTranslationDraftSchema = z.object({
  locale: localeSchema,
  slug: slugSchema.nullish().transform((value) => value ?? null),
  title: optionalText(200),
  marketingDescription: optionalText(),
  technicalDescription: optionalText(),
});

export type PropertyTranslationDraftInput = z.input<typeof propertyTranslationDraftSchema>;
export type PropertyTranslationDraft = z.output<typeof propertyTranslationDraftSchema>;

/**
 * Propiedad en borrador.
 *
 * Solo `code` es obligatorio: es la identidad de la ficha. El resto puede
 * completarse despues, igual que permite el esquema.
 */
export const propertyDraftSchema = z.object({
  code: nonBlankString.pipe(z.string().max(64)),
  propertyTypeId: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? null),

  publicationStatus: publicationStatusSchema.default('draft'),
  commercialStatus: commercialStatusSchema.default('available'),

  isFeatured: z.boolean().default(false),
  showWhenSold: z.boolean().default(false),

  priceMode: priceModeSchema.default('contact'),
  priceAmountMinor: optionalNonNegativeInt,
  currencyCode: supportedCurrencyCodeSchema.nullish().transform((value) => value ?? null),

  areaSquareMeters: optionalPositiveNumber,

  province: optionalText(120),
  canton: optionalText(120),
  district: optionalText(120),
  locality: optionalText(120),

  privateLatitude: latitudeSchema.nullish().transform((value) => value ?? null),
  privateLongitude: longitudeSchema.nullish().transform((value) => value ?? null),
  publicLatitude: latitudeSchema.nullish().transform((value) => value ?? null),
  publicLongitude: longitudeSchema.nullish().transform((value) => value ?? null),
  locationPrecision: locationPrecisionSchema.default('approximate'),
});

export type PropertyDraftInput = z.input<typeof propertyDraftSchema>;
export type PropertyDraft = z.output<typeof propertyDraftSchema>;

/**
 * Coordenadas: o las dos, o ninguna. Media coordenada no sirve para nada y es
 * un error facil de cometer en un formulario.
 *
 * Se aplica sobre el borrador porque es un error de forma, no de completitud.
 */
export const propertyDraftWithCoordinatePairs = propertyDraftSchema
  .refine((value) => (value.publicLatitude === null) === (value.publicLongitude === null), {
    message: 'La coordenada publica necesita latitud y longitud, o ninguna de las dos.',
    path: ['publicLatitude'],
  })
  .refine((value) => (value.privateLatitude === null) === (value.privateLongitude === null), {
    message: 'La coordenada privada necesita latitud y longitud, o ninguna de las dos.',
    path: ['privateLatitude'],
  });

/* -------------------------------------------------------------------------- */
/* Actualizacion parcial del nucleo                                           */
/* -------------------------------------------------------------------------- */

/**
 * Campo de texto actualizable.
 *
 * Distingue tres situaciones que un `PATCH` necesita separar:
 *
 * - ausente    -> `undefined`, no se toca la columna;
 * - `null`/""  -> `null`, se limpia la columna;
 * - con valor  -> se recorta y se guarda.
 */
function updatableText(max: number) {
  return z
    .string()
    .max(max)
    .nullish()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    });
}

/**
 * Datos del nucleo que el admin puede editar.
 *
 * Es un `strictObject` a proposito: cualquier clave no listada (`id`,
 * `createdAt`, `publishedAt` y sobre todo `publicationStatus`) se rechaza en
 * lugar de ignorarse en silencio. El estado editorial se cambia unicamente
 * con `updatePropertyStatus`.
 */
export const propertyCoreUpdateSchema = z.strictObject({
  code: z.string().max(64).optional(),
  propertyTypeId: z.number().int().positive().nullable().optional(),

  commercialStatus: commercialStatusSchema.optional(),
  isFeatured: z.boolean().optional(),
  showWhenSold: z.boolean().optional(),

  priceMode: priceModeSchema.optional(),
  priceAmountMinor: z.number().int().nonnegative().nullable().optional(),
  currencyCode: supportedCurrencyCodeSchema.nullable().optional(),

  areaSquareMeters: z.number().positive().nullable().optional(),

  province: updatableText(120),
  canton: updatableText(120),
  district: updatableText(120),
  locality: updatableText(120),

  privateLatitude: latitudeSchema.nullable().optional(),
  privateLongitude: longitudeSchema.nullable().optional(),
  publicLatitude: latitudeSchema.nullable().optional(),
  publicLongitude: longitudeSchema.nullable().optional(),
  locationPrecision: locationPrecisionSchema.optional(),
});

export type PropertyCoreUpdateInput = z.input<typeof propertyCoreUpdateSchema>;
export type PropertyCoreUpdate = z.output<typeof propertyCoreUpdateSchema>;

/** Entrada del upsert de traducciones. Los cuatro textos son opcionales. */
export const propertyTranslationUpsertSchema = z.strictObject({
  locale: localeSchema,
  slug: z.string().nullish().optional(),
  title: updatableText(200),
  marketingDescription: updatableText(20_000),
  technicalDescription: updatableText(20_000),
});

export type PropertyTranslationUpsertInput = z.input<typeof propertyTranslationUpsertSchema>;
export type PropertyTranslationUpsert = z.output<typeof propertyTranslationUpsertSchema>;
