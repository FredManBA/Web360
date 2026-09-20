import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  COMMERCIAL_STATUSES,
  CONTACT_METHODS,
  CONTACT_STATUSES,
  LOCALES,
  LOCATION_PRECISIONS,
  MEDIA_KINDS,
  PRICE_MODES,
  PUBLICATION_STATUSES,
  SYSTEM_PROPERTY_TYPE_KEYS,
} from '../lib/domain/vocabularies';
import type { Feature, Tour, SocialLink } from '../lib/domain/content';
const dates = () => ({
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
});
export const properties = sqliteTable(
  'properties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    status: text('status', { enum: PUBLICATION_STATUSES }).notNull().default('draft'),
    commercialStatus: text('commercial_status', { enum: COMMERCIAL_STATUSES })
      .notNull()
      .default('available'),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    type: text('type', { enum: SYSTEM_PROPERTY_TYPE_KEYS }).notNull().default('lot'),
    priceMode: text('price_mode', { enum: PRICE_MODES }).notNull().default('contact'),
    priceAmountMinor: integer('price_amount_minor'),
    currencyCode: text('currency_code'),
    areaSquareMeters: real('area_square_meters'),
    province: text('province'),
    canton: text('canton'),
    district: text('district'),
    locality: text('locality'),
    mapLatitude: real('map_latitude'),
    mapLongitude: real('map_longitude'),
    locationPrecision: text('location_precision', { enum: LOCATION_PRECISIONS })
      .notNull()
      .default('approximate'),
    slugEs: text('slug_es'),
    titleEs: text('title_es'),
    descriptionEs: text('description_es'),
    detailsEs: text('details_es'),
    slugEn: text('slug_en'),
    titleEn: text('title_en'),
    descriptionEn: text('description_en'),
    detailsEn: text('details_en'),
    featuresJson: text('features_json', { mode: 'json' })
      .$type<Feature[]>()
      .notNull()
      .default(sql`'[]'`),
    tourJson: text('tour_json', { mode: 'json' }).$type<Tour | null>(),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    ...dates(),
  },
  (t) => [
    uniqueIndex('properties_code_unique').on(t.code),
    uniqueIndex('properties_slug_es_unique').on(t.slugEs),
    uniqueIndex('properties_slug_en_unique').on(t.slugEn),
    index('properties_status_idx').on(t.status),
    check('properties_status_check', sql`${t.status} IN ('draft','published')`),
    check(
      'properties_type_check',
      sql`${t.type} IN ('lot','house','farm','land','commercial','other')`,
    ),
    check(
      'properties_commercial_check',
      sql`${t.commercialStatus} IN ('available','offer_received','reserved','sold')`,
    ),
    check('properties_price_check', sql`${t.priceMode} IN ('exact','negotiable','contact')`),
    check('properties_precision_check', sql`${t.locationPrecision} IN ('exact','approximate')`),
    check('properties_code_check', sql`length(trim(${t.code})) > 0`),
    check(
      'properties_amount_check',
      sql`${t.priceAmountMinor} IS NULL OR ${t.priceAmountMinor} >= 0`,
    ),
    check('properties_area_check', sql`${t.areaSquareMeters} IS NULL OR ${t.areaSquareMeters} > 0`),
    check(
      'properties_latitude_check',
      sql`${t.mapLatitude} IS NULL OR ${t.mapLatitude} BETWEEN -90 AND 90`,
    ),
    check(
      'properties_longitude_check',
      sql`${t.mapLongitude} IS NULL OR ${t.mapLongitude} BETWEEN -180 AND 180`,
    ),
    check(
      'properties_features_check',
      sql`json_valid(${t.featuresJson}) AND json_type(${t.featuresJson}) = 'array'`,
    ),
    check(
      'properties_tour_check',
      sql`${t.tourJson} IS NULL OR (json_valid(${t.tourJson}) AND json_type(${t.tourJson}) = 'object')`,
    ),
  ],
);
export const media = sqliteTable(
  'media',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: MEDIA_KINDS }).notNull(),
    objectKey: text('object_key'),
    youtubeVideoId: text('youtube_video_id'),
    mimeType: text('mime_type'),
    fileSizeBytes: integer('file_size_bytes'),
    width: integer('width'),
    height: integer('height'),
    sortOrder: integer('sort_order').notNull().default(0),
    isCover: integer('is_cover', { mode: 'boolean' }).notNull().default(false),
    altEs: text('alt_es'),
    altEn: text('alt_en'),
    ...dates(),
  },
  (t) => [
    index('media_property_order_idx').on(t.propertyId, t.sortOrder),
    uniqueIndex('media_object_key_unique').on(t.objectKey),
    uniqueIndex('media_one_cover')
      .on(t.propertyId)
      .where(sql`${t.isCover} = 1`),
    check(
      'media_source_check',
      sql`(${t.kind} IN ('image','panorama') AND ${t.objectKey} IS NOT NULL AND length(${t.objectKey}) > 0 AND ${t.youtubeVideoId} IS NULL) OR (${t.kind} = 'youtube' AND ${t.youtubeVideoId} IS NOT NULL AND length(${t.youtubeVideoId}) = 11 AND ${t.objectKey} IS NULL)`,
    ),
    check('media_cover_check', sql`${t.isCover} = 0 OR ${t.kind} = 'image'`),
  ],
);
export const siteSettings = sqliteTable(
  'site_settings',
  {
    id: integer('id').primaryKey().default(1),
    businessName: text('business_name'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    email: text('email'),
    address: text('address'),
    notificationsEmail: text('notifications_email'),
    logoObjectKey: text('logo_object_key'),
    faviconObjectKey: text('favicon_object_key'),
    socialImageObjectKey: text('social_image_object_key'),
    heroObjectKey: text('hero_object_key'),
    brandTaglineEs: text('brand_tagline_es'),
    heroTitleEs: text('hero_title_es'),
    heroSubtitleEs: text('hero_subtitle_es'),
    seoTitleEs: text('seo_title_es'),
    seoDescriptionEs: text('seo_description_es'),
    brandTaglineEn: text('brand_tagline_en'),
    heroTitleEn: text('hero_title_en'),
    heroSubtitleEn: text('hero_subtitle_en'),
    seoTitleEn: text('seo_title_en'),
    seoDescriptionEn: text('seo_description_en'),
    defaultCurrencyCode: text('default_currency_code').notNull().default('USD'),
    socialLinksJson: text('social_links_json', { mode: 'json' })
      .$type<SocialLink[]>()
      .notNull()
      .default(sql`'[]'`),
    ...dates(),
  },
  (t) => [
    check('site_settings_singleton', sql`${t.id} = 1`),
    check(
      'site_settings_social_check',
      sql`json_valid(${t.socialLinksJson}) AND json_type(${t.socialLinksJson}) = 'array'`,
    ),
  ],
);
export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    propertyId: integer('property_id').references(() => properties.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    preferredContactMethod: text('preferred_contact_method', { enum: CONTACT_METHODS }).notNull(),
    contactValue: text('contact_value').notNull(),
    message: text('message'),
    locale: text('locale', { enum: LOCALES }).notNull().default('es'),
    status: text('status', { enum: CONTACT_STATUSES }).notNull().default('new'),
    consentAcceptedAt: integer('consent_accepted_at', { mode: 'timestamp' }),
    ...dates(),
  },
  (t) => [
    index('contacts_status_created_idx').on(t.status, t.createdAt),
    check('contacts_status_check', sql`${t.status} IN ('new','reviewed')`),
    check('contacts_locale_check', sql`${t.locale} IN ('es','en')`),
  ],
);
