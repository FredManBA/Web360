/**
 * Tipos compartidos de la capa administrativa.
 *
 * Los errores esperables (validacion, no encontrado, codigo duplicado) se
 * devuelven como valor, no como excepcion. Solo los fallos inesperados de base
 * de datos se propagan.
 *
 * No hay framework de errores: un discriminante `ok` y un codigo estable.
 */

import type { BatchItem } from 'drizzle-orm/batch';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { ZodError } from 'zod';

import type * as schema from '../../db/schema';

/**
 * Cualquier base SQLite asincrona con nuestro esquema.
 *
 * Se tipa asi, y no como `DrizzleD1Database`, para que la misma logica pueda
 * ejecutarse contra D1 en produccion y contra SQLite real en los tests sin
 * necesidad de casts ni de mockear el acceso a datos.
 */
export type AdminDatabase = BaseSQLiteDatabase<'async', unknown, typeof schema>;

/** Una sentencia de las que admite un lote. */
export type AdminBatchItem = BatchItem<'sqlite'>;

/**
 * Base capaz de ejecutar varias sentencias en una sola transaccion.
 *
 * D1 no ofrece transacciones interactivas, pero si `batch()`, que envuelve el
 * lote completo en una transaccion implicita: o se aplican todas las
 * sentencias o ninguna. Esto permite sustituir la portada en una sola operacion.
 *
 * Se declara aparte de `AdminDatabase` porque `BaseSQLiteDatabase` no incluye
 * `batch`; lo aportan los drivers concretos (D1 y el proxy de los tests).
 */
export type AdminBatchDatabase = AdminDatabase & {
  batch: (statements: [AdminBatchItem, ...AdminBatchItem[]]) => Promise<unknown[]>;
};

export type AdminErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'code_generation_failed'
  | 'slug_taken'
  | 'media_in_use'
  | 'media_upload_rejected'
  | 'publication_incomplete';

export interface FieldIssue {
  /** Ruta del campo, p. ej. "mapLatitude" o "slugEs". */
  path: string;
  message: string;
}

export interface AdminError {
  code: AdminErrorCode;
  message: string;
  /** Campo principal implicado, cuando hay uno claro. */
  field?: string;
  /** Detalle por campo cuando el fallo es de validacion. */
  issues?: FieldIssue[];
}

export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: AdminError };

export function ok<T>(data: T): AdminResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: AdminError): AdminResult<T> {
  return { ok: false, error };
}

/** Traduce un `ZodError` a la forma de error de esta capa. */
export function fromZodError<T = never>(
  error: ZodError,
  message = 'Datos invalidos.',
): AdminResult<T> {
  const issues: FieldIssue[] = error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

  const first = issues[0];

  return fail({
    code: 'validation_failed',
    message,
    ...(first !== undefined && first.path.length > 0 ? { field: first.path } : {}),
    issues,
  });
}

/**
 * Detecta la violacion de un UNIQUE a partir del error del driver.
 *
 * Tanto D1 como SQLite devuelven un mensaje del tipo
 * "UNIQUE constraint failed: properties.code". No hay un codigo de error
 * estructurado comun, asi que se inspecciona el texto; por eso `column` se
 * compara de forma laxa.
 *
 * Drizzle envuelve el error del driver en uno propio ("Failed query: ...") y
 * deja el original en `cause`, asi que hay que recorrer toda la cadena: mirar
 * solo `error.message` deja pasar la violacion sin detectarla.
 */
function collectErrorMessages(error: unknown, depth = 0): string {
  if (depth > 5 || error === null || error === undefined) return '';

  if (error instanceof Error) {
    return `${error.message} ${collectErrorMessages(error.cause, depth + 1)}`;
  }

  return String(error);
}

export function isUniqueViolation(error: unknown, column?: string): boolean {
  const message = collectErrorMessages(error);
  if (!message.includes('UNIQUE constraint failed')) return false;
  return column === undefined || message.includes(column);
}
