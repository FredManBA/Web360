/**
 * Listado del panel.
 *
 * Con menos de 50 propiedades se devuelve la lista completa: no hay paginacion
 * ni busqueda textual todavia.
 */

import { and, desc, eq, type SQL } from 'drizzle-orm';

import { properties, propertyTranslations } from '../../../db/schema';
import type {
  CommercialStatus,
  Locale,
  PriceMode,
  PublicationStatus,
} from '../../domain/vocabularies';
import type { AdminDatabase } from '../types';

export interface ListPropertiesFilters {
  publicationStatus?: PublicationStatus;
  commercialStatus?: CommercialStatus;
  propertyTypeId?: number;
}

export interface PropertyListItem {
  id: number;
  code: string;
  titleEs: string | null;
  titleEn: string | null;
  propertyTypeId: number | null;
  publicationStatus: PublicationStatus;
  commercialStatus: CommercialStatus;
  isFeatured: boolean;
  priceMode: PriceMode;
  priceAmountMinor: number | null;
  currencyCode: string | null;
  areaSquareMeters: number | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

export async function listProperties(
  db: AdminDatabase,
  filters: ListPropertiesFilters = {},
): Promise<PropertyListItem[]> {
  const conditions: SQL[] = [];

  if (filters.publicationStatus !== undefined) {
    conditions.push(eq(properties.publicationStatus, filters.publicationStatus));
  }
  if (filters.commercialStatus !== undefined) {
    conditions.push(eq(properties.commercialStatus, filters.commercialStatus));
  }
  if (filters.propertyTypeId !== undefined) {
    conditions.push(eq(properties.propertyTypeId, filters.propertyTypeId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: properties.id,
      code: properties.code,
      propertyTypeId: properties.propertyTypeId,
      publicationStatus: properties.publicationStatus,
      commercialStatus: properties.commercialStatus,
      isFeatured: properties.isFeatured,
      priceMode: properties.priceMode,
      priceAmountMinor: properties.priceAmountMinor,
      currencyCode: properties.currencyCode,
      areaSquareMeters: properties.areaSquareMeters,
      createdAt: properties.createdAt,
      updatedAt: properties.updatedAt,
      publishedAt: properties.publishedAt,
    })
    .from(properties)
    .where(where)
    .orderBy(desc(properties.updatedAt), desc(properties.id));

  if (rows.length === 0) return [];

  // Los titulos se traen en una segunda consulta y se cruzan en memoria: con
  // este volumen es mas simple y legible que un doble LEFT JOIN condicional.
  const titles = await db
    .select({
      propertyId: propertyTranslations.propertyId,
      locale: propertyTranslations.locale,
      title: propertyTranslations.title,
    })
    .from(propertyTranslations);

  const byProperty = new Map<number, Partial<Record<Locale, string | null>>>();
  for (const row of titles) {
    const entry = byProperty.get(row.propertyId) ?? {};
    entry[row.locale] = row.title;
    byProperty.set(row.propertyId, entry);
  }

  return rows.map((row) => {
    const names = byProperty.get(row.id) ?? {};
    return {
      ...row,
      titleEs: names.es ?? null,
      titleEn: names.en ?? null,
    };
  });
}
