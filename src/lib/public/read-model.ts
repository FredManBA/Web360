/**
 * Read model publico.
 *
 * Es la frontera entre lo que la base guarda y lo que el sitio publica. Todo
 * lo que salga de aqui acaba en HTML estatico visible por cualquiera, asi que
 * la regla es la contraria a la del admin: no se copia una columna salvo que
 * haya un motivo para publicarla.
 *
 * Lo que NUNCA sale, aunque este a mano en la misma fila:
 *
 * - `privateLatitude` / `privateLongitude`: la coordenada privada solo se
 *   convierte en publica cuando alguien la escribe a mano en el editor;
 * - estados editoriales (`publicationStatus`, `publishedAt`), fechas internas
 *   y cualquier id de la base;
 * - reviews, tokens y contactos;
 * - claves de objeto de R2: no hay entrega publica todavia, asi que
 *   publicarlas seria filtrar la ruta de un bucket privado sin ganar nada.
 *
 * Se separa a proposito de `admin/`: alli se lee para editar y hace falta
 * todo; aqui se lee para publicar y hace falta lo minimo.
 */

import { asc } from 'drizzle-orm';

import {
  properties,
  propertyFeatureGroupTranslations,
  propertyFeatureGroups,
  propertyFeatureTranslations,
  propertyFeatures,
  propertyMedia,
  propertyMediaGroupTranslations,
  propertyMediaGroups,
  propertyMediaTranslations,
  propertyTourNodes,
  propertyTranslations,
  propertyTypeTranslations,
} from '../../db/schema';
import { formatArea } from '../domain/area';
import { getPublicCoordinates } from '../domain/location';
import { formatMoney } from '../domain/money';
import { isPubliclyVisible } from '../domain/visibility';
import type {
  CommercialStatus,
  Locale,
  LocationPrecision,
  MediaKind,
  PriceMode,
} from '../domain/vocabularies';
import type { AdminDatabase } from '../admin/types';

/* -------------------------------------------------------------------------- */
/* Forma de lo publicado                                                      */
/* -------------------------------------------------------------------------- */

export interface PublicPrice {
  mode: PriceMode;
  /** Solo cuando el modo es `exact` o `negotiable`. */
  amountMinor: number | null;
  currencyCode: string | null;
  /** Ya formateado en el idioma de la ficha. */
  text: string;
}

export interface PublicArea {
  squareMeters: number;
  text: string;
}

export interface PublicLocation {
  province: string | null;
  canton: string | null;
  district: string | null;
  locality: string | null;
  /** Solo la coordenada PUBLICA, y solo si es utilizable. */
  coordinates: { latitude: number; longitude: number } | null;
  precision: LocationPrecision;
}

/**
 * Un archivo publicable.
 *
 * Lo que se publica es la URL ya construida, no el identificador suelto: asi
 * el sitio no tiene que saber como se forma una ruta de media, y la clave del
 * objeto en R2 sigue sin salir de la base.
 *
 * Para YouTube se publica el identificador del video, que es publico por
 * definicion: es el que aparece en cualquier enlace de YouTube.
 */
export interface PublicMediaItem {
  kind: MediaKind;
  /** Ruta servida por el Worker. `null` en los videos de YouTube. */
  url: string | null;
  youtubeVideoId: string | null;

  title: string | null;
  /** Texto alternativo del idioma de la ficha; nunca se inventa. */
  altText: string | null;
  caption: string | null;

  /** Nombre del grupo al que pertenece, si tiene. */
  group: string | null;
  isHero: boolean;
  isCatalogCover: boolean;
}

/** Que hay para ver, y donde pedirlo. */
export interface PublicMediaSummary {
  counts: Record<MediaKind, number>;
  hasTour: boolean;

  /** Imagen de la tarjeta del catalogo. */
  cover: PublicMediaItem | null;
  /** Imagen o video que encabeza la ficha. */
  hero: PublicMediaItem | null;
  /** Todo lo publicable, en el orden en que se edito. */
  items: PublicMediaItem[];
}

export interface PublicFeature {
  label: string;
  value: string | null;
}

export interface PublicFeatureGroup {
  /** `null` cuando el grupo no tiene nombre en este idioma. */
  name: string | null;
  items: PublicFeature[];
}

