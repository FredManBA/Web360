/**
 * Caracteristicas personalizadas.
 *
 * Regla que la base NO puede garantizar con claves foraneas simples: una
 * caracteristica solo puede pertenecer a un grupo de SU MISMA propiedad. Se
 * valida aqui, reutilizando `validateFeatureGroup` de la Fase 2A.
 *
 * La propiedad viene siempre de la URL: `propertyId` no se acepta en el
 * cuerpo, y una caracteristica nunca cambia de propiedad.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { properties, propertyFeatureTranslations, propertyFeatures } from '../../../db/schema';
import { validateFeatureGroup } from '../../domain/consistency';
import type { Locale } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';
import { loadGroup } from './feature-groups';
import { nextSortOrder, normalizeText } from '../shared';

export interface FeatureTexts {
  labelEs?: string | null;
  valueEs?: string | null;
  labelEn?: string | null;
  valueEn?: string | null;
}

export interface CreateFeatureInput extends FeatureTexts {
  groupId?: number | null;
  sortOrder?: number;
}

export interface UpdateFeatureInput extends FeatureTexts {
  groupId?: number | null;
  sortOrder?: number;
}

export interface FeatureRecord {
  id: number;
  propertyId: number;
  groupId: number | null;
  sortOrder: number;
}

function toRecord(row: typeof propertyFeatures.$inferSelect): FeatureRecord {
  return {
    id: row.id,
    propertyId: row.propertyId,
    groupId: row.propertyFeatureGroupId,
    sortOrder: row.sortOrder,
  };
}

/**
 * Comprueba que el grupo elegido sea de la misma propiedad.
 *
 * `null` significa "sin grupo" y siempre es valido.
 */
async function checkGroupOwnership(
  db: AdminDatabase,
  propertyId: number,
  groupId: number | null,
): Promise<AdminResult<null>> {
  if (groupId === null) return ok(null);

  const found = await loadGroup(db, propertyId, groupId);
  if (!found.ok) return found;

  // Comprobacion de dominio, ademas de la consulta anterior.
  const problems = validateFeatureGroup(
    { propertyId, groupId },
    { propertyId: found.data.propertyId },
  );
  if (problems.length > 0) {
    return fail({
      code: 'feature_group_property_mismatch',
      message: 'El grupo pertenece a otra propiedad.',
      field: 'groupId',
    });
  }

  return ok(null);
}

/** Escribe los textos que vengan, normalizando el vacio a `null`. */
async function writeFeatureTexts(
  db: AdminDatabase,
  featureId: number,
  input: FeatureTexts,
): Promise<void> {
  const byLocale: [Locale, { label?: string | null; value?: string | null }][] = [];

  const es: { label?: string | null; value?: string | null } = {};
  if (input.labelEs !== undefined) es.label = normalizeText(input.labelEs);
  if (input.valueEs !== undefined) es.value = normalizeText(input.valueEs);
  if (Object.keys(es).length > 0) byLocale.push(['es', es]);

  const en: { label?: string | null; value?: string | null } = {};
  if (input.labelEn !== undefined) en.label = normalizeText(input.labelEn);
  if (input.valueEn !== undefined) en.value = normalizeText(input.valueEn);
  if (Object.keys(en).length > 0) byLocale.push(['en', en]);

  for (const [locale, texts] of byLocale) {
    const existing = await db
      .select({ id: propertyFeatureTranslations.id })
      .from(propertyFeatureTranslations)
      .where(
        and(
          eq(propertyFeatureTranslations.propertyFeatureId, featureId),
          eq(propertyFeatureTranslations.locale, locale),
        ),
      )
      .limit(1);

    const row = existing[0];

    if (row === undefined) {
      await db.insert(propertyFeatureTranslations).values({
        propertyFeatureId: featureId,
        locale,
        label: texts.label ?? null,
        value: texts.value ?? null,
      });
    } else {
      await db
        .update(propertyFeatureTranslations)
        .set({ ...texts, updatedAt: new Date() })
        .where(eq(propertyFeatureTranslations.id, row.id));
    }
  }
}

