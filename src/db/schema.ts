/**
 * Esquema de base de datos de CodeLoba (Cloudflare D1 / SQLite).
 *
 * Fase 1A: nucleo del modelo de propiedades.
 *
 * Principio de modelado: el estado editorial (`publication_status`) y el
 * estado comercial (`commercial_status`) son columnas independientes. Una
 * propiedad puede estar `published` y a la vez `reserved`.
 *
 * Las propiedades en borrador pueden estar incompletas, asi que la base de
 * datos solo exige lo que es identidad o integridad referencial. Las reglas
 * de "esta propiedad ya puede publicarse" se validaran en la aplicacion.
 */

import { relations, sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

/* -------------------------------------------------------------------------- */
/* Vocabularios                                                               */
/* -------------------------------------------------------------------------- */

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

/** Lista SQL de un vocabulario, para usarla dentro de un CHECK ... IN (...). */
function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/* -------------------------------------------------------------------------- */
/* Timestamps                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Todas las fechas se guardan como INTEGER (segundos unix, UTC), que es la
 * representacion mas compacta y ordenable en SQLite/D1.
 */
const createdAt = integer('created_at', { mode: 'timestamp' })
  .notNull()
  .default(sql`(unixepoch())`);

const updatedAt = integer('updated_at', { mode: 'timestamp' })
  .notNull()
  .default(sql`(unixepoch())`)
  .$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- */
/* property_types                                                             */
/* -------------------------------------------------------------------------- */

export const propertyTypes = sqliteTable(
  'property_types',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    /**
     * Identifica los tipos predefinidos (`lot`, `house`, `farm`, `land`,
     * `commercial`, `other`). Los tipos creados por el admin llevan NULL.
     * SQLite admite varios NULL en un indice unico, asi que el UNIQUE solo
     * impide duplicar los tipos de sistema.
     */
    systemKey: text('system_key'),

    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),

    createdAt,
    updatedAt,
  },
  (table) => [unique('property_types_system_key_unique').on(table.systemKey)],
);

/* -------------------------------------------------------------------------- */
/* property_type_translations                                                 */
/* -------------------------------------------------------------------------- */

