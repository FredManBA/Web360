/**
 * Grupos multimedia.
 *
 * Misma forma que los grupos de caracteristicas: pertenecen a UNA propiedad,
 * que define siempre la URL, y pueden existir sin nombre mientras la ficha es
 * un borrador.
 *
 * Al borrar el grupo, sus archivos NO desaparecen: el esquema usa
 * `ON DELETE SET NULL`, asi que quedan sin agrupar. Es el mismo criterio que
 * en caracteristicas y hay un test que lo demuestra contra SQLite real.
 */

import { and, eq } from 'drizzle-orm';

import {
  properties,
  propertyMediaGroupTranslations,
  propertyMediaGroups,
} from '../../../db/schema';
import type { Locale } from '../../domain/vocabularies';
import { nextSortOrder, normalizeText } from '../shared';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

export interface MediaGroupNames {
  nameEs?: string | null;
  nameEn?: string | null;
}

export interface CreateMediaGroupInput extends MediaGroupNames {
  sortOrder?: number;
}

export interface UpdateMediaGroupInput extends MediaGroupNames {
  sortOrder?: number;
}

export interface MediaGroupRecord {
  id: number;
  propertyId: number;
  sortOrder: number;
}

const GROUP_COLUMNS = {
  id: propertyMediaGroups.id,
  propertyId: propertyMediaGroups.propertyId,
  sortOrder: propertyMediaGroups.sortOrder,
};

async function propertyExists(db: AdminDatabase, propertyId: number): Promise<boolean> {
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows.length > 0;
}

/** El grupo debe existir Y ser de esta propiedad. */
export async function loadMediaGroup(
  db: AdminDatabase,
  propertyId: number,
  groupId: number,
): Promise<AdminResult<typeof propertyMediaGroups.$inferSelect>> {
  const rows = await db
    .select()
    .from(propertyMediaGroups)
    .where(eq(propertyMediaGroups.id, groupId))
    .limit(1);

  const group = rows[0];
  if (group === undefined) {
    return fail({
      code: 'media_group_not_found',
      message: 'El grupo multimedia no existe.',
      field: 'groupId',
    });
  }

  if (group.propertyId !== propertyId) {
    return fail({
      code: 'media_group_property_mismatch',
      message: 'El grupo multimedia pertenece a otra propiedad.',
      field: 'groupId',
    });
  }

  return ok(group);
}

/** Escribe los nombres que vengan, normalizando el vacio a `null`. */
async function writeGroupNames(
  db: AdminDatabase,
  groupId: number,
  input: MediaGroupNames,
): Promise<void> {
  const byLocale: [Locale, string | null][] = [];
  if (input.nameEs !== undefined) byLocale.push(['es', normalizeText(input.nameEs)]);
  if (input.nameEn !== undefined) byLocale.push(['en', normalizeText(input.nameEn)]);

  for (const [locale, name] of byLocale) {
    const existing = await db
      .select({ id: propertyMediaGroupTranslations.id })
      .from(propertyMediaGroupTranslations)
      .where(
        and(
          eq(propertyMediaGroupTranslations.propertyMediaGroupId, groupId),
          eq(propertyMediaGroupTranslations.locale, locale),
        ),
      )
      .limit(1);

    const row = existing[0];

    if (row === undefined) {
      await db
        .insert(propertyMediaGroupTranslations)
        .values({ propertyMediaGroupId: groupId, locale, name });
    } else {
      // `updatedAt` explicito, igual que en el resto de la capa.
      await db
        .update(propertyMediaGroupTranslations)
        .set({ name, updatedAt: new Date() })
        .where(eq(propertyMediaGroupTranslations.id, row.id));
    }
  }
}

export async function createMediaGroup(
  db: AdminDatabase,
  propertyId: number,
  input: CreateMediaGroupInput = {},
): Promise<AdminResult<MediaGroupRecord>> {
  if (!(await propertyExists(db, propertyId))) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  let sortOrder = input.sortOrder;

  if (sortOrder === undefined) {
    // Al final de los grupos que ya tiene la propiedad.
    const siblings = await db
      .select({ sortOrder: propertyMediaGroups.sortOrder })
      .from(propertyMediaGroups)
      .where(eq(propertyMediaGroups.propertyId, propertyId));

    sortOrder = nextSortOrder(siblings.map((row) => row.sortOrder));
  }

  const inserted = await db
    .insert(propertyMediaGroups)
    .values({ propertyId, sortOrder })
    .returning(GROUP_COLUMNS);

  const group = inserted[0];
  if (group === undefined) {
    return fail({ code: 'validation_failed', message: 'No se pudo crear el grupo multimedia.' });
  }

  await writeGroupNames(db, group.id, input);

  return ok(group);
}

export async function updateMediaGroup(
  db: AdminDatabase,
  propertyId: number,
  groupId: number,
  input: UpdateMediaGroupInput,
): Promise<AdminResult<MediaGroupRecord>> {
  const found = await loadMediaGroup(db, propertyId, groupId);
  if (!found.ok) return found;

  if (input.sortOrder !== undefined) {
    await db
      .update(propertyMediaGroups)
      .set({ sortOrder: input.sortOrder, updatedAt: new Date() })
      .where(eq(propertyMediaGroups.id, groupId));
  }

  await writeGroupNames(db, groupId, input);

  const refreshed = await db
    .select(GROUP_COLUMNS)
    .from(propertyMediaGroups)
    .where(eq(propertyMediaGroups.id, groupId))
    .limit(1);

  const group = refreshed[0];
  if (group === undefined) {
    return fail({ code: 'media_group_not_found', message: 'El grupo multimedia no existe.' });
  }

  return ok(group);
}

/**
 * Borrado fisico del grupo.
 *
 * Sus traducciones caen por CASCADE; sus archivos sobreviven y quedan sin
 * agrupar, porque la clave foranea de `property_media` es `SET NULL`.
 */
export async function deleteMediaGroup(
  db: AdminDatabase,
  propertyId: number,
  groupId: number,
): Promise<AdminResult<{ id: number }>> {
  const found = await loadMediaGroup(db, propertyId, groupId);
  if (!found.ok) return found;

  await db
    .delete(propertyMediaGroups)
    .where(
      and(eq(propertyMediaGroups.id, groupId), eq(propertyMediaGroups.propertyId, propertyId)),
    );

  return ok({ id: groupId });
}