/** Lo que necesita una tarjeta del catalogo. */
export interface PublicPropertyCard {
  code: string;
  slug: string;
  title: string;
  propertyType: string | null;

  price: PublicPrice;
  area: PublicArea | null;
  location: PublicLocation;

  /**
   * Solo cuando aporta algo: `available` es lo normal y no se anuncia.
   * `sold` solo llega hasta aqui si la propiedad se publica vendida.
   */
  commercialStatus: CommercialStatus | null;
  isFeatured: boolean;

  media: PublicMediaSummary;
  href: string;
}

/** La ficha completa: la tarjeta mas el contenido largo. */
export interface PublicPropertyDetail extends PublicPropertyCard {
  marketingDescription: string | null;
  technicalDescription: string | null;
  features: PublicFeatureGroup[];
}

export interface PublicSnapshot {
  /** Cuando se genero, para poder saber si una build va con datos viejos. */
  generatedAt: string;
  properties: Record<Locale, PublicPropertyDetail[]>;
}

export const EMPTY_SNAPSHOT: PublicSnapshot = {
  generatedAt: '1970-01-01T00:00:00.000Z',
  properties: { es: [], en: [] },
};

/* -------------------------------------------------------------------------- */
/* Rutas                                                                      */
/* -------------------------------------------------------------------------- */

export function catalogueHref(locale: Locale): string {
  return `/${locale}/propiedades`;
}

export function propertyHref(locale: Locale, slug: string): string {
  return `/${locale}/propiedades/${slug}`;
}

/**
 * Ruta publica de un archivo.
 *
 * El identificador que viaja es el de la fila de multimedia: estable, no
 * revela nada del bucket y no obliga al sitio a saber nada de R2. La clave del
 * objeto la resuelve el Worker leyendo la base, nunca llega desde la URL.
 *
 * Los videos de YouTube no pasan por aqui: se enlazan con su identificador.
 */
export function publicMediaUrl(mediaId: number): string {
  return `/media/${mediaId}`;
}

/* -------------------------------------------------------------------------- */
/* Formato                                                                    */
/* -------------------------------------------------------------------------- */

const PRICE_ON_REQUEST: Record<Locale, string> = {
  es: 'Consultar precio',
  en: 'Price on request',
};

const NEGOTIABLE_SUFFIX: Record<Locale, string> = {
  es: 'negociable',
  en: 'negotiable',
};

/**
 * Texto del precio segun su modo.
 *
 * `contact` no lleva importe aunque la fila tenga uno guardado: el modo manda.
 * Nunca se convierte de moneda.
 */
export function formatPrice(
  mode: PriceMode,
  amountMinor: number | null,
  currencyCode: string | null,
  locale: Locale,
): PublicPrice {
  if (mode === 'contact' || amountMinor === null || currencyCode === null) {
    return { mode, amountMinor: null, currencyCode: null, text: PRICE_ON_REQUEST[locale] };
  }

  const amount = formatMoney(amountMinor, currencyCode, locale);
  const text = mode === 'negotiable' ? `${amount} (${NEGOTIABLE_SUFFIX[locale]})` : amount;

  return { mode, amountMinor, currencyCode, text };
}

/** El estado comercial solo se anuncia cuando dice algo que no sea lo normal. */
export function publishedCommercialStatus(status: CommercialStatus): CommercialStatus | null {
  return status === 'available' ? null : status;
}

/* -------------------------------------------------------------------------- */
/* Construccion                                                               */
/* -------------------------------------------------------------------------- */

function emptyCounts(): Record<MediaKind, number> {
  return { image: 0, video: 0, document: 0, panorama: 0 };
}

/**
 * Construye el snapshot publico leyendo la base.
 *
 * Se recorre idioma por idioma: ES y EN son independientes y una propiedad
 * aparece en un idioma SOLO si tiene traduccion utilizable con slug y titulo
 * en ese idioma. No se copia contenido de un idioma a otro ni se inventan
 * slugs.
 */
