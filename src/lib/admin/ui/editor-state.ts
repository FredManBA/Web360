/**
 * Estado del editor de informacion basica.
 *
 * Funciones puras: deteccion de cambios pendientes, construccion del PATCH y
 * traduccion de los errores de la API a mensajes de campo. Sin DOM, para que
 * todo esto se pueda probar.
 *
 * La validacion de codigo reutiliza `validatePropertyCode` de la Fase 2B; no
 * se reescriben aqui las reglas de dominio.
 */

import { validatePropertyCode } from '../properties/codes';
import type { CommercialStatus } from '../../domain/vocabularies';

/** Los unicos campos que esta subfase edita. */
export interface BasicFields {
  code: string;
  propertyTypeId: number | null;
  commercialStatus: CommercialStatus;
  isFeatured: boolean;
  showWhenSold: boolean;
}

export interface PropertyPayload {
  id: number;
  code: string;
  propertyTypeId: number | null;
  commercialStatus: CommercialStatus;
  isFeatured: boolean;
  showWhenSold: boolean;
}

export function toBasicFields(property: PropertyPayload): BasicFields {
  return {
    code: property.code,
    propertyTypeId: property.propertyTypeId,
    commercialStatus: property.commercialStatus,
    isFeatured: property.isFeatured,
    showWhenSold: property.showWhenSold,
  };
}

export function isDirty(loaded: BasicFields, current: BasicFields): boolean {
  return (
    loaded.code !== current.code ||
    loaded.propertyTypeId !== current.propertyTypeId ||
    loaded.commercialStatus !== current.commercialStatus ||
    loaded.isFeatured !== current.isFeatured ||
    loaded.showWhenSold !== current.showWhenSold
  );
}

/**
 * Solo los campos que cambiaron.
 *
 * Enviar un PATCH parcial evita, por ejemplo, que reenviar un codigo intacto
 * pueda chocar contra su propio UNIQUE.
 */
export function buildPatch(loaded: BasicFields, current: BasicFields): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (loaded.code !== current.code) patch.code = current.code;
  if (loaded.propertyTypeId !== current.propertyTypeId) {
    patch.propertyTypeId = current.propertyTypeId;
  }
  if (loaded.commercialStatus !== current.commercialStatus) {
    patch.commercialStatus = current.commercialStatus;
  }
  if (loaded.isFeatured !== current.isFeatured) patch.isFeatured = current.isFeatured;
  if (loaded.showWhenSold !== current.showWhenSold) patch.showWhenSold = current.showWhenSold;

  return patch;
}

/* -------------------------------------------------------------------------- */
/* Estado de guardado                                                         */
/* -------------------------------------------------------------------------- */

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export const SAVE_STATE_LABELS: Record<SaveState, string> = {
  saved: 'Guardado',
  dirty: 'Cambios sin guardar',
  saving: 'Guardando…',
  error: 'Error al guardar',
};

export function saveStateLabel(state: SaveState): string {
  return SAVE_STATE_LABELS[state];
}

/** Solo se avisa al salir cuando hay trabajo que se perderia. */
export function shouldWarnBeforeUnload(state: SaveState): boolean {
  return state === 'dirty' || state === 'error';
}

/* -------------------------------------------------------------------------- */
/* Carga                                                                      */
/* -------------------------------------------------------------------------- */

export type LoadState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

export const LOAD_STATE_MESSAGES: Record<Exclude<LoadState, 'ready'>, string> = {
  loading: 'Cargando propiedad…',
  'not-found': 'La propiedad no existe.',
  forbidden: 'No tienes acceso al panel administrativo.',
  error: 'No pudimos cargar la propiedad.',
};

export function resolveLoadState(status: number | null): LoadState {
  if (status === null) return 'loading';
  if (status === 200) return 'ready';
  if (status === 404) return 'not-found';
  if (status === 403) return 'forbidden';
  return 'error';
}

export function loadStateMessage(state: LoadState): string | null {
  return state === 'ready' ? null : LOAD_STATE_MESSAGES[state];
}

/* -------------------------------------------------------------------------- */
/* Errores de guardado                                                        */
/* -------------------------------------------------------------------------- */

export interface SaveError {
  /** Campo al que asociar el error, o `null` si es general. */
  field: string | null;
  message: string;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    field?: string;
  };
}

const CODE_TAKEN_MESSAGE = 'Ya existe otra propiedad con ese código.';
const GENERIC_SAVE_MESSAGE = 'No pudimos guardar los cambios.';
const FORBIDDEN_MESSAGE = 'No tienes acceso al panel administrativo.';

/** Mensajes locales de los problemas de codigo que detecta el dominio. */
const CODE_PROBLEM_MESSAGES: Record<string, string> = {
  empty: 'El código no puede estar vacío.',
  too_long: 'El código es demasiado largo.',
  unsafe_characters: 'El código solo admite letras, dígitos y . _ - /',
};

/**
 * Comprobacion local previa, para no gastar una peticion en algo evidente.
 * La autoridad final sigue siendo la API.
 */
export function validateCodeLocally(code: string): string | null {
  const problems = validatePropertyCode(code);
  if (problems.length === 0) return null;

  const first = problems[0] ?? 'empty';
  return CODE_PROBLEM_MESSAGES[first] ?? 'Código inválido.';
}

/**
 * Traduce la respuesta de error de la API.
 *
 * Nunca se muestra el cuerpo crudo: solo un mensaje conocido, asociado a un
 * campo cuando la API indica cual.
 */
export function mapSaveError(status: number, body: unknown): SaveError {
  const parsed = (body ?? {}) as ApiErrorBody;
  const code = parsed.error?.code;
  const field = parsed.error?.field ?? null;

  if (status === 409 && code === 'code_taken') {
    return { field: 'code', message: CODE_TAKEN_MESSAGE };
  }

  if (status === 403) return { field: null, message: FORBIDDEN_MESSAGE };

  if (status === 422) {
    const message = parsed.error?.message;
    return {
      field,
      message: typeof message === 'string' && message.length > 0 ? message : GENERIC_SAVE_MESSAGE,
    };
  }

  return { field: null, message: GENERIC_SAVE_MESSAGE };
}
