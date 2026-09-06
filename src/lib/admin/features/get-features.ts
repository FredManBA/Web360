/**
 * Lectura de las caracteristicas de una propiedad.
 *
 * Devuelve una estructura ya lista para pintar: grupos con sus traducciones y
 * sus caracteristicas dentro, mas las caracteristicas sin grupo aparte.
 *
 * El orden se fija SIEMPRE de forma explicita (`sort_order ASC, id ASC`); no
 * se confia en el orden natural de SQLite.
 */

import { asc, eq } from 'drizzle-orm';

import {
  properties,
  propertyFeatureGroupTranslations,
  propertyFeatureGroups,
  propertyFeatureTranslations,
  propertyFeatures,
} from '../../../db/schema';
import type { Locale } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

export interface FeatureTranslationView {
  label: string | null;
  value: string | null;
}

export interface FeatureView {
  id: number;
  groupId: number | null;
  sortOrder: number;
  translations: Partial<Record<Locale, FeatureTranslationView>>;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureGroupView {
  id: number;
  sortOrder: number;
  names: Partial<Record<Locale, string | null>>;
  features: FeatureView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PropertyFeaturesView {
  propertyId: number;
  groups: FeatureGroupView[];
  /** Caracteristicas de la propiedad que no pertenecen a ningun grupo. */
  ungrouped: FeatureView[];
}

/** Orden estable: primero `sortOrder`, y el id desempata. */
function byOrder<T extends { sortOrder: number; id: number }>(a: T, b: T): number {
  return a.sortOrder === b.sortOrder ? a.id - b.id : a.sortOrder - b.sortOrder;
}

export async function getPropertyFeatures(
  db: AdminDatabase,
  propertyId: number,
): Promise<AdminResult<PropertyFeaturesView>> {
  const owner = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  if (owner.length === 0) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const groupRows = await db
    .select()
    .from(propertyFeatureGroups)
    .where(eq(propertyFeatureGroups.propertyId, propertyId))
    .orderBy(asc(propertyFeatureGroups.sortOrder), asc(propertyFeatureGroups.id));

  const featureRows = await db
    .select()
    .from(propertyFeatures)
    .where(eq(propertyFeatures.propertyId, propertyId))
    .orderBy(asc(propertyFeatures.sortOrder), asc(propertyFeatures.id));

  /*
   * Las traducciones se traen enteras y se cruzan en memoria. Con el volumen
   * previsto es mas simple y legible que varios joins condicionales.
   */
  const groupNames = await db
    .select({
      groupId: propertyFeatureGroupTranslations.propertyFeatureGroupId,
      locale: propertyFeatureGroupTranslations.locale,
      name: propertyFeatureGroupTranslations.name,
    })
    .from(propertyFeatureGroupTranslations);

  const featureTexts = await db
    .select({
      featureId: propertyFeatureTranslations.propertyFeatureId,
      locale: propertyFeatureTranslations.locale,
      label: propertyFeatureTranslations.label,
      value: propertyFeatureTranslations.value,
    })
    .from(propertyFeatureTranslations);

  const namesByGroup = new Map<number, Partial<Record<Locale, string | null>>>();
  for (const row of groupNames) {
    const entry = namesByGroup.get(row.groupId) ?? {};
    entry[row.locale] = row.name;
    namesByGroup.set(row.groupId, entry);
  }

  const textsByFeature = new Map<number, Partial<Record<Locale, FeatureTranslationView>>>();
  for (const row of featureTexts) {
    const entry = textsByFeature.get(row.featureId) ?? {};
    entry[row.locale] = { label: row.label, value: row.value };
    textsByFeature.set(row.featureId, entry);
  }

  const toFeatureView = (row: typeof propertyFeatures.$inferSelect): FeatureView => ({
    id: row.id,
    groupId: row.propertyFeatureGroupId,
    sortOrder: row.sortOrder,
    translations: textsByFeature.get(row.id) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const features = featureRows.map(toFeatureView).sort(byOrder);

  const groups: FeatureGroupView[] = groupRows
    .map((row) => ({
      id: row.id,
      sortOrder: row.sortOrder,
      names: namesByGroup.get(row.id) ?? {},
      features: features.filter((feature) => feature.groupId === row.id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
    .sort(byOrder);

  return ok({
    propertyId,
    groups,
    ungrouped: features.filter((feature) => feature.groupId === null),
  });
}
