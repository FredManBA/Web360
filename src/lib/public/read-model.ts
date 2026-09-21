/** Public projection over the four product tables. Never exposes R2 keys or contact records. */
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { properties, media, siteSettings } from '../../db/schema';
import { formatArea } from '../domain/area';
import { formatMoney } from '../domain/money';
import {
  TYPE_LABELS,
  type CommercialStatus,
  type Locale,
  type LocationPrecision,
  type PriceMode,
} from '../domain/vocabularies';
import type { AdminDatabase } from '../admin/types';
import type { Tour } from '../domain/content';
// Compatibility at the view boundary keeps the public components unchanged.
type PublicMediaKind = 'image' | 'panorama' | 'video' | 'document';
export interface PublicPrice {
  mode: PriceMode;

  amountMinor: number | null;
  currencyCode: string | null;

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

  coordinates: { latitude: number; longitude: number } | null;
  precision: LocationPrecision;
}

export interface PublicMediaItem {
  kind: PublicMediaKind;

  url: string | null;
  youtubeVideoId: string | null;

  title: string | null;

  altText: string | null;
  caption: string | null;

  group: string | null;
  isHero: boolean;
  isCatalogCover: boolean;
}

export interface PublicMediaSummary {
  counts: Record<PublicMediaKind, number>;
  hasTour: boolean;

  cover: PublicMediaItem | null;

  hero: PublicMediaItem | null;

  items: PublicMediaItem[];
}

export interface PublicFeature {
  label: string;
  value: string | null;
}

export interface PublicFeatureGroup {
  name: string | null;
  items: PublicFeature[];
}

export interface PublicTourLink {
  to: string;

  yaw: number;
  pitch: number;
}

export interface PublicTourNode {
  key: string;

  name: string | null;

  url: string;

  initialView: { yaw: number; pitch: number; fov: number | null } | null;

  links: PublicTourLink[];
}

export interface PublicTour {
  start: string;
  nodes: PublicTourNode[];
}

export interface PublicPropertyCard {
  code: string;
  slug: string;
  title: string;
  propertyType: string | null;

  price: PublicPrice;
  area: PublicArea | null;
  location: PublicLocation;

  commercialStatus: CommercialStatus | null;
  isFeatured: boolean;

  media: PublicMediaSummary;
  href: string;
}

export interface PublicPropertyDetail extends PublicPropertyCard {
  marketingDescription: string | null;
  technicalDescription: string | null;
  features: PublicFeatureGroup[];

  tour: PublicTour | null;
}

export interface PublicSocialLink {
  platform: string;
  url: string;
}

export interface PublicContactChannels {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  social: PublicSocialLink[];
}

export const EMPTY_CONTACT: PublicContactChannels = {
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  social: [],
};

