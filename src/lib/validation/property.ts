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
