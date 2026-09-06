/**
 * Tests del catalogo interactivo.
 *
 * Funciones puras: filtros combinados, rangos, orden, reset, query params y
 * "Ver mas". Sin DOM y sin navegador, que es donde vive el resto.
 */

import { describe, expect, it } from 'vitest';

import {
  applyCatalogue,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filtersFromQuery,
  hasActiveFilters,
  matches,
  optionsOf,
  PAGE_SIZE,
  queryFromFilters,
  sortEntries,
  windowFor,
  type CatalogueEntry,
  type CatalogueFilters,
} from './catalogue-filters';

function entry(overrides: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    slug: 'lote',
    propertyType: 'Lote',
    area: 'Nicoya',
    priceMinor: 10_000_00,
    currencyCode: 'USD',
    squareMeters: 1000,
    position: 0,
    ...overrides,
  };
}

function filters(overrides: Partial<CatalogueFilters> = {}): CatalogueFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

/** Catalogo de ejemplo con variedad suficiente para combinar filtros. */
const CATALOGUE: CatalogueEntry[] = [
  entry({
    slug: 'a',
    propertyType: 'Lote',
    area: 'Nicoya',
    priceMinor: 50_000_00,
    squareMeters: 500,
    position: 0,
  }),
  entry({
    slug: 'b',
    propertyType: 'Casa',
    area: 'Nicoya',
    priceMinor: 200_000_00,
    squareMeters: 300,
    position: 1,
  }),
  entry({
    slug: 'c',
    propertyType: 'Lote',
    area: 'Santa Cruz',
    priceMinor: 120_000_00,
    squareMeters: 5000,
    position: 2,
  }),
  entry({
    slug: 'd',
    propertyType: 'Finca',
    area: 'Santa Cruz',
    priceMinor: null,
    squareMeters: 20_000,
    position: 3,
  }),
  entry({
    slug: 'e',
    propertyType: 'Lote',
    area: 'Nicoya',
    priceMinor: 80_000_00,
    squareMeters: null,
    position: 4,
  }),
];

const slugs = (list: readonly CatalogueEntry[]): string[] => list.map((item) => item.slug);

/* -------------------------------------------------------------------------- */
/* Filtros                                                                    */
/* -------------------------------------------------------------------------- */

