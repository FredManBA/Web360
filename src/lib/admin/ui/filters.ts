/**
 * Filtros del listado.
 *
 * Solo los tres que la API ya soporta. No hay busqueda textual, ni filtro por
 * precio o superficie, ni paginacion.
 *
 * Los filtros viven en la query string de `/admin/propiedades`, de modo que
 * recargar o compartir el enlace los conserva. No es un router de cliente:
 * son tres parametros que se leen y se escriben.
 */

import { COMMERCIAL_STATUSES, PUBLICATION_STATUSES } from '../../domain/vocabularies';
import type { CommercialStatus, PublicationStatus } from '../../domain/vocabularies';

export interface PropertyFilters {
  publicationStatus: PublicationStatus | null;
  commercialStatus: CommercialStatus | null;
  propertyTypeId: number | null;
}

export const EMPTY_FILTERS: PropertyFilters = {
  publicationStatus: null,
  commercialStatus: null,
  propertyTypeId: null,
};

/** Valor del `<select>` que representa "Todos". */
export const ALL_OPTION = '';

function asPublicationStatus(raw: string | null): PublicationStatus | null {
  if (raw === null) return null;
  return (PUBLICATION_STATUSES as readonly string[]).includes(raw)
    ? (raw as PublicationStatus)
    : null;
}

function asCommercialStatus(raw: string | null): CommercialStatus | null {
  if (raw === null) return null;
  return (COMMERCIAL_STATUSES as readonly string[]).includes(raw)
    ? (raw as CommercialStatus)
    : null;
}

function asPropertyTypeId(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Lee los filtros de una query string.
 *
 * Un valor desconocido se ignora en lugar de romper la pagina: la URL la
 * puede editar cualquiera.
 */
export function readFilters(search: string): PropertyFilters {
  const params = new URLSearchParams(search);

  return {
    publicationStatus: asPublicationStatus(params.get('publicationStatus')),
    commercialStatus: asCommercialStatus(params.get('commercialStatus')),
    propertyTypeId: asPropertyTypeId(params.get('propertyTypeId')),
  };
}

/** Query string canonica, con los parametros siempre en el mismo orden. */
export function filtersToQuery(filters: PropertyFilters): string {
  const params = new URLSearchParams();

  if (filters.publicationStatus !== null) {
    params.set('publicationStatus', filters.publicationStatus);
  }
  if (filters.commercialStatus !== null) {
    params.set('commercialStatus', filters.commercialStatus);
  }
  if (filters.propertyTypeId !== null) {
    params.set('propertyTypeId', String(filters.propertyTypeId));
  }

  return params.toString();
}

/** URL de la API con los filtros aplicados. */
export function buildApiUrl(filters: PropertyFilters): string {
  const query = filtersToQuery(filters);
  return query.length > 0 ? `/api/admin/properties?${query}` : '/api/admin/properties';
}

/** URL del panel, para reflejar los filtros en la barra de direcciones. */
export function buildPageUrl(filters: PropertyFilters): string {
  const query = filtersToQuery(filters);
  return query.length > 0 ? `/admin/propiedades?${query}` : '/admin/propiedades';
}

export function hasActiveFilters(filters: PropertyFilters): boolean {
  return (
    filters.publicationStatus !== null ||
    filters.commercialStatus !== null ||
    filters.propertyTypeId !== null
  );
}
