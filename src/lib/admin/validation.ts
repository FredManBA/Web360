import { z } from 'zod';
import {
  COMMERCIAL_STATUSES,
  LOCATION_PRECISIONS,
  PRICE_MODES,
  SYSTEM_PROPERTY_TYPE_KEYS,
} from '../domain/vocabularies';
import { isValidSlug } from '../domain/slug';
import { isValidCurrencyCode } from '../domain/money';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);
const slug = text(96).refine(
  (v) => v === null || isValidSlug(v),
  'Usa minúsculas, números y guiones simples en el slug.',
);
const currency = text(3).refine((v) => v === null || isValidCurrencyCode(v), 'Moneda inválida.');
export const featureSchema = z.strictObject({
  label_es: text(200),
  label_en: text(200),
  value_es: text(1000),
  value_en: text(1000),
});

/** Una escritura completa. Estado, identidad y tour no son campos editables aquí. */
export const propertyInput = z.strictObject({
  type: z.enum(SYSTEM_PROPERTY_TYPE_KEYS),
  commercialStatus: z.enum(COMMERCIAL_STATUSES),
  featured: z.boolean(),
  priceMode: z.enum(PRICE_MODES),
  priceAmountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  currencyCode: currency,
  areaSquareMeters: z.number().positive().nullable(),
  province: text(200),
  canton: text(200),
  district: text(200),
  locality: text(300),
  mapLatitude: z.number().min(-90).max(90).nullable(),
  mapLongitude: z.number().min(-180).max(180).nullable(),
  locationPrecision: z.enum(LOCATION_PRECISIONS),
  titleEs: text(200),
  slugEs: slug,
  descriptionEs: text(10000),
  detailsEs: text(20000),
  titleEn: text(200),
  slugEn: slug,
  descriptionEn: text(10000),
  detailsEn: text(20000),
  featuresJson: z.array(featureSchema).max(100),
});
export type PropertyInput = z.infer<typeof propertyInput>;

const email = text(250).refine(
  (v) => v === null || z.email().safeParse(v).success,
  'Email inválido.',
);
export const socialSchema = z.strictObject({
  platform: z.string().trim().min(1).max(100),
  url: z
    .url()
    .refine((v) => ['https:', 'http:'].includes(new URL(v).protocol), 'Usa una URL http o https.'),
});
export const settingsInput = z.strictObject({
  businessName: text(200),
  phone: text(100),
  whatsapp: text(100),
  email,
  address: text(1000),
  notificationsEmail: email,
  defaultCurrencyCode: z.string().refine(isValidCurrencyCode, 'Moneda inválida.'),
  brandTaglineEs: text(300),
  heroTitleEs: text(300),
  heroSubtitleEs: text(1000),
  seoTitleEs: text(200),
  seoDescriptionEs: text(500),
  brandTaglineEn: text(300),
  heroTitleEn: text(300),
  heroSubtitleEn: text(1000),
  seoTitleEn: text(200),
  seoDescriptionEn: text(500),
  socialLinksJson: z.array(socialSchema).max(20),
});
export const mediaPatch = z.strictObject({
  sortOrder: z.number().int().nonnegative().max(10000).optional(),
  isCover: z.literal(true).optional(),
  altEs: text(1000).optional(),
  altEn: text(1000).optional(),
});
export const youtubeInput = z.strictObject({
  kind: z.literal('youtube'),
  youtubeVideoId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/, 'El ID de YouTube debe tener 11 caracteres.'),
});