export interface PublicSiteTexts {
  tagline: string | null;
  heroTitle: string | null;
  heroSubtitle: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface PublicSiteMedia {
  logo: string | null;
  favicon: string | null;
  social: string | null;
  hero: string | null;
  /** Panoramas 360 de "Explora Costa Rica", ya ordenados y sin huecos vacios. */
  explore360: string[];
}

export interface PublicSite {
  businessName: string | null;
  texts: Record<Locale, PublicSiteTexts>;
  media: PublicSiteMedia;
}

const EMPTY_TEXTS: PublicSiteTexts = {
  tagline: null,
  heroTitle: null,
  heroSubtitle: null,
  seoTitle: null,
  seoDescription: null,
};

export const EMPTY_SITE_MEDIA: PublicSiteMedia = {
  logo: null,
  favicon: null,
  social: null,
  hero: null,
  explore360: [],
};

export const EMPTY_SITE: PublicSite = {
  businessName: null,
  texts: { es: EMPTY_TEXTS, en: EMPTY_TEXTS },
  media: EMPTY_SITE_MEDIA,
};

export interface PublicSnapshot {
  generatedAt: string;
  properties: Record<Locale, PublicPropertyDetail[]>;
  contact: PublicContactChannels;
  site: PublicSite;
}

export const EMPTY_SNAPSHOT: PublicSnapshot = {
  generatedAt: '1970-01-01T00:00:00.000Z',
  properties: { es: [], en: [] },
  contact: EMPTY_CONTACT,
  site: EMPTY_SITE,
};

export function catalogueHref(locale: Locale): string {
  return `/${locale}/propiedades`;
}

export function propertyHref(locale: Locale, slug: string): string {
  return `/${locale}/propiedades/${slug}`;
}

export function publicMediaUrl(mediaId: number): string {
  return `/media/${mediaId}`;
}

const PRICE_ON_REQUEST: Record<Locale, string> = {
  es: 'Consultar precio',
  en: 'Price on request',
};

const NEGOTIABLE_SUFFIX: Record<Locale, string> = {
  es: 'negociable',
  en: 'negotiable',
};

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

export function publishedCommercialStatus(status: CommercialStatus): CommercialStatus | null {
  return status === 'available' ? null : status;
}

function projectTour(
  tour: Tour | null,
  rows: (typeof media.$inferSelect)[],
  locale: Locale,
): PublicTour | null {
  if (!tour || tour.nodes.length === 0) return null;
  const panoramas = new Set(rows.filter((m) => m.kind === 'panorama').map((m) => m.id));
  const nodes = tour.nodes
    .filter((n) => panoramas.has(n.mediaId))
    .map((n) => ({
      key: String(n.mediaId),
      name: locale === 'es' ? n.name_es : n.name_en,
      url: publicMediaUrl(n.mediaId),
      initialView:
        n.initialView?.yaw != null && n.initialView.pitch != null
          ? { yaw: n.initialView.yaw, pitch: n.initialView.pitch, fov: n.initialView.fov }
          : null,
      links: n.links
        .filter(
          (l) =>
            panoramas.has(l.toMediaId) &&
            tour.nodes.some((target) => target.mediaId === l.toMediaId),
        )
        .map((l) => ({ to: String(l.toMediaId), yaw: l.yaw, pitch: l.pitch })),
    }));
  if (!nodes.length) return null;
  return {
    start: nodes.some((n) => n.key === String(tour.startMediaId))
      ? String(tour.startMediaId)
      : nodes[0]!.key,
    nodes,
  };
}

export async function buildPublicSnapshot(
  db: AdminDatabase,
  now = new Date(),
): Promise<PublicSnapshot> {
  const [settings] = await db
    .select({
      businessName: siteSettings.businessName,
      phone: siteSettings.phone,
      whatsapp: siteSettings.whatsapp,
      email: siteSettings.email,
      address: siteSettings.address,
      brandTaglineEs: siteSettings.brandTaglineEs,
      brandTaglineEn: siteSettings.brandTaglineEn,
      heroTitleEs: siteSettings.heroTitleEs,
      heroTitleEn: siteSettings.heroTitleEn,
      heroSubtitleEs: siteSettings.heroSubtitleEs,
      heroSubtitleEn: siteSettings.heroSubtitleEn,
      seoTitleEs: siteSettings.seoTitleEs,
      seoTitleEn: siteSettings.seoTitleEn,
      seoDescriptionEs: siteSettings.seoDescriptionEs,
      seoDescriptionEn: siteSettings.seoDescriptionEn,
      socialLinksJson: siteSettings.socialLinksJson,
      logoObjectKey: siteSettings.logoObjectKey,
      faviconObjectKey: siteSettings.faviconObjectKey,
      socialImageObjectKey: siteSettings.socialImageObjectKey,
      heroObjectKey: siteSettings.heroObjectKey,
      explore360_1ObjectKey: siteSettings.explore360_1ObjectKey,
      explore360_2ObjectKey: siteSettings.explore360_2ObjectKey,
      explore360_3ObjectKey: siteSettings.explore360_3ObjectKey,
      updatedAt: siteSettings.updatedAt,
    })
    .from(siteSettings)
    .where(eq(siteSettings.id, 1))
    .limit(1);
  const rows = await db
    .select()
    .from(properties)
    .where(eq(properties.status, 'published'))
    .orderBy(desc(properties.featured), desc(properties.publishedAt), asc(properties.id));
  const files =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(media)
          .where(
            inArray(
              media.propertyId,
              rows.map((p) => p.id),
            ),
          )
          .orderBy(asc(media.sortOrder), asc(media.id));
  const texts = (locale: Locale): PublicSiteTexts => ({
    tagline: (locale === 'es' ? settings?.brandTaglineEs : settings?.brandTaglineEn) ?? null,
    heroTitle: (locale === 'es' ? settings?.heroTitleEs : settings?.heroTitleEn) ?? null,
    heroSubtitle: (locale === 'es' ? settings?.heroSubtitleEs : settings?.heroSubtitleEn) ?? null,
    seoTitle: (locale === 'es' ? settings?.seoTitleEs : settings?.seoTitleEn) ?? null,
    seoDescription:
      (locale === 'es' ? settings?.seoDescriptionEs : settings?.seoDescriptionEn) ?? null,
  });
  const siteImage = (slot: string, key: string | null | undefined) =>
    key ? `/site-media/${slot}?v=${settings?.updatedAt.getTime()}` : null;
  const project = (locale: Locale): PublicPropertyDetail[] =>
    rows.flatMap((row) => {
      const slug = (locale === 'es' ? row.slugEs : row.slugEn)?.trim();
      const title = (locale === 'es' ? row.titleEs : row.titleEn)?.trim();
      if (!slug || !title) return [];
      const own = files.filter((m) => m.propertyId === row.id);
      const tour = projectTour(row.tourJson, own, locale);
      const items: PublicMediaItem[] = own.map((m) => ({
        kind: m.kind === 'youtube' ? 'video' : m.kind,
        url: m.objectKey ? publicMediaUrl(m.id) : null,
        youtubeVideoId: m.youtubeVideoId,
        title: null,
        caption: null,
        group: null,
        altText: locale === 'es' ? m.altEs : m.altEn,
        isHero: m.isCover,
        isCatalogCover: m.isCover,
      }));
      const cover = items.find((m) => m.isCatalogCover) ?? null;
      const featureItems = row.featuresJson.flatMap((f) => {
        const label = (locale === 'es' ? f.label_es : f.label_en)?.trim();
        return label ? [{ label, value: locale === 'es' ? f.value_es : f.value_en }] : [];
      });
      return [
        {
          code: row.code,
          slug,
          title,
          propertyType: TYPE_LABELS[locale][row.type],
          price: formatPrice(row.priceMode, row.priceAmountMinor, row.currencyCode, locale),
          area:
            row.areaSquareMeters === null
              ? null
              : {
                  squareMeters: row.areaSquareMeters,
                  text: formatArea(row.areaSquareMeters, { locale }).text,
                },
          location: {
            province: row.province,
            canton: row.canton,
            district: row.district,
            locality: row.locality,
            coordinates:
              row.mapLatitude === null || row.mapLongitude === null
                ? null
                : { latitude: row.mapLatitude, longitude: row.mapLongitude },
            precision: row.locationPrecision,
          },
          commercialStatus: publishedCommercialStatus(row.commercialStatus),
          isFeatured: row.featured,
          media: {
            items,
            cover,
            hero: cover,
            hasTour: tour !== null,
            counts: {
              image: own.filter((m) => m.kind === 'image').length,
              panorama: own.filter((m) => m.kind === 'panorama').length,
              video: own.filter((m) => m.kind === 'youtube').length,
              document: 0,
            },
          },
          href: propertyHref(locale, slug),
          marketingDescription: locale === 'es' ? row.descriptionEs : row.descriptionEn,
          technicalDescription: locale === 'es' ? row.detailsEs : row.detailsEn,
          features: featureItems.length ? [{ name: null, items: featureItems }] : [],
          tour,
        },
      ];
    });
  return {
    generatedAt: now.toISOString(),
    properties: { es: project('es'), en: project('en') },
    contact: {
      phone: settings?.phone ?? null,
      whatsapp: settings?.whatsapp ?? null,
      email: settings?.email ?? null,
      address: settings?.address ?? null,
      social: settings?.socialLinksJson ?? [],
    },
    site: {
      businessName: settings?.businessName ?? null,
      texts: { es: texts('es'), en: texts('en') },
      media: {
        logo: siteImage('logo', settings?.logoObjectKey),
        favicon: siteImage('favicon', settings?.faviconObjectKey),
        social: siteImage('social', settings?.socialImageObjectKey),
        hero: siteImage('hero', settings?.heroObjectKey),
        // Los panoramas de la portada, en orden 1, 2, 3 y sin huecos.
        explore360: [
          siteImage('explore360_1', settings?.explore360_1ObjectKey),
          siteImage('explore360_2', settings?.explore360_2ObjectKey),
          siteImage('explore360_3', settings?.explore360_3ObjectKey),
        ].filter((url): url is string => url !== null),
      },
    },
  };
}
export function catalogueOf(snapshot: PublicSnapshot, locale: Locale): PublicPropertyCard[] {
  return snapshot.properties[locale];
}

export function alternateHref(
  snapshot: PublicSnapshot,
  locale: Locale,
  slug: string,
): string | null {
  const current = snapshot.properties[locale].find((property) => property.slug === slug);
  if (current === undefined) return null;

  const other: Locale = locale === 'es' ? 'en' : 'es';
  const twin = snapshot.properties[other].find((property) => property.code === current.code);

  return twin === undefined ? null : twin.href;
}

export function findBySlug(
  snapshot: PublicSnapshot,
  locale: Locale,
  slug: string,
): PublicPropertyDetail | null {
  return snapshot.properties[locale].find((property) => property.slug === slug) ?? null;
}
