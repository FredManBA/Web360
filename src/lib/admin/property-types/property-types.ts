/**
 * Tipos de propiedad.
 *
 * Los tipos del sistema (`system_key` no nulo) los instala el seed y todavia
 * no se pueden modificar ni borrar desde el panel. El admin si puede crear
 * tipos personalizados, que llevan `system_key = NULL`.
 */

import { eq } from 'drizzle-orm';

import { propertyTypeTranslations, propertyTypes } from '../../../db/schema';
import type { Locale } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

export interface PropertyTypeView {
  id: number;
  systemKey: string | null;
  isActive: boolean;
  names: Partial<Record<Locale, string>>;
}

/** Tipos activos con sus traducciones ES/EN. */
export async function listActivePropertyTypes(db: AdminDatabase): Promise<PropertyTypeView[]> {
  const rows = await db
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
    .where(eq(propertyTypes.isActive, true));

  const byId = new Map<number, PropertyTypeView>();

  for (const row of rows) {
    const current = byId.get(row.id) ?? {
      id: row.id,
      systemKey: row.systemKey,
      isActive: row.isActive,
      names: {},
    };

    if (row.locale !== null && row.name !== null) current.names[row.locale] = row.name;
    byId.set(row.id, current);
  }

  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export interface CreateCustomPropertyTypeInput {
  /** Obligatorio: un tipo sin nombre en espanol no es utilizable. */
  nameEs: string;
  /** Opcional, igual que el resto del contenido en ingles. */
  nameEn?: string | null;
}

export async function createCustomPropertyType(
  db: AdminDatabase,
  input: CreateCustomPropertyTypeInput,
): Promise<AdminResult<PropertyTypeView>> {
  const nameEs = input.nameEs.trim();

  if (nameEs.length === 0) {
    return fail({
      code: 'validation_failed',
      message: 'El nombre en espanol es obligatorio.',
      field: 'nameEs',
    });
  }

  const nameEn = input.nameEn?.trim();

  // `system_key = NULL` marca el tipo como personalizado. SQLite admite
  // multiples NULL en el indice unico, asi que no colisionan entre si.
  const inserted = await db.insert(propertyTypes).values({ systemKey: null }).returning({
    id: propertyTypes.id,
    systemKey: propertyTypes.systemKey,
    isActive: propertyTypes.isActive,
  });

  const created = inserted[0];
  if (created === undefined) {
    return fail({ code: 'validation_failed', message: 'No se pudo crear el tipo.' });
  }

  const names: Partial<Record<Locale, string>> = { es: nameEs };
  await db
    .insert(propertyTypeTranslations)
    .values({ propertyTypeId: created.id, locale: 'es', name: nameEs });

  if (nameEn !== undefined && nameEn.length > 0) {
    await db
      .insert(propertyTypeTranslations)
      .values({ propertyTypeId: created.id, locale: 'en', name: nameEn });
    names.en = nameEn;
  }

  return ok({
    id: created.id,
    systemKey: created.systemKey,
    isActive: created.isActive,
    names,
  });
}