export async function buildPublicSnapshot(
  db: AdminDatabase,
  now: Date = new Date(),
): Promise<PublicSnapshot> {
  const propertyRows = await db
    .select({
      id: properties.id,
      code: properties.code,
      propertyTypeId: properties.propertyTypeId,
      publicationStatus: properties.publicationStatus,
      commercialStatus: properties.commercialStatus,
      showWhenSold: properties.showWhenSold,
      isFeatured: properties.isFeatured,

      priceMode: properties.priceMode,
      priceAmountMinor: properties.priceAmountMinor,
      currencyCode: properties.currencyCode,

      areaSquareMeters: properties.areaSquareMeters,

      province: properties.province,
      canton: properties.canton,
      district: properties.district,
      locality: properties.locality,

      // Las privadas NI SE SELECCIONAN: no pueden filtrarse por descuido.
      publicLatitude: properties.publicLatitude,
      publicLongitude: properties.publicLongitude,
      locationPrecision: properties.locationPrecision,
    })
    .from(properties)
    .orderBy(asc(properties.id));

  const visible = propertyRows.filter((row) =>
    isPubliclyVisible({
      publicationStatus: row.publicationStatus,
      commercialStatus: row.commercialStatus,
      showWhenSold: row.showWhenSold,
    }),
  );

  if (visible.length === 0) {
    return { generatedAt: now.toISOString(), properties: { es: [], en: [] } };
  }

  const visibleIds = new Set(visible.map((row) => row.id));

  const translations = await db
    .select({
      propertyId: propertyTranslations.propertyId,
      locale: propertyTranslations.locale,
      slug: propertyTranslations.slug,
      title: propertyTranslations.title,
      marketingDescription: propertyTranslations.marketingDescription,
      technicalDescription: propertyTranslations.technicalDescription,
    })
    .from(propertyTranslations);

  const typeNames = await db
    .select({
      propertyTypeId: propertyTypeTranslations.propertyTypeId,
      locale: propertyTypeTranslations.locale,
      name: propertyTypeTranslations.name,
    })
    .from(propertyTypeTranslations);

  const featureGroups = await db
    .select()
    .from(propertyFeatureGroups)
    .orderBy(asc(propertyFeatureGroups.sortOrder), asc(propertyFeatureGroups.id));

  const groupNames = await db
    .select({
      groupId: propertyFeatureGroupTranslations.propertyFeatureGroupId,
      locale: propertyFeatureGroupTranslations.locale,
      name: propertyFeatureGroupTranslations.name,
    })
    .from(propertyFeatureGroupTranslations);

  const features = await db
    .select()
    .from(propertyFeatures)
    .orderBy(asc(propertyFeatures.sortOrder), asc(propertyFeatures.id));

  const featureTexts = await db
    .select({
      featureId: propertyFeatureTranslations.propertyFeatureId,
      locale: propertyFeatureTranslations.locale,
      label: propertyFeatureTranslations.label,
      value: propertyFeatureTranslations.value,
    })
    .from(propertyFeatureTranslations);

  /*
   * `object_key` NO se selecciona en ninguna consulta de este modulo: la
   * resolucion de la clave es cosa del Worker que sirve el archivo, y asi no
   * puede colarse en el snapshot ni por descuido.
   */
  const media = await db
    .select({
      id: propertyMedia.id,
      propertyId: propertyMedia.propertyId,
      groupId: propertyMedia.propertyMediaGroupId,
      mediaKind: propertyMedia.mediaKind,
      sourceProvider: propertyMedia.sourceProvider,
      youtubeVideoId: propertyMedia.youtubeVideoId,
      sortOrder: propertyMedia.sortOrder,
      isHero: propertyMedia.isHero,
      isCatalogCover: propertyMedia.isCatalogCover,
    })
    .from(propertyMedia)
    .orderBy(asc(propertyMedia.sortOrder), asc(propertyMedia.id));

  const mediaTexts = await db
    .select({
      mediaId: propertyMediaTranslations.propertyMediaId,
      locale: propertyMediaTranslations.locale,
      title: propertyMediaTranslations.title,
      altText: propertyMediaTranslations.altText,
      caption: propertyMediaTranslations.caption,
    })
    .from(propertyMediaTranslations);

  const mediaGroups = await db
    .select()
    .from(propertyMediaGroups)
    .orderBy(asc(propertyMediaGroups.sortOrder), asc(propertyMediaGroups.id));

  const mediaGroupNames = await db
    .select({
      groupId: propertyMediaGroupTranslations.propertyMediaGroupId,
      locale: propertyMediaGroupTranslations.locale,
      name: propertyMediaGroupTranslations.name,
    })
    .from(propertyMediaGroupTranslations);

  const tourNodes = await db
    .select({ propertyId: propertyTourNodes.propertyId })
    .from(propertyTourNodes);

  /* -- Indices en memoria -------------------------------------------------- */

  const translationOf = new Map<string, (typeof translations)[number]>();
  for (const row of translations) translationOf.set(`${row.propertyId}:${row.locale}`, row);

  const typeNameOf = new Map<string, string>();
  for (const row of typeNames) typeNameOf.set(`${row.propertyTypeId}:${row.locale}`, row.name);

  const groupNameOf = new Map<string, string | null>();
  for (const row of groupNames) groupNameOf.set(`${row.groupId}:${row.locale}`, row.name);

  const featureTextOf = new Map<string, { label: string | null; value: string | null }>();
  for (const row of featureTexts) {
    featureTextOf.set(`${row.featureId}:${row.locale}`, { label: row.label, value: row.value });
  }

  const mediaCounts = new Map<number, Record<MediaKind, number>>();
  for (const row of media) {
    if (!visibleIds.has(row.propertyId)) continue;

    const counts = mediaCounts.get(row.propertyId) ?? emptyCounts();
    counts[row.mediaKind] += 1;
    mediaCounts.set(row.propertyId, counts);
  }

  const mediaTextOf = new Map<
    string,
    { title: string | null; altText: string | null; caption: string | null }
  >();
  for (const row of mediaTexts) {
    mediaTextOf.set(`${row.mediaId}:${row.locale}`, {
      title: row.title,
      altText: row.altText,
      caption: row.caption,
    });
  }

  const mediaGroupNameOf = new Map<string, string | null>();
  for (const row of mediaGroupNames) {
    mediaGroupNameOf.set(`${row.groupId}:${row.locale}`, row.name);
  }

  /** Orden de los grupos, para presentar la galeria como en el editor. */
  const mediaGroupOrder = new Map<number, number>();
  mediaGroups.forEach((group, index) => mediaGroupOrder.set(group.id, index));

  const withTour = new Set(
    tourNodes.filter((row) => visibleIds.has(row.propertyId)).map((row) => row.propertyId),
  );

  /* -- Montaje por idioma -------------------------------------------------- */

  /**
   * Multimedia publicable de una propiedad en un idioma.
   *
   * Se ordena por grupo y despues por la posicion dentro del grupo, que es
   * como se ve en el editor. Un archivo sin textos en este idioma se publica
   * igualmente: la foto sirve aunque no tenga pie.
   */
  const mediaFor = (propertyId: number, locale: Locale): PublicMediaSummary => {
    const rows = media.filter((row) => row.propertyId === propertyId);

    const items: PublicMediaItem[] = rows
      .slice()
      .sort((a, b) => {
        const groupA =
          a.groupId === null ? Number.MAX_SAFE_INTEGER : (mediaGroupOrder.get(a.groupId) ?? 0);
        const groupB =
          b.groupId === null ? Number.MAX_SAFE_INTEGER : (mediaGroupOrder.get(b.groupId) ?? 0);

        if (groupA !== groupB) return groupA - groupB;
        return a.sortOrder === b.sortOrder ? a.id - b.id : a.sortOrder - b.sortOrder;
      })
      .map((row) => {
        const texts = mediaTextOf.get(`${row.id}:${locale}`);
        const youtube = row.sourceProvider === 'youtube' ? row.youtubeVideoId : null;

        return {
          kind: row.mediaKind,
          // Los de YouTube no se sirven desde R2: se enlazan con su id.
          url: youtube === null ? publicMediaUrl(row.id) : null,
          youtubeVideoId: youtube,

          title: texts?.title?.trim() ?? null,
          altText: texts?.altText?.trim() ?? null,
          caption: texts?.caption?.trim() ?? null,

          group:
            row.groupId === null
              ? null
              : (mediaGroupNameOf.get(`${row.groupId}:${locale}`) ?? null),
          isHero: row.isHero,
          isCatalogCover: row.isCatalogCover,
        };
      });

    return {
      counts: mediaCounts.get(propertyId) ?? emptyCounts(),
      hasTour: withTour.has(propertyId),
      cover: items.find((item) => item.isCatalogCover) ?? null,
      hero: items.find((item) => item.isHero) ?? null,
      items,
    };
  };

  const buildFor = (locale: Locale): PublicPropertyDetail[] => {
    const list: PublicPropertyDetail[] = [];

    for (const row of visible) {
      const translation = translationOf.get(`${row.id}:${locale}`);

      /*
       * Sin slug o sin titulo en ESTE idioma no hay ficha. No se recurre al
       * otro idioma ni se genera un slug: publicar una URL inventada seria
       * peor que no publicar nada.
       */
      const slug = translation?.slug?.trim();
      const title = translation?.title?.trim();
      if (slug === undefined || slug.length === 0) continue;
      if (title === undefined || title.length === 0) continue;

      const groups: PublicFeatureGroup[] = [];

      const inGroup = (groupId: number | null): PublicFeature[] =>
        features
          .filter(
            (feature) =>
              feature.propertyId === row.id && feature.propertyFeatureGroupId === groupId,
          )
          .map((feature) => featureTextOf.get(`${feature.id}:${locale}`))
          .flatMap((texts) => {
            const label = texts?.label?.trim();
            // Sin etiqueta en este idioma, la caracteristica no dice nada.
            if (label === undefined || label.length === 0) return [];

            const value = texts?.value?.trim();
            return [{ label, value: value === undefined || value.length === 0 ? null : value }];
          });

      for (const group of featureGroups) {
        if (group.propertyId !== row.id) continue;

        const items = inGroup(group.id);
        if (items.length === 0) continue;

        groups.push({ name: groupNameOf.get(`${group.id}:${locale}`) ?? null, items });
      }

      const loose = inGroup(null);
      if (loose.length > 0) groups.push({ name: null, items: loose });

      const area =
        row.areaSquareMeters === null
          ? null
          : {
              squareMeters: row.areaSquareMeters,
              text: formatArea(row.areaSquareMeters, { locale }).text,
            };

      list.push({
        code: row.code,
        slug,
        title,
        propertyType:
          row.propertyTypeId === null
            ? null
            : (typeNameOf.get(`${row.propertyTypeId}:${locale}`) ?? null),

        price: formatPrice(row.priceMode, row.priceAmountMinor, row.currencyCode, locale),
        area,

        location: {
          province: row.province,
          canton: row.canton,
          district: row.district,
          locality: row.locality,
          coordinates: getPublicCoordinates(row),
          precision: row.locationPrecision,
        },

        commercialStatus: publishedCommercialStatus(row.commercialStatus),
        isFeatured: row.isFeatured,

        media: mediaFor(row.id, locale),

        href: propertyHref(locale, slug),

        marketingDescription: translation?.marketingDescription?.trim() ?? null,
        technicalDescription: translation?.technicalDescription?.trim() ?? null,
        features: groups,
      });
    }

    return list;
  };

  return {
    generatedAt: now.toISOString(),
    properties: { es: buildFor('es'), en: buildFor('en') },
  };
}

/* -------------------------------------------------------------------------- */
/* Consultas sobre el snapshot                                                */
/* -------------------------------------------------------------------------- */

export function catalogueOf(snapshot: PublicSnapshot, locale: Locale): PublicPropertyCard[] {
  return snapshot.properties[locale];
}

export function findBySlug(
  snapshot: PublicSnapshot,
  locale: Locale,
  slug: string,
): PublicPropertyDetail | null {
  return snapshot.properties[locale].find((property) => property.slug === slug) ?? null;
}

/** Comprobacion usada en un test: nada de lo publicado deberia traer esto. */
export const FORBIDDEN_PUBLIC_KEYS = [
  'privateLatitude',
  'privateLongitude',
  'publicationStatus',
  'publishedAt',
  'objectKey',
  'youtubeVideoId',
  'reviewToken',
  'tokenHash',
  'id',
  'propertyId',
  'createdAt',
  'updatedAt',
] as const;
