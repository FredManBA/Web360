/**
 * Carga de una propiedad para editarla en el panel.
 *
 * Trae solo el nucleo: datos base, tipo con sus traducciones y las
 * traducciones ES/EN de la propiedad. Caracteristicas, multimedia, tours,
 * revisiones y contactos llegaran en fases posteriores.
 */

import { eq } from 'drizzle-orm';

import {
  properties,
  propertyTranslations,
  propertyTypeTranslations,
  propertyTypes,
} from '../../../db/schema';
import type { Locale } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

export interface PropertyTypeSummary {
  id: number;
  systemKey: string | null;
  isActive: boolean;
  /** Nombre por idioma; puede faltar alguno. */
  names: Partial<Record<Locale, string>>;
}

export interface PropertyTranslationView {
  locale: Locale;
  slug: string | null;
  title: string | null;
  marketingDescription: string | null;
  technicalDescription: string | null;
}

export interface PropertyForEdit {
  property: typeof properties.$inferSelect;
  propertyType: PropertyTypeSummary | null;
  translations: PropertyTranslationView[];
}

export async function getPropertyForEdit(
  db: AdminDatabase,
  propertyId: number,
): Promise<AdminResult<PropertyForEdit>> {
  const found = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);

  const property = found[0];
  if (property === undefined) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const translations = await db
    .select({
      locale: propertyTranslations.locale,
      slug: propertyTranslations.slug,
      title: propertyTranslations.title,
      marketingDescription: propertyTranslations.marketingDescription,
      technicalDescription: propertyTranslations.technicalDescription,
    })
    .from(propertyTranslations)
    .where(eq(propertyTranslations.propertyId, propertyId));

  let propertyType: PropertyTypeSummary | null = null;

  if (property.propertyTypeId !== null) {
    const typeRows = await db
      .select({
        id: propertyTypes.id,
        systemKey: propertyTypes.systemKey,
        isActive: propertyTypes.isActive,
        locale: propertyTypeTranslations.locale,
        name: propertyTypeTranslations.name,
      })
      .from(propertyTypes)
      .leftJoin(
        propertyTypeTranslations,
        eq(propertyTypeTranslations.propertyTypeId, propertyTypes.id),
      )
      .where(eq(propertyTypes.id, property.propertyTypeId));

    const first = typeRows[0];
    if (first !== undefined) {
      const names: Partial<Record<Locale, string>> = {};
      for (const row of typeRows) {
        if (row.locale !== null && row.name !== null) names[row.locale] = row.name;
      }
      propertyType = {
        id: first.id,
        systemKey: first.systemKey,
        isActive: first.isActive,
        names,
      };
    }
  }

  return ok({ property, propertyType, translations });
}
