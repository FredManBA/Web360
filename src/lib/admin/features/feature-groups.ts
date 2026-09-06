/**
 * Grupos de caracteristicas.
 *
 * Los grupos pertenecen a UNA propiedad y no pueden moverse a otra: la
 * propiedad la define siempre la URL, nunca el cuerpo de la peticion.
 */

import { and, eq } from 'drizzle-orm';

import {
  properties,
  propertyFeatureGroupTranslations,
  propertyFeatureGroups,
} from '../../../db/schema';
import type { Locale } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';
import { nextSortOrder, normalizeText } from './shared';

export interface FeatureGroupNames {
  nameEs?: string | null;
  nameEn?: string | null;
}

export interface CreateFeatureGroupInput extends FeatureGroupNames {
  sortOrder?: number;
}

export interface UpdateFeatureGroupInput extends FeatureGroupNames {
  sortOrder?: number;
}

export interface FeatureGroupRecord {
  id: number;
  propertyId: number;
  sortOrder: number;
}

async function propertyExists(db: AdminDatabase, propertyId: number): Promise<boolean> {
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows.length > 0;
}

/** El grupo debe existir Y ser de esta propiedad. */
export async function loadGroup(
  db: AdminDatabase,
  propertyId: number,
  groupId: number,
): Promise<AdminResult<typeof propertyFeatureGroups.$inferSelect>> {
  const rows = await db
    .select()
    .from(propertyFeatureGroups)
    .where(eq(propertyFeatureGroups.id, groupId))
    .limit(1);

  const group = rows[0];
  if (group === undefined) {
    return fail({
      code: 'feature_group_not_found',
      message: 'El grupo no existe.',
      field: 'groupId',
    });
  }

  if (group.propertyId !== propertyId) {
    return fail({
      code: 'feature_group_property_mismatch',
      message: 'El grupo pertenece a otra propiedad.',
      field: 'groupId',
    });
  }

  return ok(group);
}

/** Escribe los nombres que vengan, normalizando el vacio a `null`. */
async function writeGroupNames(
  db: AdminDatabase,
  groupId: number,
  input: FeatureGroupNames,
): Promise<void> {
  const byLocale: [Locale, string | null][] = [];
  if (input.nameEs !== undefined) byLocale.push(['es', normalizeText(input.nameEs)]);
  if (input.nameEn !== undefined) byLocale.push(['en', normalizeText(input.nameEn)]);

  for (const [locale, name] of byLocale) {
    const existing = await db
      .select({ id: propertyFeatureGroupTranslations.id })
      .from(propertyFeatureGroupTranslations)
      .where(
        and(
          eq(propertyFeatureGroupTranslations.propertyFeatureGroupId, groupId),
          eq(propertyFeatureGroupTranslations.locale, locale),
        ),
      )
      .limit(1);

    const row = existing[0];

    if (row === undefined) {
      await db
        .insert(propertyFeatureGroupTranslations)
        .values({ propertyFeatureGroupId: groupId, locale, name });
    } else {
      await db
        .update(propertyFeatureGroupTranslations)
        .set({ name, updatedAt: new Date() })
        .where(eq(propertyFeatureGroupTranslations.id, row.id));
    }
  }
}

export async function createFeatureGroup(
  db: AdminDatabase,
  propertyId: number,
  input: CreateFeatureGroupInput = {},
): Promise<AdminResult<FeatureGroupRecord>> {
  if (!(await propertyExists(db, propertyId))) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  let sortOrder = input.sortOrder;

  if (sortOrder === undefined) {
    // Al final de los grupos que ya tiene la propiedad.
    const siblings = await db
      .select({ sortOrder: propertyFeatureGroups.sortOrder })
      .from(propertyFeatureGroups)
      .where(eq(propertyFeatureGroups.propertyId, propertyId));

    sortOrder = nextSortOrder(siblings.map((row) => row.sortOrder));
  }

  const inserted = await db
    .insert(propertyFeatureGroups)
    .values({ propertyId, sortOrder })
    .returning({
      id: propertyFeatureGroups.id,
      propertyId: propertyFeatureGroups.propertyId,
      sortOrder: propertyFeatureGroups.sortOrder,
    });

  const group = inserted[0];
  if (group === undefined) {
    return fail({ code: 'validation_failed', message: 'No se pudo crear el grupo.' });
  }

  // El grupo puede nacer sin nombre: el esquema lo permite en borrador.
  await writeGroupNames(db, group.id, input);

  return ok(group);
}

export async function updateFeatureGroup(
  db: AdminDatabase,
  propertyId: number,
  groupId: number,
  input: UpdateFeatureGroupInput,
): Promise<AdminResult<FeatureGroupRecord>> {
  const found = await loadGroup(db, propertyId, groupId);
  if (!found.ok) return found;

  if (input.sortOrder !== undefined) {
    // `updatedAt` se fija explicitamente, igual que en properties.
    await db
      .update(propertyFeatureGroups)
      .set({ sortOrder: input.sortOrder, updatedAt: new Date() })
      .where(eq(propertyFeatureGroups.id, groupId));
  }

  await writeGroupNames(db, groupId, input);

  const refreshed = await db
    .select({
      id: propertyFeatureGroups.id,
      propertyId: propertyFeatureGroups.propertyId,
      sortOrder: propertyFeatureGroups.sortOrder,
    })
    .from(propertyFeatureGroups)
    .where(eq(propertyFeatureGroups.id, groupId))
    .limit(1);

  const group = refreshed[0];
  if (group === undefined) {
    return fail({ code: 'feature_group_not_found', message: 'El grupo no existe.' });
  }

  return ok(group);
}

/**
 * Borrado fisico del grupo.
 *
 * Sus traducciones caen por CASCADE, pero las caracteristicas SOBREVIVEN: el
 * esquema usa `ON DELETE SET NULL`, asi que quedan sin grupo en lugar de
 * desaparecer con el.
 */
export async function deleteFeatureGroup(
  db: AdminDatabase,
  propertyId: number,
  groupId: number,
): Promise<AdminResult<{ id: number }>> {
  const found = await loadGroup(db, propertyId, groupId);
  if (!found.ok) return found;

  await db
    .delete(propertyFeatureGroups)
    .where(
      and(eq(propertyFeatureGroups.id, groupId), eq(propertyFeatureGroups.propertyId, propertyId)),
    );

  return ok({ id: groupId });
}
