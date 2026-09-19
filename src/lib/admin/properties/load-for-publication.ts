import { eq } from 'drizzle-orm';
import {
  properties,
  propertyMedia,
  propertyTourNodes,
  propertyTranslations,
} from '../../../db/schema';
import type { PropertyForPublication } from '../../domain/publication';
import type { AdminDatabase } from '../types';

/**
 * Carga la ficha con lo que necesita el validador de publicacion.
 *
 * Se lee lo justo: la regla de "esta lista para publicarse" ya existe en
 * `src/lib/domain/publication.ts` y no se reescribe aqui.
 */
export async function loadForPublication(
  db: AdminDatabase,
  propertyId: number,
): Promise<PropertyForPublication | null> {
  const found = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);

  const property = found[0];
  if (property === undefined) return null;

  const translations = await db
    .select({
      locale: propertyTranslations.locale,
      slug: propertyTranslations.slug,
      title: propertyTranslations.title,
    })
    .from(propertyTranslations)
    .where(eq(propertyTranslations.propertyId, propertyId));

  const media = await db
    .select({
      id: propertyMedia.id,
      propertyId: propertyMedia.propertyId,
      mediaKind: propertyMedia.mediaKind,
      isHero: propertyMedia.isHero,
      isCatalogCover: propertyMedia.isCatalogCover,
    })
    .from(propertyMedia)
    .where(eq(propertyMedia.propertyId, propertyId));

  const tourNodes = await db
    .select({
      id: propertyTourNodes.id,
      propertyId: propertyTourNodes.propertyId,
      propertyMediaId: propertyTourNodes.propertyMediaId,
      isStart: propertyTourNodes.isStart,
    })
    .from(propertyTourNodes)
    .where(eq(propertyTourNodes.propertyId, propertyId));

  return {
    id: property.id,
    code: property.code,
    propertyTypeId: property.propertyTypeId,
    publicationStatus: property.publicationStatus,
    priceMode: property.priceMode,
    priceAmountMinor: property.priceAmountMinor,
    currencyCode: property.currencyCode,
    areaSquareMeters: property.areaSquareMeters,
    publicLatitude: property.publicLatitude,
    publicLongitude: property.publicLongitude,
    locationPrecision: property.locationPrecision,
    translations,
    media,
    tourNodes,
  };
}
