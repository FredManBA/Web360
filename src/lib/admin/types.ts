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
 * sentencias o ninguna. Es lo que necesita la reordenacion para no dejar
 * medio intercambio persistido.
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
  | 'code_taken'
  | 'slug_taken'
  | 'property_type_not_found'
  | 'invalid_status_transition'
  | 'code_generation_failed'
  | 'feature_group_not_found'
  | 'feature_not_found'
  // El grupo existe, pero es de otra propiedad: la base no puede impedirlo.
  | 'feature_group_property_mismatch'
  // La lista de reordenacion no coincide con lo que hay ahora en la base.
  | 'feature_order_conflict'

  // -- Multimedia ------------------------------------------------------------
  | 'media_not_found'
  | 'media_group_not_found'
  | 'media_group_property_mismatch'
  // Combinacion imposible de proveedor y tipo (un panorama de YouTube, p. ej.).
  | 'media_invalid_provider'
  // El tipo no admite el rol pedido: un documento no puede encabezar la ficha.
  | 'media_role_conflict'
  // Otra fila ya usa esa clave de R2.
  | 'media_object_key_taken'
  // No se puede borrar: un nodo del recorrido 360 depende de este panorama.
  | 'media_in_use'
  // El archivo no pasa las comprobaciones: tipo, contenido o tamano.
  | 'media_upload_rejected'
  // R2 no acepto la escritura; no se ha registrado nada.
  | 'media_upload_failed'

  // -- Recorrido 360 ---------------------------------------------------------
  | 'tour_node_not_found'
  | 'tour_link_not_found'
  // Un nodo solo puede apoyarse en un panorama.
  | 'tour_media_not_panorama'
  | 'tour_media_property_mismatch'
  // Ese panorama ya sostiene otro nodo: el esquema admite uno solo.
  | 'tour_media_in_use'
  // Enlace imposible: a si mismo, o entre nodos de propiedades distintas.
  | 'tour_link_invalid'
  | 'tour_link_duplicate'

  // -- Consultas -------------------------------------------------------------
  | 'contact_not_found'

  // -- Configuracion del sitio -----------------------------------------------
  | 'social_link_not_found'
  // El orden enviado ya no describe los enlaces guardados.
  | 'social_order_conflict'

  // -- Revision privada ------------------------------------------------------
  | 'review_not_found'
  // No existe, caduco, se revoco o ya se uso: por fuera son el mismo caso.
  | 'review_link_invalid'
  | 'review_failed'

  // -- Publicacion -----------------------------------------------------------
  // El estado editorial actual no admite la operacion pedida.
  | 'publication_not_allowed'
  // La ficha no esta completa: no se llega a crear ninguna peticion.
  | 'publication_incomplete'
  // Ya hay una operacion viva sobre esa propiedad.
  | 'publication_in_progress'
  // No hay ninguna operacion de publicacion con ese numero, o ya no esta viva.
  | 'publication_request_not_found'
  // Se intento abandonar algo que el artefacto desplegado si confirma.
  | 'publication_must_reconcile'
  // Token de callback que no existe, o que ya se uso: no se distinguen.
  | 'publication_link_invalid'
  // Quien tenia que construir el sitio no acepto el trabajo.
  | 'publication_trigger_failed'
  | 'publication_failed';

export interface FieldIssue {
  /** Ruta del campo, p. ej. "publicLatitude" o "translations.es.slug". */
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

export function fail<T>(error: AdminError): AdminResult<T> {
  return { ok: false, error };
}

/** Traduce un `ZodError` a la forma de error de esta capa. */
export function fromZodError<T>(error: ZodError, message = 'Datos invalidos.'): AdminResult<T> {
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
