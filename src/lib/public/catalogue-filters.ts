/**
 * Filtros, orden y paginacion del catalogo.
 *
 * Funciones puras sobre datos ya publicos: no tocan el DOM, no consultan nada
 * y no saben de donde salen las propiedades. El modulo de navegador se limita
 * a leerlas y pintar el resultado.
 *
 * Todo el filtrado ocurre en el navegador sobre las tarjetas que ya vienen en
 * el HTML: el sitio sigue siendo estatico y, sin JavaScript, se ven todas.
 */

/** Lo que hace falta de cada propiedad para filtrar y ordenar. */
export interface CatalogueEntry {
  slug: string;
  propertyType: string | null;
  /** Zona por la que se agrupa; hoy, el canton. */
  area: string | null;
  /** En unidades menores; `null` cuando el precio es a consultar. */
  priceMinor: number | null;
  currencyCode: string | null;
  squareMeters: number | null;
  /** Posicion en el catalogo; sirve para "mas recientes" sin publicar fechas. */
  position: number;
}

export const SORT_OPTIONS = ['newest', 'price-asc', 'price-desc', 'area-asc', 'area-desc'] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];

export const DEFAULT_SORT: SortOption = 'newest';

/** Cuantas tarjetas se ven antes de pulsar "Ver mas". */
export const PAGE_SIZE = 9;

export interface CatalogueFilters {
  type: string | null;
  area: string | null;
  /** Precio maximo en unidades menores. */
  maxPrice: number | null;
  /** Superficie minima en metros cuadrados. */
  minArea: number | null;
  sort: SortOption;
}

export const EMPTY_FILTERS: CatalogueFilters = {
  type: null,
  area: null,
  maxPrice: null,
  minArea: null,
  sort: DEFAULT_SORT,
};

export function hasActiveFilters(filters: CatalogueFilters): boolean {
  return (
    filters.type !== null ||
    filters.area !== null ||
    filters.maxPrice !== null ||
    filters.minArea !== null
  );
}

/* -------------------------------------------------------------------------- */
/* Filtrado                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Decide si una propiedad pasa los filtros.
 *
 * Dos criterios que no son obvios:
 *
 * - una propiedad a consultar NO se descarta al filtrar por precio maximo. No
 *   se sabe cuanto cuesta, y esconderla por si acaso perjudica justo a las que
 *   se negocian caso por caso;
 * - una sin superficie declarada si se descarta al pedir un minimo: ahi el
 *   filtro pregunta por un dato concreto que la ficha no tiene.
 */
