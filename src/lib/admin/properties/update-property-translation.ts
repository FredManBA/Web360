/**
 * Upsert de la traduccion de una propiedad, por (propertyId, locale).
 *
 * ES y EN son independientes: guardar el espanol no obliga a tener ingles.
 */

import { and, eq } from 'drizzle-orm';

import { properties, propertyTranslations } from '../../../db/schema';
import { isValidSlug, toSlug } from '../../domain/slug';
import { propertyTranslationUpsertSchema } from '../../validation/property';
import type { PropertyTranslationUpsertInput } from '../../validation/property';
import {
  fail,
  fromZodError,
  isUniqueViolation,
  ok,
  type AdminDatabase,
  type AdminResult,
} from '../types';

/**
 * Decide el slug a guardar.
 *
 * - slug explicito -> se valida tal cual, sin "arreglarlo" por detras;
 * - slug vacio o nulo -> se limpia a null (aceptable en borrador);
 * - slug ausente y hay titulo nuevo -> se genera a partir del titulo.
 */
function resolveSlug(
  rawSlug: string | null | undefined,
  title: string | null | undefined,
  currentSlug: string | null,
): { ok: true; slug: string | null } | { ok: false } {
  if (rawSlug !== undefined) {
    if (rawSlug === null) return { ok: true, slug: null };

    const trimmed = rawSlug.trim();
    if (trimmed.length === 0) return { ok: true, slug: null };
    if (!isValidSlug(trimmed)) return { ok: false };

    return { ok: true, slug: trimmed };
  }

  // Sin slug explicito: se deriva del titulo solo si aun no habia slug.
  if (currentSlug === null && title !== undefined && title !== null && title.length > 0) {
    const generated = toSlug(title);
    return { ok: true, slug: generated.length > 0 ? generated : null };
  }

  return { ok: true, slug: currentSlug };
}

export async function upsertPropertyTranslation(
  db: AdminDatabase,
  propertyId: number,
  input: PropertyTranslationUpsertInput,
): Promise<AdminResult<typeof propertyTranslations.$inferSelect>> {
  const parsed = propertyTranslationUpsertSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const patch = parsed.data;

  const owner = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  if (owner.length === 0) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const existingRows = await db
    .select()
    .from(propertyTranslations)
    .where(
      and(
        eq(propertyTranslations.propertyId, propertyId),
        eq(propertyTranslations.locale, patch.locale),
      ),
    )
    .limit(1);

  const existing = existingRows[0];

  const slugResult = resolveSlug(patch.slug, patch.title, existing?.slug ?? null);
  if (!slugResult.ok) {
    return fail({
      code: 'validation_failed',
      message: 'El slug no tiene un formato valido.',
      field: 'slug',
    });
  }

  try {
    if (existing === undefined) {
      const inserted = await db
        .insert(propertyTranslations)
        .values({
          propertyId,
          locale: patch.locale,
          slug: slugResult.slug,
          title: patch.title ?? null,
          marketingDescription: patch.marketingDescription ?? null,
          technicalDescription: patch.technicalDescription ?? null,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        return fail({ code: 'not_found', message: 'No se pudo guardar la traduccion.' });
      }
      return ok(row);
    }

    const updated = await db
      .update(propertyTranslations)
      .set({
        slug: slugResult.slug,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.marketingDescription !== undefined
          ? { marketingDescription: patch.marketingDescription }
          : {}),
        ...(patch.technicalDescription !== undefined
          ? { technicalDescription: patch.technicalDescription }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(propertyTranslations.id, existing.id))
      .returning();

    const row = updated[0];
    if (row === undefined) {
      return fail({ code: 'not_found', message: 'No se pudo guardar la traduccion.' });
    }
    return ok(row);
  } catch (error) {
    /*
     * Slug repetido dentro del mismo idioma. Se informa en lugar de anadir un
     * sufijo por detras: renombrar la URL de alguien sin avisar es peor que
     * pedirle al admin que elija otro.
     */
    if (isUniqueViolation(error, 'property_translations.slug')) {
      return fail({
        code: 'slug_taken',
        message: 'Ese slug ya esta en uso en este idioma.',
        field: 'slug',
      });
    }
    throw error;
  }
}
