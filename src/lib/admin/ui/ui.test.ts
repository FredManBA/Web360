/**
 * Tests de la capa de presentacion del panel.
 *
 * Se prueban funciones puras (etiquetas, modelo de fila, filtros, estados) y
 * la estructura de las paginas Astro. Sin navegador ni E2E.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { COMMERCIAL_STATUSES, PUBLICATION_STATUSES } from '../../domain/vocabularies';
import {
  buildApiUrl,
  buildPageUrl,
  filtersToQuery,
  hasActiveFilters,
  readFilters,
  EMPTY_FILTERS,
} from './filters';
import { commercialStatusLabel, propertyCountLabel, publicationStatusLabel } from './labels';
import { canRetry, listStateMessage, resolveListState } from './list-state';
import {
  resolveArea,
  resolvePrice,
  resolveTitle,
  resolveTypeName,
  toPropertyRowView,
  type PropertyListPayload,
} from './property-row';

function row(overrides: Partial<PropertyListPayload> = {}): PropertyListPayload {
  return {
    id: 1,
    code: 'LOBA-001',
    titleEs: 'Lote con vista al mar',
    titleEn: null,
    propertyTypeId: 1,
    publicationStatus: 'draft',
    commercialStatus: 'available',
    isFeatured: false,
    priceMode: 'contact',
    priceAmountMinor: null,
    currencyCode: null,
    areaSquareMeters: null,
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-02-20T10:00:00.000Z',
    publishedAt: null,
    ...overrides,
  };
}

const TYPES = [
  { id: 1, systemKey: 'lot', names: { es: 'Lote', en: 'Lot' } },
  { id: 2, systemKey: 'house', names: { en: 'House' } },
];

/* -------------------------------------------------------------------------- */
/* Rutas                                                                      */
/* -------------------------------------------------------------------------- */

function readPage(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

describe('rutas del panel', () => {
  it('(1) /admin redirige a /admin/propiedades', () => {
    const source = readPage('src/pages/admin/index.astro');

    expect(source).toContain("Astro.redirect('/admin/propiedades'");
    // No se crea un dashboard vacio con metricas inventadas.
    expect(source).not.toContain('<h1');
  });

  it('(2) ambas rutas admin son on-demand', () => {
    for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/propiedades.astro']) {
      expect(readPage(page)).toContain('export const prerender = false');
    }
  });

  it('(3) el listado consume la API administrativa, no la base de datos', () => {
    const script = readFileSync(
      path.resolve(process.cwd(), 'src/lib/admin/ui/properties-page.ts'),
      'utf8',
    );

    expect(script).toContain('/api/admin/property-types');
    expect(buildApiUrl(EMPTY_FILTERS)).toBe('/api/admin/properties');

    // Ni SQL ni acceso directo a Drizzle desde la capa visual.
    expect(script).not.toContain('drizzle');
    expect(script).not.toContain('db/schema');
    expect(script).not.toContain('getDb');
  });

  it('la pagina del listado no expone el JWT de Access', () => {
    const script = readFileSync(
      path.resolve(process.cwd(), 'src/lib/admin/ui/properties-page.ts'),
      'utf8',
    );

    expect(script).not.toContain('Cf-Access-Jwt-Assertion');
    expect(script).not.toContain('localStorage');
    expect(script).not.toContain('sessionStorage');
    expect(script).not.toContain('document.cookie');
  });
});

/* -------------------------------------------------------------------------- */
/* Titulo                                                                     */
/* -------------------------------------------------------------------------- */

describe('titulo de la propiedad', () => {
  it('(4) prefiere el espanol', () => {
    const title = resolveTitle({ titleEs: 'Lote uno', titleEn: 'Lot one' });

    expect(title.text).toBe('Lote uno');
    expect(title.locale).toBe('es');
    expect(title.missingSpanish).toBe(false);
  });

  it('(5) cae al ingles marcando que falta el espanol', () => {
    const title = resolveTitle({ titleEs: null, titleEn: 'Sea view lot' });

    expect(title.text).toBe('Sea view lot');
    expect(title.locale).toBe('en');
    expect(title.missingSpanish).toBe(true);
  });

  it('(6) sin traducciones muestra "Sin título"', () => {
    const title = resolveTitle({ titleEs: null, titleEn: null });

    expect(title.text).toBe('Sin título');
    expect(title.locale).toBeNull();
  });

  it('un titulo en blanco cuenta como ausente', () => {
    expect(resolveTitle({ titleEs: '   ', titleEn: 'Lot one' }).locale).toBe('en');
    expect(resolveTitle({ titleEs: '', titleEn: '  ' }).text).toBe('Sin título');
  });
});

