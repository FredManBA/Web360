/**
 * Actualizacion parcial del nucleo de una propiedad.
 *
 * El estado editorial NO se toca aqui: `propertyCoreUpdateSchema` es estricto
 * y rechaza `publicationStatus`, `id`, `createdAt` y `publishedAt`.
 */

import { eq } from 'drizzle-orm';

import { properties, propertyTypes } from '../../../db/schema';
import { validatePrice } from '../../domain/money';
import { propertyCoreUpdateSchema } from '../../validation/property';
import type { PropertyCoreUpdateInput } from '../../validation/property';
import {
  fail,
  fromZodError,
  isUniqueViolation,
  ok,
  type AdminDatabase,
  type AdminResult,
  type FieldIssue,
} from '../types';
import { normalizePropertyCode, validatePropertyCode } from './codes';

const CODE_PROBLEM_MESSAGES: Record<string, string> = {
  empty: 'El codigo no puede estar vacio.',
  too_long: 'El codigo es demasiado largo.',
  unsafe_characters: 'El codigo solo admite letras, digitos y . _ - /',
};

const PRICE_PROBLEM_MESSAGES: Record<string, string> = {
  amount_required: 'El modo de precio elegido exige un importe.',
  currency_required: 'El modo de precio elegido exige una moneda.',
  currency_invalid: 'La moneda no es un codigo ISO 4217 valido.',
  amount_negative: 'El importe no puede ser negativo.',
};

export async function updateProperty(
  db: AdminDatabase,
  propertyId: number,
  input: PropertyCoreUpdateInput,
): Promise<AdminResult<typeof properties.$inferSelect>> {
  const parsed = propertyCoreUpdateSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const patch = parsed.data;

  const current = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);

  const existing = current[0];
  if (existing === undefined) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  // -- Codigo --------------------------------------------------------------
  if (patch.code !== undefined) {
    const problems = validatePropertyCode(patch.code);
    if (problems.length > 0) {
      const first = problems[0] ?? 'empty';
      return fail({
        code: 'validation_failed',
        message: CODE_PROBLEM_MESSAGES[first] ?? 'Codigo invalido.',
        field: 'code',
      });
    }
    patch.code = normalizePropertyCode(patch.code);
  }

  // -- Tipo ----------------------------------------------------------------
  if (patch.propertyTypeId !== undefined && patch.propertyTypeId !== null) {
    const type = await db
      .select({ id: propertyTypes.id })
      .from(propertyTypes)
      .where(eq(propertyTypes.id, patch.propertyTypeId))
      .limit(1);

    if (type.length === 0) {
      return fail({
        code: 'property_type_not_found',
        message: 'El tipo de propiedad indicado no existe.',
        field: 'propertyTypeId',
      });
    }
  }

  // -- Precio: se valida el estado RESULTANTE, no solo lo que llega --------
  const resulting = {
    priceMode: patch.priceMode ?? existing.priceMode,
    priceAmountMinor:
      patch.priceAmountMinor !== undefined ? patch.priceAmountMinor : existing.priceAmountMinor,
    currencyCode: patch.currencyCode !== undefined ? patch.currencyCode : existing.currencyCode,
  };

  const priceProblems = validatePrice(resulting);
  if (priceProblems.length > 0) {
    const issues: FieldIssue[] = priceProblems.map((problem) => ({
      path:
        problem === 'currency_required' || problem === 'currency_invalid'
          ? 'currencyCode'
          : 'priceAmountMinor',
      message: PRICE_PROBLEM_MESSAGES[problem] ?? 'Configuracion de precio incoherente.',
    }));

    return fail({
      code: 'validation_failed',
      message: 'Configuracion de precio incoherente.',
      field: issues[0]?.path ?? 'priceMode',
      issues,
    });
  }

  // -- Coordenadas: o las dos, o ninguna -----------------------------------
  const publicLat =
    patch.publicLatitude !== undefined ? patch.publicLatitude : existing.publicLatitude;
  const publicLng =
    patch.publicLongitude !== undefined ? patch.publicLongitude : existing.publicLongitude;
  const privateLat =
    patch.privateLatitude !== undefined ? patch.privateLatitude : existing.privateLatitude;
  const privateLng =
    patch.privateLongitude !== undefined ? patch.privateLongitude : existing.privateLongitude;

  if ((publicLat === null) !== (publicLng === null)) {
    return fail({
      code: 'validation_failed',
      message: 'La coordenada publica necesita latitud y longitud, o ninguna de las dos.',
      field: 'publicLatitude',
    });
  }

  if ((privateLat === null) !== (privateLng === null)) {
    return fail({
      code: 'validation_failed',
      message: 'La coordenada privada necesita latitud y longitud, o ninguna de las dos.',
      field: 'privateLatitude',
    });
  }

  if (Object.keys(patch).length === 0) return ok(existing);

  /*
   * `updatedAt` se fija explicitamente. Drizzle aplica `$onUpdate` en el
   * `.set()`, pero dejarlo escrito aqui hace visible la intencion y protege
   * la marca de tiempo si alguna vez se cambia la forma de actualizar.
   */
  try {
    const updated = await db
      .update(properties)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(properties.id, propertyId))
      .returning();

    const row = updated[0];
    if (row === undefined) {
      return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
    }

    return ok(row);
  } catch (error) {
    // El SELECT previo no basta como garantia de unicidad: la base decide.
    if (isUniqueViolation(error, 'properties.code')) {
      return fail({
        code: 'code_taken',
        message: 'Ya existe otra propiedad con ese codigo.',
        field: 'code',
      });
    }
    throw error;
  }
}
