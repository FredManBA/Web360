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
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
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
  PUBLICATION_ACTIONS,
  PUBLICATION_REQUEST_STATUSES,
  PUBLICATION_STATUSES,
  REVIEW_STATUSES,
  SOURCE_PROVIDERS,
} from '../lib/domain/vocabularies';

/* -------------------------------------------------------------------------- */
/* Vocabularios                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Los vocabularios viven en `src/lib/domain/vocabularies.ts` para que Drizzle,
 * Zod y la logica de dominio compartan una sola fuente de verdad. Se
 * reexportan aqui por comodidad de quien ya importa desde el esquema.
 */
export {
  LOCALES,
  PUBLICATION_STATUSES,
  COMMERCIAL_STATUSES,
  PRICE_MODES,
  LOCATION_PRECISIONS,
  MEDIA_KINDS,
  SOURCE_PROVIDERS,
  CONTACT_METHODS,
  CONTACT_STATUSES,
  REVIEW_STATUSES,
  PUBLICATION_ACTIONS,
  PUBLICATION_REQUEST_STATUSES,
} from '../lib/domain/vocabularies';

export type {
  Locale,
  PublicationStatus,
  CommercialStatus,
  PriceMode,
  LocationPrecision,
  MediaKind,
  SourceProvider,
  ContactMethod,
  ContactStatus,
  ReviewStatus,
} from '../lib/domain/vocabularies';

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
/* property_feature_groups                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Agrupacion opcional de caracteristicas ("Terreno", "Servicios", "Accesos").
 *
 * Los grupos pertenecen a UNA propiedad concreta, no son catalogos globales:
 * cada propiedad organiza sus caracteristicas como le convenga.
 */