/* -------------------------------------------------------------------------- */
/* Etiquetas de estado                                                        */
/* -------------------------------------------------------------------------- */

describe('etiquetas de estado', () => {
  it('(7) traduce el estado editorial', () => {
    expect(publicationStatusLabel('draft')).toBe('Borrador');
    expect(publicationStatusLabel('in_review')).toBe('En revisión');
    expect(publicationStatusLabel('approved')).toBe('Aprobada');
    expect(publicationStatusLabel('published')).toBe('Publicada');
    expect(publicationStatusLabel('archived')).toBe('Archivada');
  });

  it('(8) traduce el estado comercial', () => {
    expect(commercialStatusLabel('available')).toBe('Disponible');
    expect(commercialStatusLabel('offer_received')).toBe('Con oferta');
    expect(commercialStatusLabel('reserved')).toBe('Reservada');
    expect(commercialStatusLabel('sold')).toBe('Vendida');
  });

  it('todos los estados tienen etiqueta y ninguna es el identificador interno', () => {
    for (const status of PUBLICATION_STATUSES) {
      expect(publicationStatusLabel(status)).not.toBe(status);
      expect(publicationStatusLabel(status).length).toBeGreaterThan(0);
    }
    for (const status of COMMERCIAL_STATUSES) {
      expect(commercialStatusLabel(status)).not.toBe(status);
    }
  });

  it('el contador concuerda en numero', () => {
    expect(propertyCountLabel(0)).toBe('0 propiedades');
    expect(propertyCountLabel(1)).toBe('1 propiedad');
    expect(propertyCountLabel(8)).toBe('8 propiedades');
  });
});

/* -------------------------------------------------------------------------- */
/* Precio                                                                     */
/* -------------------------------------------------------------------------- */

describe('precio', () => {
  it('(9) exact muestra importe y moneda', () => {
    const price = resolvePrice({
      priceMode: 'exact',
      priceAmountMinor: 12_500_000,
      currencyCode: 'USD',
    });

    expect(price.text).toContain('125.000,00');
    expect(price.note).toBeNull();
  });

  it('(10) negotiable anade la nota discreta', () => {
    const price = resolvePrice({
      priceMode: 'negotiable',
      priceAmountMinor: 12_500_000,
      currencyCode: 'USD',
    });

    expect(price.text).toContain('125.000,00');
    expect(price.note).toBe('Negociable');
  });

  it('(11) contact muestra "Consultar"', () => {
    const price = resolvePrice({
      priceMode: 'contact',
      priceAmountMinor: null,
      currencyCode: null,
    });

    expect(price.text).toBe('Consultar');
    expect(price.note).toBeNull();
  });

  it('contact con importe sigue mostrando "Consultar"', () => {
    const price = resolvePrice({
      priceMode: 'contact',
      priceAmountMinor: 100,
      currencyCode: 'USD',
    });
    expect(price.text).toBe('Consultar');
  });

  it('un precio incompleto no se muestra a medias', () => {
    expect(
      resolvePrice({ priceMode: 'exact', priceAmountMinor: null, currencyCode: 'USD' }).text,
    ).toBe('Consultar');
    expect(
      resolvePrice({ priceMode: 'exact', priceAmountMinor: 100, currencyCode: null }).text,
    ).toBe('Consultar');
  });

  it('formatea colones sin convertir moneda', () => {
    const price = resolvePrice({
      priceMode: 'exact',
      priceAmountMinor: 8_500_000_000,
      currencyCode: 'CRC',
    });

    expect(price.text).toContain('85.000.000,00');
  });
});

/* -------------------------------------------------------------------------- */
/* Superficie                                                                 */
/* -------------------------------------------------------------------------- */