export function matches(entry: CatalogueEntry, filters: CatalogueFilters): boolean {
  if (filters.type !== null && entry.propertyType !== filters.type) return false;
  if (filters.area !== null && entry.area !== filters.area) return false;

  if (filters.maxPrice !== null && entry.priceMinor !== null) {
    if (entry.priceMinor > filters.maxPrice) return false;
  }

  if (filters.minArea !== null) {
    if (entry.squareMeters === null) return false;
    if (entry.squareMeters < filters.minArea) return false;
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Orden                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Lo que no tiene valor va al final.
 *
 * Ordenar por precio con las "a consultar" mezcladas en medio confunde; se
 * agrupan al final, ordenadas entre ellas por el orden del catalogo.
 */
function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  return (a - b) * direction;
}

export function sortEntries(
  entries: readonly CatalogueEntry[],
  sort: SortOption,
): CatalogueEntry[] {
  const list = [...entries];

  switch (sort) {
    case 'price-asc':
      return list.sort(
        (a, b) => compareNullable(a.priceMinor, b.priceMinor, 1) || a.position - b.position,
      );

    case 'price-desc':
      return list.sort(
        (a, b) => compareNullable(a.priceMinor, b.priceMinor, -1) || a.position - b.position,
      );

    case 'area-asc':
      return list.sort(
        (a, b) => compareNullable(a.squareMeters, b.squareMeters, 1) || a.position - b.position,
      );

    case 'area-desc':
      return list.sort(
        (a, b) => compareNullable(a.squareMeters, b.squareMeters, -1) || a.position - b.position,
      );

    default:
      /*
       * "Mas recientes" es el orden del catalogo del reves: las propiedades se
       * listan por antiguedad, asi que la ultima es la mas nueva. No hace falta
       * publicar ninguna fecha para saberlo.
       */
      return list.sort((a, b) => b.position - a.position);
  }
}

/** Filtra y ordena de una vez, que es como lo usa la pagina. */
export function applyCatalogue(
  entries: readonly CatalogueEntry[],
  filters: CatalogueFilters,
): CatalogueEntry[] {
  return sortEntries(
    entries.filter((entry) => matches(entry, filters)),
    filters.sort,
  );
}

/* -------------------------------------------------------------------------- */
/* Ver mas                                                                    */
/* -------------------------------------------------------------------------- */

export interface VisibleWindow {
  visible: number;
  total: number;
  hasMore: boolean;
  remaining: number;
}

/** Cuantas tarjetas se ven con `pages` paginas mostradas. */
export function windowFor(total: number, pages: number, size: number = PAGE_SIZE): VisibleWindow {
  const visible = Math.min(total, Math.max(1, pages) * size);

  return { visible, total, hasMore: visible < total, remaining: total - visible };
}

/* -------------------------------------------------------------------------- */
/* Query params                                                               */
/* -------------------------------------------------------------------------- */

const PARAM = {
  type: 'tipo',
  area: 'zona',
  maxPrice: 'precio',
  minArea: 'area',
  sort: 'orden',
} as const;

function readNumber(raw: string | null): number | null {
  if (raw === null) return null;

  const value = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readSort(raw: string | null): SortOption {
  return SORT_OPTIONS.find((option) => option === raw) ?? DEFAULT_SORT;
}

function readText(raw: string | null): string | null {
  const value = raw?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * Lee los filtros de una URL.
 *
 * Cualquier valor raro se ignora y se cae al valor por defecto: un enlace
 * compartido con la query manipulada tiene que seguir mostrando el catalogo,
 * no romperse.
 */
export function filtersFromQuery(search: string): CatalogueFilters {
  const params = new URLSearchParams(search);

  return {
    type: readText(params.get(PARAM.type)),
    area: readText(params.get(PARAM.area)),
    maxPrice: readNumber(params.get(PARAM.maxPrice)),
    minArea: readNumber(params.get(PARAM.minArea)),
    sort: readSort(params.get(PARAM.sort)),
  };
}

/**
 * Escribe los filtros como query, para poder compartir el estado.
 *
 * Solo se escribe lo que se aparta de lo normal: sin filtros, la URL se queda
 * limpia en vez de arrastrar media docena de parametros vacios.
 */
export function queryFromFilters(filters: CatalogueFilters): string {
  const params = new URLSearchParams();

  if (filters.type !== null) params.set(PARAM.type, filters.type);
  if (filters.area !== null) params.set(PARAM.area, filters.area);
  if (filters.maxPrice !== null) params.set(PARAM.maxPrice, String(filters.maxPrice));
  if (filters.minArea !== null) params.set(PARAM.minArea, String(filters.minArea));
  if (filters.sort !== DEFAULT_SORT) params.set(PARAM.sort, filters.sort);

  const query = params.toString();
  return query.length === 0 ? '' : `?${query}`;
}

/* -------------------------------------------------------------------------- */
/* Opciones disponibles                                                       */
/* -------------------------------------------------------------------------- */

/** Valores que de verdad existen en el catalogo, ordenados y sin repetir. */
export function optionsOf(
  entries: readonly CatalogueEntry[],
  field: 'propertyType' | 'area',
): string[] {
  const values = new Set<string>();

  for (const entry of entries) {
    const value = entry[field];
    if (value !== null && value.length > 0) values.add(value);
  }

  return [...values].sort((a, b) => a.localeCompare(b));
}