export const propertyFeatureGroups = sqliteTable(
  'property_feature_groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    /** Orden manual. No es unico: la UI podra normalizar posiciones. */
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt,
    updatedAt,
  },
  (table) => [
    // Cubre tambien las busquedas por property_id sola (prefijo izquierdo).
    index('property_feature_groups_property_sort_idx').on(table.propertyId, table.sortOrder),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_feature_group_translations                                        */
/* -------------------------------------------------------------------------- */

export const propertyFeatureGroupTranslations = sqliteTable(
  'property_feature_group_translations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyFeatureGroupId: integer('property_feature_group_id')
      .notNull()
      .references(() => propertyFeatureGroups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    /** Nullable: un borrador puede tener el grupo creado y aun sin nombrar. */
    name: text('name'),

    createdAt,
    updatedAt,
  },
  (table) => [
    unique('property_feature_group_translations_group_locale_unique').on(
      table.propertyFeatureGroupId,
      table.locale,
    ),
    index('property_feature_group_translations_group_idx').on(table.propertyFeatureGroupId),
    check(
      'property_feature_group_translations_locale_check',
      sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_features                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Caracteristica concreta de una propiedad.
 *
 * Regla que la base de datos NO puede garantizar: una caracteristica solo
 * deberia pertenecer a un grupo de SU MISMA propiedad. Expresarlo en SQLite
 * exigiria triggers o una FK compuesta artificial, asi que queda como
 * validacion de aplicacion en una fase posterior.
 */
export const propertyFeatures = sqliteTable(
  'property_features',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    /**
     * Opcional: una caracteristica puede no estar agrupada. Al borrar el
     * grupo se pone a NULL, de modo que la caracteristica sobrevive y
     * simplemente queda sin agrupar.
     */
    propertyFeatureGroupId: integer('property_feature_group_id').references(
      () => propertyFeatureGroups.id,
      { onDelete: 'set null', onUpdate: 'cascade' },
    ),

    sortOrder: integer('sort_order').notNull().default(0),

    createdAt,
    updatedAt,
  },
  (table) => [
    index('property_features_property_sort_idx').on(table.propertyId, table.sortOrder),
    index('property_features_group_idx').on(table.propertyFeatureGroupId),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_feature_translations                                              */
/* -------------------------------------------------------------------------- */

/**
 * Contenido localizado de una caracteristica.
 *
 * Para el MVP el valor es texto libre (`label` + `value`), por ejemplo
 * "Frente de calle" / "80 m". No se tipan valores numericos, booleanos ni
 * unidades: la presentacion es responsabilidad de la aplicacion.
 */
export const propertyFeatureTranslations = sqliteTable(
  'property_feature_translations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyFeatureId: integer('property_feature_id')
      .notNull()
      .references(() => propertyFeatures.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    /** Nullable en borradores. */
    label: text('label'),

    /** Nullable: hay caracteristicas sin valor ("Vista al mar"). */
    value: text('value'),

    createdAt,
    updatedAt,
  },
  (table) => [
    unique('property_feature_translations_feature_locale_unique').on(
      table.propertyFeatureId,
      table.locale,
    ),
    index('property_feature_translations_feature_idx').on(table.propertyFeatureId),
    check(
      'property_feature_translations_locale_check',
      sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_media_groups                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Agrupacion personalizable de multimedia ("Fotografias", "Drone", "Interior").
 * Igual que los grupos de caracteristicas, pertenece a UNA propiedad.
 */
export const propertyMediaGroups = sqliteTable(
  'property_media_groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    sortOrder: integer('sort_order').notNull().default(0),

    createdAt,
    updatedAt,
  },
  (table) => [
    index('property_media_groups_property_sort_idx').on(table.propertyId, table.sortOrder),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_media_group_translations                                          */
/* -------------------------------------------------------------------------- */

export const propertyMediaGroupTranslations = sqliteTable(
  'property_media_group_translations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyMediaGroupId: integer('property_media_group_id')
      .notNull()
      .references(() => propertyMediaGroups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    /** Nullable: el grupo puede existir sin nombre mientras es borrador. */
    name: text('name'),

    createdAt,
    updatedAt,
  },
  (table) => [
    // El UNIQUE ya indexa property_media_group_id por prefijo izquierdo.
    unique('property_media_group_translations_group_locale_unique').on(
      table.propertyMediaGroupId,
      table.locale,
    ),
    check(
      'property_media_group_translations_locale_check',
      sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_media                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Tabla unica para todo el multimedia de una propiedad.
 *
 * El archivo vive en R2 (`object_key`) o, para videos largos del MVP, en
 * YouTube no listado (`youtube_video_id`). Nunca se guarda la URL completa
 * de YouTube como fuente de verdad: se reconstruye desde el id.
 *
 * Los originales archivados fuera (Google One) no se representan aqui.
 */
export const propertyMedia = sqliteTable(
  'property_media',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    /** Al borrar el grupo, el archivo sobrevive y queda sin agrupar. */
    propertyMediaGroupId: integer('property_media_group_id').references(
      () => propertyMediaGroups.id,
      { onDelete: 'set null', onUpdate: 'cascade' },
    ),

    mediaKind: text('media_kind', { enum: MEDIA_KINDS }).notNull(),
    sourceProvider: text('source_provider', { enum: SOURCE_PROVIDERS }).notNull(),

    // -- R2 ----------------------------------------------------------------
    objectKey: text('object_key'),
    mimeType: text('mime_type'),
    fileSizeBytes: integer('file_size_bytes'),

    // -- YouTube -----------------------------------------------------------
    youtubeVideoId: text('youtube_video_id'),

    // -- Metadata visual ---------------------------------------------------
    width: integer('width'),
    height: integer('height'),
    durationSeconds: real('duration_seconds'),

    // -- Presentacion ------------------------------------------------------
    sortOrder: integer('sort_order').notNull().default(0),
    isHero: integer('is_hero', { mode: 'boolean' }).notNull().default(false),
    isCatalogCover: integer('is_catalog_cover', { mode: 'boolean' }).notNull().default(false),

    createdAt,
    updatedAt,
  },
  (table) => [
    index('property_media_property_sort_idx').on(table.propertyId, table.sortOrder),
    index('property_media_group_idx').on(table.propertyMediaGroupId),

    /** Solo aplica a filas con valor: SQLite admite multiples NULL. */
    unique('property_media_object_key_unique').on(table.objectKey),

    /**
     * Como maximo un hero y una portada por propiedad. Los indices parciales
     * de SQLite expresan esto sin triggers ni columnas artificiales.
     */
    uniqueIndex('property_media_one_hero_per_property_idx')
      .on(table.propertyId)
      .where(sql`${table.isHero} = 1`),
    uniqueIndex('property_media_one_catalog_cover_per_property_idx')
      .on(table.propertyId)
      .where(sql`${table.isCatalogCover} = 1`),

    check(
      'property_media_kind_check',
      sql`${table.mediaKind} IN (${sql.raw(sqlList(MEDIA_KINDS))})`,
    ),
    check(
      'property_media_source_provider_check',
      sql`${table.sourceProvider} IN (${sql.raw(sqlList(SOURCE_PROVIDERS))})`,
    ),

    /**
     * Coherencia de la fuente:
     * - r2      -> hace falta object_key y no puede haber youtube_video_id.
     * - youtube -> solo video, hace falta el id y no puede haber object_key.
     */
    check(
      'property_media_source_consistency_check',
      sql`(
        ${table.sourceProvider} = 'r2'
        AND ${table.objectKey} IS NOT NULL
        AND ${table.youtubeVideoId} IS NULL
      ) OR (
        ${table.sourceProvider} = 'youtube'
        AND ${table.mediaKind} = 'video'
        AND ${table.youtubeVideoId} IS NOT NULL
        AND ${table.objectKey} IS NULL
      )`,
    ),

    /** Un documento o un panorama no pueden ser hero en el MVP. */
    check(
      'property_media_hero_kind_check',
      sql`${table.isHero} = 0 OR ${table.mediaKind} IN ('image', 'video')`,
    ),

    /** La portada de catalogo solo puede ser una imagen. */
    check(
      'property_media_catalog_cover_kind_check',
      sql`${table.isCatalogCover} = 0 OR ${table.mediaKind} = 'image'`,
    ),

    check('property_media_width_check', sql`${table.width} IS NULL OR ${table.width} > 0`),
    check('property_media_height_check', sql`${table.height} IS NULL OR ${table.height} > 0`),
    check(
      'property_media_file_size_check',
      sql`${table.fileSizeBytes} IS NULL OR ${table.fileSizeBytes} > 0`,
    ),
    check(
      'property_media_duration_check',
      sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} > 0`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_media_translations                                                */
/* -------------------------------------------------------------------------- */

/**
 * Textos localizados de cualquier tipo de multimedia, documentos incluidos
 * (el `title` sirve como nombre publico del documento).
 */
export const propertyMediaTranslations = sqliteTable(
  'property_media_translations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyMediaId: integer('property_media_id')
      .notNull()
      .references(() => propertyMedia.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    title: text('title'),
    altText: text('alt_text'),
    caption: text('caption'),

    createdAt,
    updatedAt,
  },
  (table) => [
    unique('property_media_translations_media_locale_unique').on(
      table.propertyMediaId,
      table.locale,
    ),
    check(
      'property_media_translations_locale_check',
      sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_tour_nodes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Nodo de un recorrido 360.
 *
 * El panorama NO se duplica: el nodo apunta a la fila de `property_media`
 * con `media_kind = 'panorama'`. Por eso el borrado del media es RESTRICT,
 * para no dejar el tour roto por accidente.
 */
export const propertyTourNodes = sqliteTable(
  'property_tour_nodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    propertyMediaId: integer('property_media_id')
      .notNull()
      .references(() => propertyMedia.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    sortOrder: integer('sort_order').notNull().default(0),
    isStart: integer('is_start', { mode: 'boolean' }).notNull().default(false),

    /**
     * Camara inicial del nodo. La convencion de unidades (grados o radianes)
     * se fijara al integrar el visor; por eso solo se valida que el FOV sea
     * positivo, que es cierto en cualquiera de las dos.
     */
    initialYaw: real('initial_yaw'),
    initialPitch: real('initial_pitch'),
    initialFov: real('initial_fov'),

    createdAt,
    updatedAt,
  },
  (table) => [
    index('property_tour_nodes_property_sort_idx').on(table.propertyId, table.sortOrder),

    /** Un panorama representa un unico nodo dentro del MVP. */
    unique('property_tour_nodes_media_unique').on(table.propertyMediaId),

    /** Como maximo un nodo inicial por propiedad (indice parcial). */
    uniqueIndex('property_tour_nodes_one_start_per_property_idx')
      .on(table.propertyId)
      .where(sql`${table.isStart} = 1`),

    check(
      'property_tour_nodes_initial_fov_check',
      sql`${table.initialFov} IS NULL OR ${table.initialFov} > 0`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_tour_node_translations                                            */
/* -------------------------------------------------------------------------- */

export const propertyTourNodeTranslations = sqliteTable(
  'property_tour_node_translations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyTourNodeId: integer('property_tour_node_id')
      .notNull()
      .references(() => propertyTourNodes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    /** "Entrada", "Camino principal", "Mirador". Nullable en borrador. */
    name: text('name'),

    createdAt,
    updatedAt,
  },
  (table) => [
    unique('property_tour_node_translations_node_locale_unique').on(
      table.propertyTourNodeId,
      table.locale,
    ),
    check(
      'property_tour_node_translations_locale_check',
      sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_tour_links                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Conexion dirigida entre dos nodos del recorrido, situada en el panorama
 * de origen mediante `yaw` / `pitch`.
 *
 * El enlace no tiene textos propios: la UI mostrara el nombre traducido del
 * nodo de destino.
 */
export const propertyTourLinks = sqliteTable(
  'property_tour_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    fromNodeId: integer('from_node_id')
      .notNull()
      .references(() => propertyTourNodes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    toNodeId: integer('to_node_id')
      .notNull()
      .references(() => propertyTourNodes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    /** Posicion del hotspot dentro del panorama de origen. */
    yaw: real('yaw').notNull().default(0),
    pitch: real('pitch').notNull().default(0),

    sortOrder: integer('sort_order').notNull().default(0),

    createdAt,
    updatedAt,
  },
  (table) => [
    // El UNIQUE ya indexa from_node_id por prefijo izquierdo.
    unique('property_tour_links_from_to_unique').on(table.fromNodeId, table.toNodeId),
    index('property_tour_links_to_node_idx').on(table.toNodeId),

    /** Un nodo no puede enlazar consigo mismo. */
    check('property_tour_links_no_self_link_check', sql`${table.fromNodeId} <> ${table.toNodeId}`),
  ],
);

/* -------------------------------------------------------------------------- */
/* map_points_of_interest                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Puntos de interes del mapa (playa, aeropuerto, hospital...). Son globales,
 * no pertenecen a una propiedad.
 *
 * `category` es texto corto a proposito: anadir una categoria nueva no debe
 * exigir una migracion. `icon` y `color` se guardan como configuracion.
 */
export const mapPointsOfInterest = sqliteTable(
  'map_points_of_interest',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    category: text('category').notNull(),

    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),

    icon: text('icon'),
    color: text('color'),

    isVisible: integer('is_visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt,
    updatedAt,
  },
  (table) => [
    /** Consulta del mapa publico: los visibles, en orden. */
    index('map_points_of_interest_visible_sort_idx').on(table.isVisible, table.sortOrder),

    check(
      'map_points_of_interest_category_not_blank_check',
      sql`length(trim(${table.category})) > 0`,
    ),
    check('map_points_of_interest_latitude_check', sql`${table.latitude} BETWEEN -90 AND 90`),
    check('map_points_of_interest_longitude_check', sql`${table.longitude} BETWEEN -180 AND 180`),
  ],
);

/* -------------------------------------------------------------------------- */
/* map_point_of_interest_translations                                         */
/* -------------------------------------------------------------------------- */

export const mapPointOfInterestTranslations = sqliteTable(
  'map_point_of_interest_translations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    pointOfInterestId: integer('point_of_interest_id')
      .notNull()
      .references(() => mapPointsOfInterest.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    name: text('name'),
    description: text('description'),

    createdAt,
    updatedAt,
  },
  (table) => [
    unique('map_point_of_interest_translations_poi_locale_unique').on(
      table.pointOfInterestId,
      table.locale,
    ),
    check(
      'map_point_of_interest_translations_locale_check',
      sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* contacts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Consultas recibidas. Esto NO es un CRM: solo conserva el mensaje y si ya
 * fue atendido.
 *
 * La consulta sobrevive a la propiedad que la origino (`ON DELETE SET NULL`),
 * porque un historico de contactos no debe perderse al borrar una ficha.
 * No hay soft delete: borrar un contacto lo elimina de verdad.
 */
export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    /** NULL cuando la consulta llega del formulario de contacto general. */
    propertyId: integer('property_id').references(() => properties.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),

    name: text('name').notNull(),

    preferredContactMethod: text('preferred_contact_method', { enum: CONTACT_METHODS }).notNull(),

    /** El dato tal cual lo escribio la persona (email, telefono, usuario...). */
    contactValue: text('contact_value').notNull(),

    message: text('message'),

    /** La web siempre sabe desde que idioma se envio el formulario. */
    locale: text('locale', { enum: LOCALES }).notNull(),

    status: text('status', { enum: CONTACT_STATUSES }).notNull().default('new'),

    /**
     * Momento en que se acepto el consentimiento. Nullable en base de datos
     * para no bloquear importaciones; el formulario publico lo exigira.
     */
    consentAcceptedAt: integer('consent_accepted_at', { mode: 'timestamp' }),

    createdAt,
    updatedAt,
  },
  (table) => [
    /** Bandeja de entrada: pendientes primero, mas recientes arriba. */
    index('contacts_status_created_at_idx').on(table.status, table.createdAt),
    index('contacts_property_idx').on(table.propertyId),

    check(
      'contacts_preferred_contact_method_check',
      sql`${table.preferredContactMethod} IN (${sql.raw(sqlList(CONTACT_METHODS))})`,
    ),
    check('contacts_status_check', sql`${table.status} IN (${sql.raw(sqlList(CONTACT_STATUSES))})`),
    check('contacts_locale_check', sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`),
    check('contacts_name_not_blank_check', sql`length(trim(${table.name})) > 0`),
    check('contacts_contact_value_not_blank_check', sql`length(trim(${table.contactValue})) > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* site_settings                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Configuracion global. Singleton *logico*: la aplicacion garantizara que
 * solo haya un registro activo, sin constraints artificiales ni triggers.
 *
 * Todos los campos son nullable porque el sitio se configura de forma
 * progresiva y no hay seed inicial.
 *
 * Branding: por ahora solo claves de objeto en R2. No hay `homeHeroMediaId`;
 * ver la nota de la fase sobre media global.
 */
export const siteSettings = sqliteTable(
  'site_settings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    businessName: text('business_name'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    email: text('email'),
    address: text('address'),

    /** Destinatario del enlace privado de revision. */
    reviewerEmail: text('reviewer_email'),
    /** Destinatario de los avisos de contactos nuevos. */
    notificationsEmail: text('notifications_email'),

    defaultCurrencyCode: text('default_currency_code'),

    logoObjectKey: text('logo_object_key'),
    faviconObjectKey: text('favicon_object_key'),
    defaultSocialImageObjectKey: text('default_social_image_object_key'),

    createdAt,
    updatedAt,
  },
  (table) => [
    /** Mismo formato ISO 4217 que `properties.currency_code`. */
    check(
      'site_settings_default_currency_code_check',
      sql`${table.defaultCurrencyCode} IS NULL OR ${table.defaultCurrencyCode} GLOB '[A-Z][A-Z][A-Z]'`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* site_setting_translations                                                  */
/* -------------------------------------------------------------------------- */

export const siteSettingTranslations = sqliteTable(
  'site_setting_translations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    siteSettingsId: integer('site_settings_id')
      .notNull()
      .references(() => siteSettings.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    brandTagline: text('brand_tagline'),
    homeHeroTitle: text('home_hero_title'),
    homeHeroSubtitle: text('home_hero_subtitle'),
    globalSeoTitle: text('global_seo_title'),
    globalSeoDescription: text('global_seo_description'),

    createdAt,
    updatedAt,
  },
  (table) => [
    unique('site_setting_translations_settings_locale_unique').on(
      table.siteSettingsId,
      table.locale,
    ),
    check(
      'site_setting_translations_locale_check',
      sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* site_social_links                                                          */
/* -------------------------------------------------------------------------- */

/**
 * `platform` es texto libre a proposito: anadir una red nueva no debe exigir
 * una migracion. El formato de la URL se valida en aplicacion.
 */
export const siteSocialLinks = sqliteTable(
  'site_social_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    platform: text('platform').notNull(),
    url: text('url').notNull(),

    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),

    createdAt,
    updatedAt,
  },
  (table) => [
    check('site_social_links_platform_not_blank_check', sql`length(trim(${table.platform})) > 0`),
    check('site_social_links_url_not_blank_check', sql`length(trim(${table.url})) > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* site_locales                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Idiomas del sitio. El nombre visible de cada idioma se resuelve en
 * aplicacion, por eso aqui no hay traducciones.
 */
export const siteLocales = sqliteTable(
  'site_locales',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    locale: text('locale', { enum: LOCALES }).notNull(),

    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt,
    updatedAt,
  },
  (table) => [
    unique('site_locales_locale_unique').on(table.locale),

    /**
     * Como maximo un idioma por defecto. El indice parcial solo cubre las
     * filas con `is_default = 1`, donde la columna vale siempre 1, de modo
     * que el UNIQUE deja pasar una sola.
     */
    uniqueIndex('site_locales_one_default_idx')
      .on(table.isDefault)
      .where(sql`${table.isDefault} = 1`),

    check('site_locales_locale_check', sql`${table.locale} IN (${sql.raw(sqlList(LOCALES))})`),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_reviews                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Una solicitud concreta de revision. Cada envio a revision crea una fila
 * nueva; no es un historial editorial completo.
 *
 * Aprobar NO publica: la publicacion sigue siendo un acto manual del admin.
 */
export const propertyReviews = sqliteTable(
  'property_reviews',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    status: text('status', { enum: REVIEW_STATUSES }).notNull().default('pending'),

    /** A quien se envio el enlace privado. */
    reviewerEmail: text('reviewer_email'),
    reviewerComment: text('reviewer_comment'),

    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),

    createdAt,
    updatedAt,
  },
  (table) => [
    index('property_reviews_property_created_at_idx').on(table.propertyId, table.createdAt),
    index('property_reviews_status_idx').on(table.status),

    check(
      'property_reviews_status_check',
      sql`${table.status} IN (${sql.raw(sqlList(REVIEW_STATUSES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* property_review_tokens                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Enlace privado de revision.
 *
 * Solo se guarda el HASH del token, nunca el token en claro. El algoritmo de
 * hashing y la duracion concreta son decisiones de aplicacion/seguridad.
 *
 * `used_at` marca el consumo y `revoked_at` permite invalidarlo antes de que
 * expire. La fila no se actualiza mas alla de eso, por lo que no lleva
 * `updated_at`.
 */
export const propertyReviewTokens = sqliteTable(
  'property_review_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyReviewId: integer('property_review_id')
      .notNull()
      .references(() => propertyReviews.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    tokenHash: text('token_hash').notNull(),

    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),

    createdAt,
  },
  (table) => [
    unique('property_review_tokens_token_hash_unique').on(table.tokenHash),
    index('property_review_tokens_review_idx').on(table.propertyReviewId),

    /** Un token debe nacer con vigencia positiva (aunque luego caduque). */
    check('property_review_tokens_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'property_review_tokens_token_hash_not_blank_check',
      sql`length(trim(${table.tokenHash})) > 0`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* publication_requests                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Una peticion de publicar o retirar una propiedad.
 *
 * Existe porque publicar no es un UPDATE: el sitio publico es estatico y se
 * regenera fuera de la base. Entre "el admin lo pide" y "ya esta en la web"
 * hay un build que ocurre en otra maquina y puede fallar, asi que hace falta
 * una anotacion duradera que sobreviva a ese viaje de ida y vuelta.
 *
 * Lo que NO es: no es un estado editorial. La propiedad sigue en `approved`
 * mientras la peticion esta viva, y solo pasa a `published` cuando vuelve la
 * confirmacion. Por eso una peticion fallida no deja nada a medias.
 *
 * Del token de callback solo se guarda el HASH, igual que en los enlaces de
 * revision: es la unica credencial de quien confirma el resultado y no se
 * puede recuperar leyendo la base.
 */
export const publicationRequests = sqliteTable(
  'publication_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    action: text('action', { enum: PUBLICATION_ACTIONS }).notNull(),

    /**
     * Estado de la OPERACION, no de la propiedad.
     *
     * `abandoned` es terminal y no afirma nada sobre el build: solo que una
     * persona decidio dejar de esperar. Por eso no se mete en `failed`.
     */
    status: text('status', { enum: PUBLICATION_REQUEST_STATUSES }).notNull().default('pending'),

    /** Hash del token de callback. Nunca el token. */
    callbackTokenHash: text('callback_token_hash').notNull(),

    /**
     * Referencia opaca que devuelve quien ejecuta el build, si la da.
     *
     * No se interpreta aqui: para esta tabla es una cadena que sirve para
     * poder mirar el trabajo por fuera. Ninguna decision depende de ella.
     */
    jobRef: text('job_ref'),

    /**
     * Motivo resumido del desenlace, para el panel. Sin trazas ni detalles.
     *
     * Lo escriben los dos finales que no son un exito: el fallo cuenta que
     * salio mal, y el abandono, por que una persona decidio dejarlo. Es la
     * misma clase de dato —una frase corta para quien mire el historial—, asi
     * que no hace falta una segunda columna; lo que distingue un caso del otro
     * es `status`, no este texto.
     */
    errorSummary: text('error_summary'),

    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    /** Cuando el ejecutor acepto el trabajo. */
    startedAt: integer('started_at', { mode: 'timestamp' }),
    /** Cuando quedo en `done` o en `failed`. */
    finishedAt: integer('finished_at', { mode: 'timestamp' }),

    createdAt,
    updatedAt,
  },
  (table) => [
    /*
     * Idempotencia del callback: el token identifica UNA peticion y solo una.
     * Sin este indice unico, dos filas podrian responder al mismo secreto.
     */
    unique('publication_requests_callback_token_hash_unique').on(table.callbackTokenHash),

    /*
     * Como mucho una operacion viva por propiedad.
     *
     * Es la constraint que impide el escenario incoherente de verdad: pedir
     * "publicar" y "retirar" a la vez, o dos publicaciones en paralelo cuyos
     * callbacks lleguen en cualquier orden. El indice es PARCIAL porque el
     * historial si admite muchas filas terminadas por propiedad. Solo cuentan
     * como vivas `pending` y `building`: un abandono libera la propiedad en el
     * acto, igual que un exito o un fallo.
     */
    uniqueIndex('publication_requests_active_per_property_idx')
      .on(table.propertyId)
      .where(sql`status IN ('pending', 'building')`),

    index('publication_requests_property_created_at_idx').on(table.propertyId, table.createdAt),

    check(
      'publication_requests_action_check',
      sql`${table.action} IN (${sql.raw(sqlList(PUBLICATION_ACTIONS))})`,
    ),
    check(
      'publication_requests_status_check',
      sql`${table.status} IN (${sql.raw(sqlList(PUBLICATION_REQUEST_STATUSES))})`,
    ),
    check(
      'publication_requests_callback_token_hash_not_blank_check',
      sql`length(trim(${table.callbackTokenHash})) > 0`,
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
  featureGroups: many(propertyFeatureGroups),
  features: many(propertyFeatures),
  mediaGroups: many(propertyMediaGroups),
  media: many(propertyMedia),
  tourNodes: many(propertyTourNodes),
  contacts: many(contacts),
  reviews: many(propertyReviews),
  publicationRequests: many(publicationRequests),
}));

export const propertyTranslationsRelations = relations(propertyTranslations, ({ one }) => ({
  property: one(properties, {
    fields: [propertyTranslations.propertyId],
    references: [properties.id],
  }),
}));

export const propertyFeatureGroupsRelations = relations(propertyFeatureGroups, ({ one, many }) => ({
  property: one(properties, {
    fields: [propertyFeatureGroups.propertyId],
    references: [properties.id],
  }),
  translations: many(propertyFeatureGroupTranslations),
  features: many(propertyFeatures),
}));

export const propertyFeatureGroupTranslationsRelations = relations(
  propertyFeatureGroupTranslations,
  ({ one }) => ({
    featureGroup: one(propertyFeatureGroups, {
      fields: [propertyFeatureGroupTranslations.propertyFeatureGroupId],
      references: [propertyFeatureGroups.id],
    }),
  }),
);

export const propertyFeaturesRelations = relations(propertyFeatures, ({ one, many }) => ({
  property: one(properties, {
    fields: [propertyFeatures.propertyId],
    references: [properties.id],
  }),
  featureGroup: one(propertyFeatureGroups, {
    fields: [propertyFeatures.propertyFeatureGroupId],
    references: [propertyFeatureGroups.id],
  }),
  translations: many(propertyFeatureTranslations),
}));

export const propertyFeatureTranslationsRelations = relations(
  propertyFeatureTranslations,
  ({ one }) => ({
    feature: one(propertyFeatures, {
      fields: [propertyFeatureTranslations.propertyFeatureId],
      references: [propertyFeatures.id],
    }),
  }),
);

export const propertyMediaGroupsRelations = relations(propertyMediaGroups, ({ one, many }) => ({
  property: one(properties, {
    fields: [propertyMediaGroups.propertyId],
    references: [properties.id],
  }),
  translations: many(propertyMediaGroupTranslations),
  media: many(propertyMedia),
}));

export const propertyMediaGroupTranslationsRelations = relations(
  propertyMediaGroupTranslations,
  ({ one }) => ({
    mediaGroup: one(propertyMediaGroups, {
      fields: [propertyMediaGroupTranslations.propertyMediaGroupId],
      references: [propertyMediaGroups.id],
    }),
  }),
);

export const propertyMediaRelations = relations(propertyMedia, ({ one, many }) => ({
  property: one(properties, {
    fields: [propertyMedia.propertyId],
    references: [properties.id],
  }),
  mediaGroup: one(propertyMediaGroups, {
    fields: [propertyMedia.propertyMediaGroupId],
    references: [propertyMediaGroups.id],
  }),
  translations: many(propertyMediaTranslations),
}));

export const propertyMediaTranslationsRelations = relations(
  propertyMediaTranslations,
  ({ one }) => ({
    media: one(propertyMedia, {
      fields: [propertyMediaTranslations.propertyMediaId],
      references: [propertyMedia.id],
    }),
  }),
);

export const propertyTourNodesRelations = relations(propertyTourNodes, ({ one, many }) => ({
  property: one(properties, {
    fields: [propertyTourNodes.propertyId],
    references: [properties.id],
  }),
  /** El panorama reutilizado, no una copia. */
  media: one(propertyMedia, {
    fields: [propertyTourNodes.propertyMediaId],
    references: [propertyMedia.id],
  }),
  translations: many(propertyTourNodeTranslations),

  /**
   * `property_tour_links` apunta dos veces a esta misma tabla, asi que ambas
   * direcciones necesitan `relationName` para que Drizzle no las confunda.
   */
  outgoingLinks: many(propertyTourLinks, { relationName: 'tourLinkFromNode' }),
  incomingLinks: many(propertyTourLinks, { relationName: 'tourLinkToNode' }),
}));

export const propertyTourNodeTranslationsRelations = relations(
  propertyTourNodeTranslations,
  ({ one }) => ({
    tourNode: one(propertyTourNodes, {
      fields: [propertyTourNodeTranslations.propertyTourNodeId],
      references: [propertyTourNodes.id],
    }),
  }),
);

export const propertyTourLinksRelations = relations(propertyTourLinks, ({ one }) => ({
  fromNode: one(propertyTourNodes, {
    fields: [propertyTourLinks.fromNodeId],
    references: [propertyTourNodes.id],
    relationName: 'tourLinkFromNode',
  }),
  toNode: one(propertyTourNodes, {
    fields: [propertyTourLinks.toNodeId],
    references: [propertyTourNodes.id],
    relationName: 'tourLinkToNode',
  }),
}));

export const mapPointsOfInterestRelations = relations(mapPointsOfInterest, ({ many }) => ({
  translations: many(mapPointOfInterestTranslations),
}));

export const mapPointOfInterestTranslationsRelations = relations(
  mapPointOfInterestTranslations,
  ({ one }) => ({
    pointOfInterest: one(mapPointsOfInterest, {
      fields: [mapPointOfInterestTranslations.pointOfInterestId],
      references: [mapPointsOfInterest.id],
    }),
  }),
);

export const contactsRelations = relations(contacts, ({ one }) => ({
  /** Opcional: las consultas generales no cuelgan de ninguna propiedad. */
  property: one(properties, {
    fields: [contacts.propertyId],
    references: [properties.id],
  }),
}));

export const siteSettingsRelations = relations(siteSettings, ({ many }) => ({
  translations: many(siteSettingTranslations),
}));

export const siteSettingTranslationsRelations = relations(siteSettingTranslations, ({ one }) => ({
  siteSettings: one(siteSettings, {
    fields: [siteSettingTranslations.siteSettingsId],
    references: [siteSettings.id],
  }),
}));

export const propertyReviewsRelations = relations(propertyReviews, ({ one, many }) => ({
  property: one(properties, {
    fields: [propertyReviews.propertyId],
    references: [properties.id],
  }),
  tokens: many(propertyReviewTokens),
}));

export const propertyReviewTokensRelations = relations(propertyReviewTokens, ({ one }) => ({
  review: one(propertyReviews, {
    fields: [propertyReviewTokens.propertyReviewId],
    references: [propertyReviews.id],
  }),
}));

export const publicationRequestsRelations = relations(publicationRequests, ({ one }) => ({
  property: one(properties, {
    fields: [publicationRequests.propertyId],
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

export type PropertyFeatureGroup = typeof propertyFeatureGroups.$inferSelect;
export type NewPropertyFeatureGroup = typeof propertyFeatureGroups.$inferInsert;

export type PropertyFeatureGroupTranslation = typeof propertyFeatureGroupTranslations.$inferSelect;
export type NewPropertyFeatureGroupTranslation =
  typeof propertyFeatureGroupTranslations.$inferInsert;

export type PropertyFeature = typeof propertyFeatures.$inferSelect;
export type NewPropertyFeature = typeof propertyFeatures.$inferInsert;

export type PropertyFeatureTranslation = typeof propertyFeatureTranslations.$inferSelect;
export type NewPropertyFeatureTranslation = typeof propertyFeatureTranslations.$inferInsert;

export type PropertyMediaGroup = typeof propertyMediaGroups.$inferSelect;
export type NewPropertyMediaGroup = typeof propertyMediaGroups.$inferInsert;

export type PropertyMediaGroupTranslation = typeof propertyMediaGroupTranslations.$inferSelect;
export type NewPropertyMediaGroupTranslation = typeof propertyMediaGroupTranslations.$inferInsert;

export type PropertyMedia = typeof propertyMedia.$inferSelect;
export type NewPropertyMedia = typeof propertyMedia.$inferInsert;

export type PropertyMediaTranslation = typeof propertyMediaTranslations.$inferSelect;
export type NewPropertyMediaTranslation = typeof propertyMediaTranslations.$inferInsert;

export type PropertyTourNode = typeof propertyTourNodes.$inferSelect;
export type NewPropertyTourNode = typeof propertyTourNodes.$inferInsert;

export type PropertyTourNodeTranslation = typeof propertyTourNodeTranslations.$inferSelect;
export type NewPropertyTourNodeTranslation = typeof propertyTourNodeTranslations.$inferInsert;

export type PropertyTourLink = typeof propertyTourLinks.$inferSelect;
export type NewPropertyTourLink = typeof propertyTourLinks.$inferInsert;

export type MapPointOfInterest = typeof mapPointsOfInterest.$inferSelect;
export type NewMapPointOfInterest = typeof mapPointsOfInterest.$inferInsert;

export type MapPointOfInterestTranslation = typeof mapPointOfInterestTranslations.$inferSelect;
export type NewMapPointOfInterestTranslation = typeof mapPointOfInterestTranslations.$inferInsert;

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

export type SiteSettings = typeof siteSettings.$inferSelect;
export type NewSiteSettings = typeof siteSettings.$inferInsert;

export type SiteSettingTranslation = typeof siteSettingTranslations.$inferSelect;
export type NewSiteSettingTranslation = typeof siteSettingTranslations.$inferInsert;

export type SiteSocialLink = typeof siteSocialLinks.$inferSelect;
export type NewSiteSocialLink = typeof siteSocialLinks.$inferInsert;

export type SiteLocale = typeof siteLocales.$inferSelect;
export type NewSiteLocale = typeof siteLocales.$inferInsert;

export type PropertyReview = typeof propertyReviews.$inferSelect;
export type NewPropertyReview = typeof propertyReviews.$inferInsert;

export type PropertyReviewToken = typeof propertyReviewTokens.$inferSelect;
export type NewPropertyReviewToken = typeof propertyReviewTokens.$inferInsert;

export type PublicationRequest = typeof publicationRequests.$inferSelect;
export type NewPublicationRequest = typeof publicationRequests.$inferInsert;