export const propertyTypeTranslations = sqliteTable(
  'property_type_translations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyTypeId: integer('property_type_id')
      .notNull()
      .references(() => propertyTypes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    /** El nombre es la razon de ser de la fila, por eso si es obligatorio. */
    name: text('name').notNull(),

    createdAt,
    updatedAt,
  },
  (table) => [
    unique('property_type_translations_type_locale_unique').on(table.propertyTypeId, table.locale),
    index('property_type_translations_type_idx').on(table.propertyTypeId),
    check(
      'property_type_translations_locale_check',
      sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* properties                                                                 */
/* -------------------------------------------------------------------------- */

export const properties = sqliteTable(
  'properties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    /** Codigo humano unico (futuro `LOBA-001`). La generacion llega despues. */
    code: text('code').notNull(),

    /**
     * Nullable a proposito: un borrador puede existir antes de decidir el
     * tipo. Es obligatorio a nivel de negocio para poder publicar.
     */
    propertyTypeId: integer('property_type_id').references(() => propertyTypes.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),

    // -- Estados (independientes entre si) --------------------------------
    publicationStatus: text('publication_status', { enum: PUBLICATION_STATUSES })
      .notNull()
      .default('draft'),

    commercialStatus: text('commercial_status', { enum: COMMERCIAL_STATUSES })
      .notNull()
      .default('available'),

    isFeatured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),

    /** Si una propiedad vendida sigue visible en el catalogo publico. */
    showWhenSold: integer('show_when_sold', { mode: 'boolean' }).notNull().default(false),

    // -- Precio ------------------------------------------------------------
    priceMode: text('price_mode', { enum: PRICE_MODES }).notNull().default('contact'),

    /** Unidades monetarias menores. USD 125.000,00 -> 12500000. */
    priceAmountMinor: integer('price_amount_minor'),

    /** ISO 4217 en mayusculas: USD, CRC. Sin conversion entre monedas. */
    currencyCode: text('currency_code'),

    // -- Superficie --------------------------------------------------------
    /** Unica fuente de verdad. Hectareas, ft2 y acres se derivan en la app. */
    areaSquareMeters: real('area_square_meters'),

    // -- Ubicacion administrativa -----------------------------------------
    province: text('province'),
    canton: text('canton'),
    district: text('district'),
    locality: text('locality'),

    // -- Coordenadas -------------------------------------------------------
    /** Nunca deben salir en una respuesta publica. */
    privateLatitude: real('private_latitude'),
    privateLongitude: real('private_longitude'),

    /** Las unicas que puede consumir el frontend publico. */
    publicLatitude: real('public_latitude'),
    publicLongitude: real('public_longitude'),

    /** Por defecto `approximate`: nunca se expone de mas por descuido. */
    locationPrecision: text('location_precision', { enum: LOCATION_PRECISIONS })
      .notNull()
      .default('approximate'),

    // -- Fechas ------------------------------------------------------------
    createdAt,
    updatedAt,
    publishedAt: integer('published_at', { mode: 'timestamp' }),
  },
  (table) => [
    unique('properties_code_unique').on(table.code),

    index('properties_type_idx').on(table.propertyTypeId),
    index('properties_publication_status_published_at_idx').on(
      table.publicationStatus,
      table.publishedAt,
    ),
    index('properties_commercial_status_idx').on(table.commercialStatus),
    index('properties_is_featured_idx').on(table.isFeatured),

    check(
      'properties_publication_status_check',
      sql`${table.publicationStatus} IN (${sql.raw(sqlList(PUBLICATION_STATUSES))})`,
    ),
    check(
      'properties_commercial_status_check',
      sql`${table.commercialStatus} IN (${sql.raw(sqlList(COMMERCIAL_STATUSES))})`,
    ),
    check(
      'properties_price_mode_check',
      sql`${table.priceMode} IN (${sql.raw(sqlList(PRICE_MODES))})`,
    ),
    check(
      'properties_location_precision_check',
      sql`${table.locationPrecision} IN (${sql.raw(sqlList(LOCATION_PRECISIONS))})`,
    ),

    check('properties_code_not_blank_check', sql`length(trim(${table.code})) > 0`),

    /** ISO 4217: exactamente tres letras mayusculas, o NULL. */
    check(
      'properties_currency_code_check',
      sql`${table.currencyCode} IS NULL OR ${table.currencyCode} GLOB '[A-Z][A-Z][A-Z]'`,
    ),

    check(
      'properties_price_amount_minor_check',
      sql`${table.priceAmountMinor} IS NULL OR ${table.priceAmountMinor} >= 0`,
    ),

    check(
      'properties_area_square_meters_check',
      sql`${table.areaSquareMeters} IS NULL OR ${table.areaSquareMeters} > 0`,
    ),

    check(
      'properties_private_latitude_check',
      sql`${table.privateLatitude} IS NULL OR ${table.privateLatitude} BETWEEN -90 AND 90`,
    ),
    check(
      'properties_private_longitude_check',
      sql`${table.privateLongitude} IS NULL OR ${table.privateLongitude} BETWEEN -180 AND 180`,
    ),
    check(
      'properties_public_latitude_check',
      sql`${table.publicLatitude} IS NULL OR ${table.publicLatitude} BETWEEN -90 AND 90`,
    ),
    check(
      'properties_public_longitude_check',
      sql`${table.publicLongitude} IS NULL OR ${table.publicLongitude} BETWEEN -180 AND 180`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_translations                                                      */
/* -------------------------------------------------------------------------- */

export const propertyTranslations = sqliteTable(
  'property_translations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    /**
     * Todo el contenido es nullable: una propiedad puede tener el espanol
     * listo y el ingles todavia vacio sin dejar de ser valida.
     */
    slug: text('slug'),
    title: text('title'),
    marketingDescription: text('marketing_description'),
    technicalDescription: text('technical_description'),

    createdAt,
    updatedAt,
  },
  (table) => [
    unique('property_translations_property_locale_unique').on(table.propertyId, table.locale),
    unique('property_translations_locale_slug_unique').on(table.locale, table.slug),

    index('property_translations_property_idx').on(table.propertyId),

    check(
      'property_translations_locale_check',
      sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relaciones                                                                 */
/* -------------------------------------------------------------------------- */

export const propertyTypesRelations = relations(propertyTypes, ({ many }) => ({
  translations: many(propertyTypeTranslations),
  properties: many(properties),
}));

export const propertyTypeTranslationsRelations = relations(propertyTypeTranslations, ({ one }) => ({
  propertyType: one(propertyTypes, {
    fields: [propertyTypeTranslations.propertyTypeId],
    references: [propertyTypes.id],
  }),
}));

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  propertyType: one(propertyTypes, {
    fields: [properties.propertyTypeId],
    references: [propertyTypes.id],
  }),
  translations: many(propertyTranslations),
}));

export const propertyTranslationsRelations = relations(propertyTranslations, ({ one }) => ({
  property: one(properties, {
    fields: [propertyTranslations.propertyId],
    references: [properties.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/* Tipos inferidos                                                            */
/* -------------------------------------------------------------------------- */

export type PropertyType = typeof propertyTypes.$inferSelect;
export type NewPropertyType = typeof propertyTypes.$inferInsert;

export type PropertyTypeTranslation = typeof propertyTypeTranslations.$inferSelect;
export type NewPropertyTypeTranslation = typeof propertyTypeTranslations.$inferInsert;

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;

export type PropertyTranslation = typeof propertyTranslations.$inferSelect;
export type NewPropertyTranslation = typeof propertyTranslations.$inferInsert;