describe('filtros', () => {
  it('sin filtros pasa todo', () => {
    expect(slugs(applyCatalogue(CATALOGUE, filters()))).toHaveLength(5);
    expect(hasActiveFilters(filters())).toBe(false);
  });

  it('filtra por tipo', () => {
    const result = applyCatalogue(CATALOGUE, filters({ type: 'Lote' }));

    expect(slugs(result).sort()).toEqual(['a', 'c', 'e']);
  });

  it('filtra por zona', () => {
    const result = applyCatalogue(CATALOGUE, filters({ area: 'Santa Cruz' }));

    expect(slugs(result).sort()).toEqual(['c', 'd']);
  });

  it('filtra por precio maximo', () => {
    const result = applyCatalogue(CATALOGUE, filters({ maxPrice: 100_000_00 }));

    // `d` no tiene precio y no se descarta; `b` y `c` pasan del maximo.
    expect(slugs(result).sort()).toEqual(['a', 'd', 'e']);
  });

  it('una propiedad a consultar no se esconde al filtrar por precio', () => {
    const sinPrecio = entry({ priceMinor: null });

    expect(matches(sinPrecio, filters({ maxPrice: 1 }))).toBe(true);
  });

  it('filtra por superficie minima', () => {
    const result = applyCatalogue(CATALOGUE, filters({ minArea: 1000 }));

    expect(slugs(result).sort()).toEqual(['c', 'd']);
  });

  it('una propiedad sin superficie SI se descarta al pedir un minimo', () => {
    const sinSuperficie = entry({ squareMeters: null });

    expect(matches(sinSuperficie, filters({ minArea: 1 }))).toBe(false);
  });

  it('combina varios filtros a la vez', () => {
    const result = applyCatalogue(
      CATALOGUE,
      filters({ type: 'Lote', area: 'Nicoya', maxPrice: 100_000_00 }),
    );

    expect(slugs(result).sort()).toEqual(['a', 'e']);
  });

  it('una combinacion imposible no devuelve nada', () => {
    const result = applyCatalogue(CATALOGUE, filters({ type: 'Casa', area: 'Santa Cruz' }));

    expect(result).toEqual([]);
  });

  it('los limites son inclusivos', () => {
    const justo = entry({ priceMinor: 100, squareMeters: 100 });

    expect(matches(justo, filters({ maxPrice: 100 }))).toBe(true);
    expect(matches(justo, filters({ minArea: 100 }))).toBe(true);
  });

  it('sabe si hay algo filtrando', () => {
    expect(hasActiveFilters(filters({ type: 'Lote' }))).toBe(true);
    expect(hasActiveFilters(filters({ maxPrice: 1 }))).toBe(true);
    // El orden no es un filtro: no cuenta.
    expect(hasActiveFilters(filters({ sort: 'price-asc' }))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Orden                                                                      */
/* -------------------------------------------------------------------------- */

describe('orden', () => {
  it('por defecto, las mas recientes primero', () => {
    expect(slugs(sortEntries(CATALOGUE, 'newest'))).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('por precio ascendente, con las de consultar al final', () => {
    expect(slugs(sortEntries(CATALOGUE, 'price-asc'))).toEqual(['a', 'e', 'c', 'b', 'd']);
  });

  it('por precio descendente, tambien con las de consultar al final', () => {
    expect(slugs(sortEntries(CATALOGUE, 'price-desc'))).toEqual(['b', 'c', 'e', 'a', 'd']);
  });

  it('por superficie ascendente, con las que no la declaran al final', () => {
    expect(slugs(sortEntries(CATALOGUE, 'area-asc'))).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('por superficie descendente', () => {
    expect(slugs(sortEntries(CATALOGUE, 'area-desc'))).toEqual(['d', 'c', 'a', 'b', 'e']);
  });

  it('no altera la lista original', () => {
    const before = slugs(CATALOGUE);
    sortEntries(CATALOGUE, 'price-asc');

    expect(slugs(CATALOGUE)).toEqual(before);
  });

  it('empatados, manda el orden del catalogo', () => {
    const tied = [
      entry({ slug: 'y', priceMinor: 100, position: 5 }),
      entry({ slug: 'x', priceMinor: 100, position: 2 }),
    ];

    expect(slugs(sortEntries(tied, 'price-asc'))).toEqual(['x', 'y']);
  });

  it('filtrar y ordenar van de la mano', () => {
    const result = applyCatalogue(CATALOGUE, filters({ type: 'Lote', sort: 'price-desc' }));

    expect(slugs(result)).toEqual(['c', 'e', 'a']);
  });
});

/* -------------------------------------------------------------------------- */
/* Ver mas                                                                    */
/* -------------------------------------------------------------------------- */

describe('ver mas', () => {
  it('la primera pagina muestra un puñado, no todo', () => {
    const view = windowFor(30, 1);

    expect(view.visible).toBe(PAGE_SIZE);
    expect(view.hasMore).toBe(true);
    expect(view.remaining).toBe(30 - PAGE_SIZE);
  });

  it('cada pulsacion enseña una tanda mas', () => {
    expect(windowFor(30, 2).visible).toBe(PAGE_SIZE * 2);
    expect(windowFor(30, 3).visible).toBe(PAGE_SIZE * 3);
  });

  it('con pocas propiedades no hay boton', () => {
    const view = windowFor(4, 1);

    expect(view.visible).toBe(4);
    expect(view.hasMore).toBe(false);
    expect(view.remaining).toBe(0);
  });

  it('al llegar al final, deja de haber mas', () => {
    const view = windowFor(10, 2);

    expect(view.visible).toBe(10);
    expect(view.hasMore).toBe(false);
  });

  it('un catalogo vacio no rompe la cuenta', () => {
    expect(windowFor(0, 1)).toEqual({ visible: 0, total: 0, hasMore: false, remaining: 0 });
  });

  it('nunca se muestra menos de una pagina', () => {
    expect(windowFor(30, 0).visible).toBe(PAGE_SIZE);
    expect(windowFor(30, -5).visible).toBe(PAGE_SIZE);
  });
});

/* -------------------------------------------------------------------------- */
/* Query params                                                               */
/* -------------------------------------------------------------------------- */

describe('estado en la URL', () => {
  it('sin filtros, la URL se queda limpia', () => {
    expect(queryFromFilters(filters())).toBe('');
  });

  it('escribe solo lo que se aparta de lo normal', () => {
    const query = queryFromFilters(filters({ type: 'Lote', maxPrice: 150_000_00 }));

    expect(query).toContain('tipo=Lote');
    expect(query).toContain('precio=15000000');
    expect(query).not.toContain('orden=');
  });

  it('el orden solo aparece si no es el de siempre', () => {
    expect(queryFromFilters(filters({ sort: DEFAULT_SORT }))).toBe('');
    expect(queryFromFilters(filters({ sort: 'area-desc' }))).toContain('orden=area-desc');
  });

  it('lo escrito se vuelve a leer igual', () => {
    const original = filters({
      type: 'Casa',
      area: 'Santa Cruz',
      maxPrice: 250_000_00,
      minArea: 800,
      sort: 'price-asc',
    });

    expect(filtersFromQuery(queryFromFilters(original))).toEqual(original);
  });

  it('una URL sin nada da los filtros vacios', () => {
    expect(filtersFromQuery('')).toEqual(EMPTY_FILTERS);
  });

  it('un orden inventado cae al de siempre en vez de romper', () => {
    expect(filtersFromQuery('?orden=cualquiera').sort).toBe(DEFAULT_SORT);
  });

  it('numeros imposibles se ignoran', () => {
    const parsed = filtersFromQuery('?precio=abc&area=-5');

    expect(parsed.maxPrice).toBeNull();
    expect(parsed.minArea).toBeNull();
  });

  it('acepta la coma decimal', () => {
    expect(filtersFromQuery('?area=1500,5').minArea).toBe(1500.5);
  });

  it('un valor en blanco no cuenta como filtro', () => {
    expect(filtersFromQuery('?tipo=&zona=%20').type).toBeNull();
    expect(filtersFromQuery('?tipo=&zona=%20').area).toBeNull();
  });

  it('sobrevive a una query manipulada', () => {
    const parsed = filtersFromQuery('?tipo=<script>&precio=Infinity&orden=;drop');

    expect(parsed.maxPrice).toBeNull();
    expect(parsed.sort).toBe(DEFAULT_SORT);
    // El texto se conserva tal cual y no encontrara ninguna propiedad.
    expect(applyCatalogue(CATALOGUE, parsed)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Limpiar                                                                    */
/* -------------------------------------------------------------------------- */

describe('limpiar filtros', () => {
  it('devuelve el catalogo entero', () => {
    const filtered = applyCatalogue(CATALOGUE, filters({ type: 'Casa' }));
    const cleared = applyCatalogue(CATALOGUE, EMPTY_FILTERS);

    expect(filtered).toHaveLength(1);
    expect(cleared).toHaveLength(5);
  });

  it('los filtros vacios no llevan nada dentro', () => {
    expect(EMPTY_FILTERS).toEqual({
      type: null,
      area: null,
      maxPrice: null,
      minArea: null,
      sort: DEFAULT_SORT,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Opciones                                                                   */
/* -------------------------------------------------------------------------- */

describe('opciones de los desplegables', () => {
  it('solo se ofrecen los valores que existen', () => {
    expect(optionsOf(CATALOGUE, 'propertyType')).toEqual(['Casa', 'Finca', 'Lote']);
    expect(optionsOf(CATALOGUE, 'area')).toEqual(['Nicoya', 'Santa Cruz']);
  });

  it('no se repiten ni aparecen los vacios', () => {
    const list = [
      entry({ propertyType: 'Lote' }),
      entry({ propertyType: 'Lote' }),
      entry({ propertyType: null }),
    ];

    expect(optionsOf(list, 'propertyType')).toEqual(['Lote']);
  });

  it('un catalogo vacio no ofrece nada', () => {
    expect(optionsOf([], 'propertyType')).toEqual([]);
  });
});