describe('superficie', () => {
  it('(12) usa metrico con las reglas de la Fase 2A', () => {
    expect(resolveArea(800)).toBe('800 m²');
    expect(resolveArea(12_500)).toBe('1,25 ha');
  });

  it('sin superficie devuelve null', () => {
    expect(resolveArea(null)).toBeNull();
    expect(resolveArea(0)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Tipo y modelo completo                                                     */
/* -------------------------------------------------------------------------- */

describe('modelo de fila', () => {
  it('resuelve el nombre del tipo en espanol', () => {
    expect(resolveTypeName(1, TYPES)).toBe('Lote');
  });

  it('cae al ingles si no hay espanol', () => {
    expect(resolveTypeName(2, TYPES)).toBe('House');
  });

  it('devuelve null sin tipo o con un tipo desconocido', () => {
    expect(resolveTypeName(null, TYPES)).toBeNull();
    expect(resolveTypeName(99, TYPES)).toBeNull();
  });

  it('compone la fila completa', () => {
    const view = toPropertyRowView(
      row({
        publicationStatus: 'published',
        commercialStatus: 'reserved',
        priceMode: 'exact',
        priceAmountMinor: 12_500_000,
        currencyCode: 'USD',
        areaSquareMeters: 5000,
      }),
      TYPES,
    );

    expect(view.code).toBe('LOBA-001');
    expect(view.title.text).toBe('Lote con vista al mar');
    expect(view.typeName).toBe('Lote');
    expect(view.publicationLabel).toBe('Publicada');
    expect(view.commercialLabel).toBe('Reservada');
    // En espanol los numeros de cuatro digitos no llevan separador de millar.
    expect(view.area).toBe('5000 m²');
    expect(view.price.text).toContain('125.000,00');
    expect(view.updatedAt).toContain('2026');
  });

  it('tolera una fecha invalida sin romper', () => {
    expect(toPropertyRowView(row({ updatedAt: 'no-es-fecha' })).updatedAt).toBe('—');
  });
});

/* -------------------------------------------------------------------------- */
/* Filtros                                                                    */
/* -------------------------------------------------------------------------- */

describe('filtros', () => {
  it('(13) genera la consulta con un filtro', () => {
    expect(
      buildApiUrl({ publicationStatus: 'draft', commercialStatus: null, propertyTypeId: null }),
    ).toBe('/api/admin/properties?publicationStatus=draft');
  });

  it('(14) combina los tres filtros en orden estable', () => {
    const filters = {
      publicationStatus: 'published' as const,
      commercialStatus: 'reserved' as const,
      propertyTypeId: 3,
    };

    expect(filtersToQuery(filters)).toBe(
      'publicationStatus=published&commercialStatus=reserved&propertyTypeId=3',
    );
    expect(buildApiUrl(filters)).toBe(`/api/admin/properties?${filtersToQuery(filters)}`);
  });

  it('(15) sin filtros la URL queda limpia', () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toBe('');
    expect(buildApiUrl(EMPTY_FILTERS)).toBe('/api/admin/properties');
    expect(buildPageUrl(EMPTY_FILTERS)).toBe('/admin/propiedades');
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it('los filtros se reflejan en la URL del panel', () => {
    expect(
      buildPageUrl({ publicationStatus: 'draft', commercialStatus: null, propertyTypeId: null }),
    ).toBe('/admin/propiedades?publicationStatus=draft');
  });

  it('lee los filtros de la query string', () => {
    const filters = readFilters('?publicationStatus=draft&commercialStatus=sold&propertyTypeId=7');

    expect(filters.publicationStatus).toBe('draft');
    expect(filters.commercialStatus).toBe('sold');
    expect(filters.propertyTypeId).toBe(7);
    expect(hasActiveFilters(filters)).toBe(true);
  });

  it('ignora valores invalidos en la URL en vez de romper', () => {
    const filters = readFilters(
      '?publicationStatus=publicada&commercialStatus=vendida&propertyTypeId=abc',
    );

    expect(filters).toEqual(EMPTY_FILTERS);
  });

  it('ignora un propertyTypeId no positivo', () => {
    expect(readFilters('?propertyTypeId=0').propertyTypeId).toBeNull();
    expect(readFilters('?propertyTypeId=-3').propertyTypeId).toBeNull();
  });

  it('leer y escribir la query es reversible', () => {
    const query = 'publicationStatus=approved&commercialStatus=offer_received&propertyTypeId=2';
    expect(filtersToQuery(readFilters(`?${query}`))).toBe(query);
  });
});

/* -------------------------------------------------------------------------- */
/* Estados de la vista                                                        */
/* -------------------------------------------------------------------------- */

describe('estados del listado', () => {
  const base = { loading: false, errorStatus: null, count: 0, filters: EMPTY_FILTERS };

  it('muestra carga mientras no hay respuesta', () => {
    expect(resolveListState({ ...base, loading: true })).toBe('loading');
    expect(resolveListState({ ...base, count: null })).toBe('loading');
    expect(listStateMessage('loading')).toBe('Cargando propiedades…');
  });

  it('(16) base vacia', () => {
    expect(resolveListState(base)).toBe('empty');
    expect(listStateMessage('empty')).toBe('Todavía no hay propiedades.');
  });

  it('(17) filtros sin coincidencias se distinguen de la base vacia', () => {
    const state = resolveListState({
      ...base,
      filters: { publicationStatus: 'published', commercialStatus: null, propertyTypeId: null },
    });

    expect(state).toBe('no-matches');
    expect(listStateMessage(state)).toBe('No hay propiedades que coincidan con estos filtros.');
  });

  it('(18) un 403 tiene su propio mensaje y no ofrece reintentar', () => {
    const state = resolveListState({ ...base, errorStatus: 403 });

    expect(state).toBe('forbidden');
    expect(listStateMessage(state)).toBe('No tienes acceso al panel administrativo.');
    expect(canRetry(state)).toBe(false);
  });

  it('(19) un error general permite reintentar', () => {
    for (const status of [0, 500, 502]) {
      const state = resolveListState({ ...base, errorStatus: status });
      expect(state).toBe('error');
      expect(listStateMessage(state)).toBe('No pudimos cargar las propiedades.');
      expect(canRetry(state)).toBe(true);
    }
  });

  it('con resultados el estado es "ready" y no hay mensaje', () => {
    const state = resolveListState({ ...base, count: 3 });
    expect(state).toBe('ready');
    expect(listStateMessage(state)).toBeNull();
  });

  it('ningun mensaje de error filtra detalle interno', () => {
    for (const state of ['error', 'forbidden'] as const) {
      const message = listStateMessage(state) ?? '';
      expect(message).not.toMatch(/SQL|stack|json|undefined|null|500/i);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Accesibilidad del layout                                                   */
/* -------------------------------------------------------------------------- */

describe('layout administrativo', () => {
  const layout = readPage('src/layouts/AdminLayout.astro');
  const page = readPage('src/pages/admin/propiedades.astro');

  it('(20) el boton del menu movil es accesible', () => {
    expect(layout).toContain('aria-expanded="false"');
    expect(layout).toContain('aria-controls="admin-nav"');
    expect(layout).toContain("toggle.setAttribute('aria-expanded'");
    // Se puede cerrar con Escape.
    expect(layout).toContain("event.key === 'Escape'");
  });

  it('usa landmarks semanticos', () => {
    expect(layout).toContain('<nav');
    expect(layout).toContain('aria-label="Secciones del panel"');
    expect(layout).toContain('<main');
    expect(layout).toContain('<h1>');
  });

  it('el icono decorativo se oculta a lectores de pantalla', () => {
    expect(layout).toContain('aria-hidden="true"');
  });

  it('el panel no se indexa', () => {
    expect(layout).toContain('noindex');
  });

  it('la navegacion solo lista secciones que existen', () => {
    expect(layout).toContain('Propiedades');
    for (const inventada of ['Usuarios', 'Facturación', 'Dashboard', 'Analítica', 'Ajustes']) {
      expect(layout).not.toContain(inventada);
    }
  });

  it('no muestra identidad ni avatar inventados', () => {
    expect(layout).not.toContain('avatar');
    expect(layout.toLowerCase()).not.toContain('admin@');
  });

  it('los selects de filtro tienen label explicito', () => {
    for (const id of ['filter-publication', 'filter-commercial', 'filter-type']) {
      expect(page).toContain(`for="${id}"`);
      expect(page).toContain(`id="${id}"`);
    }
  });

  it('cada filtro ofrece la opcion Todos', () => {
    expect(page.match(/<option value="">Todos<\/option>/g)).toHaveLength(3);
  });

  it('no hay acciones de fila que lleven a pantallas inexistentes', () => {
    const script = readFileSync(
      path.resolve(process.cwd(), 'src/lib/admin/ui/properties-page.ts'),
      'utf8',
    );

    expect(script).not.toContain('Editar');
    expect(script).not.toContain('Nueva propiedad');
    expect(script).not.toContain('/admin/propiedades/');
  });
});
