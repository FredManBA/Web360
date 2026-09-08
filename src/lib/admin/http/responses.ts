/**
 * Respuestas JSON de la API administrativa.
 *
 * Formato unico:
 *
 *   exito -> { "ok": true,  "data": ... }
 *   error -> { "ok": false, "error": { code, message, field?, details? } }
 *
 * No es un framework de API: son dos helpers y una tabla de codigos HTTP.
 */

import type { AdminError, AdminErrorCode, AdminResult } from '../types';

/** Codigos propios de la capa HTTP, que no existen en el dominio. */
export type HttpErrorCode =
  AdminErrorCode | 'forbidden' | 'invalid_json' | 'unsupported_media_type' | 'internal_error';

export interface JsonErrorBody {
  ok: false;
  error: {
    code: HttpErrorCode;
    message: string;
    field?: string;
    details?: unknown;
  };
}

/**
 * Ninguna respuesta administrativa debe quedar cacheada: contiene borradores,
 * coordenadas privadas y datos que no son publicos.
 */
const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function jsonSuccess(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: BASE_HEADERS });
}

export function jsonError(
  code: HttpErrorCode,
  message: string,
  status: number,
  extra: { field?: string; details?: unknown } = {},
): Response {
  const body: JsonErrorBody = {
    ok: false,
    error: {
      code,
      message,
      ...(extra.field !== undefined ? { field: extra.field } : {}),
      ...(extra.details !== undefined ? { details: extra.details } : {}),
    },
  };

  return new Response(JSON.stringify(body), { status, headers: BASE_HEADERS });
}

/** Codigo HTTP de cada error de dominio. */
const STATUS_BY_ERROR: Record<AdminErrorCode, number> = {
  validation_failed: 422,
  not_found: 404,
  code_taken: 409,
  slug_taken: 409,
  // El tipo referenciado no existe: la peticion se entiende pero no es
  // procesable, igual que cualquier otro fallo de validacion.
  property_type_not_found: 422,
  invalid_status_transition: 422,
  code_generation_failed: 500,

  feature_group_not_found: 404,
  feature_not_found: 404,
  // Peticion entendible pero no procesable: el grupo no es de esa propiedad.
  feature_group_property_mismatch: 422,
  // El orden enviado ya no describe la realidad: conflicto de estado.
  feature_order_conflict: 409,

  media_not_found: 404,
  media_group_not_found: 404,
  media_group_property_mismatch: 422,
  media_invalid_provider: 422,
  media_role_conflict: 422,
  // Choque con algo que ya existe, no con la forma de la peticion.
  media_object_key_taken: 409,
  media_in_use: 409,
  media_upload_rejected: 422,
  // El almacenamiento no respondio: no es culpa de la peticion.
  media_upload_failed: 502,

  tour_node_not_found: 404,
  tour_link_not_found: 404,
  tour_media_not_panorama: 422,
  tour_media_property_mismatch: 422,
  // Choque con algo que ya existe, no con la forma de la peticion.
  tour_media_in_use: 409,
  tour_link_invalid: 422,
  tour_link_duplicate: 409,

  contact_not_found: 404,

  social_link_not_found: 404,
  // Choque de estado, no de forma: la lista ya no describe la realidad.
  social_order_conflict: 409,

  review_not_found: 404,
  // No se distingue caducado de inexistente: decirlo confirmaria que existio.
  review_link_invalid: 404,
  review_failed: 500,
};

export function jsonFromAdminError(error: AdminError): Response {
  return jsonError(error.code, error.message, STATUS_BY_ERROR[error.code], {
    ...(error.field !== undefined ? { field: error.field } : {}),
    ...(error.issues !== undefined ? { details: { issues: error.issues } } : {}),
  });
}

/** Convierte el resultado de una funcion de dominio en respuesta HTTP. */
export function jsonFromResult<T>(result: AdminResult<T>, successStatus = 200): Response {
  return result.ok ? jsonSuccess(result.data, successStatus) : jsonFromAdminError(result.error);
}

/**
 * Error inesperado.
 *
 * Nunca se filtra el detalle al cliente: un mensaje de SQLite revelaria
 * nombres de tablas y columnas. Se registra por consola para desarrollo y se
 * devuelve un texto generico.
 */
export function jsonInternalError(error: unknown): Response {
  console.error('[admin-api] error inesperado:', error);
  return jsonError('internal_error', 'Error interno del servidor.', 500);
}
