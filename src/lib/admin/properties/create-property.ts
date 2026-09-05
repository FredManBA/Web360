/**
 * Creacion de borradores.
 *
 * El codigo se genera solo. Como D1 no ofrece transacciones interactivas ni
 * secuencias, la carrera entre "leer el maximo" e "insertar" se resuelve
 * dejando que el UNIQUE de la base decida y reintentando: la base es la
 * garantia final, no el SELECT previo.
 *
 * Con un solo admin y menos de 50 propiedades, la colision es practicamente
 * imposible; el reintento existe para que, si ocurre, no se pierda el trabajo.
 */

import { eq, like } from 'drizzle-orm';

import { properties, propertyTranslations, propertyTypes } from '../../../db/schema';
import type { Locale } from '../../domain/vocabularies';
import { toSlug } from '../../domain/slug';
import { fail, isUniqueViolation, ok, type AdminDatabase, type AdminResult } from '../types';
import { nextPropertyCode, PROPERTY_CODE_PREFIX } from './codes';

/** Intentos ante colision de codigo antes de rendirse. */
const MAX_CODE_ATTEMPTS = 5;

export interface CreatePropertyDraftInput {
  propertyTypeId?: number | null;
  /** Idioma de la traduccion inicial, si se aporta titulo. */
  locale?: Locale;
  title?: string;
}

export interface CreatedProperty {
  id: number;
  code: string;
}

/** Codigos ya usados que siguen el patron generado. */
async function loadGeneratedCodes(db: AdminDatabase): Promise<string[]> {
  const rows = await db
    .select({ code: properties.code })
    .from(properties)
    .where(like(properties.code, `${PROPERTY_CODE_PREFIX}-%`));

  return rows.map((row) => row.code);
}

export async function createPropertyDraft(
  db: AdminDatabase,
  input: CreatePropertyDraftInput = {},
): Promise<AdminResult<CreatedProperty>> {
  const { propertyTypeId = null, locale = 'es', title } = input;

  if (propertyTypeId !== null) {
    const type = await db
      .select({ id: propertyTypes.id })
      .from(propertyTypes)
      .where(eq(propertyTypes.id, propertyTypeId))
      .limit(1);

    if (type.length === 0) {
      return fail({
        code: 'property_type_not_found',
        message: 'El tipo de propiedad indicado no existe.',
        field: 'propertyTypeId',
      });
    }
  }

  let created: CreatedProperty | null = null;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && created === null; attempt += 1) {
    const code = nextPropertyCode(await loadGeneratedCodes(db));

    try {
      const inserted = await db
        .insert(properties)
        .values({ code, propertyTypeId })
        .returning({ id: properties.id, code: properties.code });

      const row = inserted[0];
      if (row === undefined) {
        return fail({ code: 'code_generation_failed', message: 'No se pudo crear la propiedad.' });
      }

      created = row;
    } catch (error) {
      // Otro proceso tomo el codigo entre el SELECT y el INSERT: se recalcula.
      if (isUniqueViolation(error, 'properties.code')) continue;
      throw error;
    }
  }

  if (created === null) {
    return fail({
      code: 'code_generation_failed',
      message: 'No se pudo generar un codigo libre para la propiedad.',
      field: 'code',
    });
  }

  // Traduccion inicial opcional: solo si el admin aporta un titulo.
  if (title !== undefined && title.trim().length > 0) {
    const cleanTitle = title.trim();
    const slug = toSlug(cleanTitle);

    try {
      await db.insert(propertyTranslations).values({
        propertyId: created.id,
        locale,
        title: cleanTitle,
        slug: slug.length > 0 ? slug : null,
      });
    } catch (error) {
      // Un slug inicial repetido no debe impedir crear el borrador: se guarda
      // sin slug y el admin lo resolvera al editar.
      if (!isUniqueViolation(error)) throw error;

      await db.insert(propertyTranslations).values({
        propertyId: created.id,
        locale,
        title: cleanTitle,
        slug: null,
      });
    }
  }

  return ok(created);
}