/** Posicion siguiente dentro del grupo, o del conjunto sin grupo. */
async function nextFeatureSortOrder(
  db: AdminDatabase,
  propertyId: number,
  groupId: number | null,
): Promise<number> {
  const scope =
    groupId === null
      ? and(
          eq(propertyFeatures.propertyId, propertyId),
          isNull(propertyFeatures.propertyFeatureGroupId),
        )
      : and(
          eq(propertyFeatures.propertyId, propertyId),
          eq(propertyFeatures.propertyFeatureGroupId, groupId),
        );

  const siblings = await db
    .select({ sortOrder: propertyFeatures.sortOrder })
    .from(propertyFeatures)
    .where(scope);

  return nextSortOrder(siblings.map((row) => row.sortOrder));
}

export async function createFeature(
  db: AdminDatabase,
  propertyId: number,
  input: CreateFeatureInput = {},
): Promise<AdminResult<FeatureRecord>> {
  const owner = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  if (owner.length === 0) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const groupId = input.groupId ?? null;

  const ownership = await checkGroupOwnership(db, propertyId, groupId);
  if (!ownership.ok) return ownership;

  const sortOrder = input.sortOrder ?? (await nextFeatureSortOrder(db, propertyId, groupId));

  const inserted = await db
    .insert(propertyFeatures)
    .values({ propertyId, propertyFeatureGroupId: groupId, sortOrder })
    .returning();

  const feature = inserted[0];
  if (feature === undefined) {
    return fail({ code: 'validation_failed', message: 'No se pudo crear la característica.' });
  }

  await writeFeatureTexts(db, feature.id, input);

  return ok(toRecord(feature));
}

/** La caracteristica debe existir Y ser de esta propiedad. */
async function loadFeature(
  db: AdminDatabase,
  propertyId: number,
  featureId: number,
): Promise<AdminResult<typeof propertyFeatures.$inferSelect>> {
  const rows = await db
    .select()
    .from(propertyFeatures)
    .where(eq(propertyFeatures.id, featureId))
    .limit(1);

  const feature = rows[0];
  if (feature === undefined || feature.propertyId !== propertyId) {
    return fail({
      code: 'feature_not_found',
      message: 'La característica no existe.',
      field: 'featureId',
    });
  }

  return ok(feature);
}

export async function updateFeature(
  db: AdminDatabase,
  propertyId: number,
  featureId: number,
  input: UpdateFeatureInput,
): Promise<AdminResult<FeatureRecord>> {
  const found = await loadFeature(db, propertyId, featureId);
  if (!found.ok) return found;

  const patch: Record<string, unknown> = {};

  if (input.groupId !== undefined) {
    const ownership = await checkGroupOwnership(db, propertyId, input.groupId);
    if (!ownership.ok) return ownership;

    patch.propertyFeatureGroupId = input.groupId;
  }

  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  if (Object.keys(patch).length > 0) {
    await db
      .update(propertyFeatures)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(propertyFeatures.id, featureId));
  }

  await writeFeatureTexts(db, featureId, input);

  const refreshed = await db
    .select()
    .from(propertyFeatures)
    .where(eq(propertyFeatures.id, featureId))
    .limit(1);

  const feature = refreshed[0];
  if (feature === undefined) {
    return fail({ code: 'feature_not_found', message: 'La característica no existe.' });
  }

  return ok(toRecord(feature));
}

/** Borrado fisico; sus traducciones caen por CASCADE. Sin papelera. */
export async function deleteFeature(
  db: AdminDatabase,
  propertyId: number,
  featureId: number,
): Promise<AdminResult<{ id: number }>> {
  const found = await loadFeature(db, propertyId, featureId);
  if (!found.ok) return found;

  await db
    .delete(propertyFeatures)
    .where(and(eq(propertyFeatures.id, featureId), eq(propertyFeatures.propertyId, propertyId)));

  return ok({ id: featureId });
}
