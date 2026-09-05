/**
 * Estado de la vista del listado.
 *
 * Una funcion pura decide que se muestra, de modo que la logica de "vacio" vs
 * "sin coincidencias" vs "error" se puede probar sin DOM.
 */

import { hasActiveFilters, type PropertyFilters } from './filters';

export type ListState = 'loading' | 'error' | 'forbidden' | 'empty' | 'no-matches' | 'ready';

export interface ListStateInput {
  loading: boolean;
  /** Codigo HTTP de la respuesta fallida, si la hubo. */
  errorStatus: number | null;
  /** Numero de filas devueltas, o `null` si aun no hay respuesta. */
  count: number | null;
  filters: PropertyFilters;
}

/**
 * Distinguir base vacia de filtros sin coincidencias no necesita una consulta
 * extra: si hay filtros activos y no vuelve nada, es que los filtros no
 * casan; sin filtros, la base esta vacia.
 */
export function resolveListState(input: ListStateInput): ListState {
  if (input.loading) return 'loading';
  if (input.errorStatus === 403) return 'forbidden';
  if (input.errorStatus !== null) return 'error';
  if (input.count === null) return 'loading';

  if (input.count === 0) {
    return hasActiveFilters(input.filters) ? 'no-matches' : 'empty';
  }

  return 'ready';
}

export const LIST_STATE_MESSAGES: Record<Exclude<ListState, 'ready'>, string> = {
  loading: 'Cargando propiedades…',
  forbidden: 'No tienes acceso al panel administrativo.',
  error: 'No pudimos cargar las propiedades.',
  empty: 'Todavía no hay propiedades.',
  'no-matches': 'No hay propiedades que coincidan con estos filtros.',
};

export function listStateMessage(state: ListState): string | null {
  return state === 'ready' ? null : LIST_STATE_MESSAGES[state];
}

/** Solo un error general ofrece reintentar; un 403 no se arregla reintentando. */
export function canRetry(state: ListState): boolean {
  return state === 'error';
}
