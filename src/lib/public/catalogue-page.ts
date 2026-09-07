/**
 * Catalogo en el navegador.
 *
 * Mejora progresiva pura: el HTML ya trae TODAS las tarjetas prerenderizadas y
 * visibles. Este modulo solo aparece si hay JavaScript, y entonces enseña los
 * controles y se dedica a esconder y reordenar lo que ya esta.
 *
 * Sin JavaScript el catalogo se ve entero, que es un resultado perfectamente
 * util; con el, se puede filtrar. Nada se pide al servidor.
 *
 * Toda la logica de que entra y en que orden vive en `catalogue-filters.ts`;
 * aqui solo hay DOM.
 */

import {
  applyCatalogue,
  EMPTY_FILTERS,
  filtersFromQuery,
  hasActiveFilters,
  optionsOf,
  PAGE_SIZE,
  queryFromFilters,
  windowFor,
  type CatalogueEntry,
  type CatalogueFilters,
  type SortOption,
} from './catalogue-filters';

/*
 * Aserciones en vez del generico de `querySelector`: los tipos del runtime de
 * Workers definen su propio `Element` (el de HTMLRewriter) y chocan con el DOM.
 */
function byId<T extends object>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Lee un numero de un campo, tolerando coma decimal y vacio. */
function numberFrom(id: string): number | null {
  const raw = byId<HTMLInputElement>(id)?.value.trim().replace(',', '.') ?? '';
  if (raw.length === 0) return null;

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function textFrom(id: string): string | null {
  const raw = byId<HTMLSelectElement>(id)?.value ?? '';
  return raw.length === 0 ? null : raw;
}

/** Los datos de cada tarjeta viajan en el propio HTML, no en un JSON aparte. */
function readEntries(): { entry: CatalogueEntry; element: HTMLElement }[] {
  const cards = document.querySelectorAll('[data-catalogue-item]');

  return [...cards].map((node, index) => {
    const element = node as HTMLElement;
    const data = element.dataset;

    const number = (raw: string | undefined): number | null => {
      if (raw === undefined || raw.length === 0) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };

    return {
      element,
      entry: {
        slug: data.slug ?? String(index),
        propertyType: data.type === undefined || data.type.length === 0 ? null : data.type,
        area: data.zone === undefined || data.zone.length === 0 ? null : data.zone,
        priceMinor: number(data.price),
        currencyCode: data.currency ?? null,
        squareMeters: number(data.surface),
        position: index,
      },
    };
  });
}

export function initCataloguePage(): void {
  const root = byId<HTMLElement>('catalogue');
  if (root === null) return;

  const items = readEntries();
  if (items.length === 0) return;

  const list = byId<HTMLElement>('catalogue-list');
  const controls = byId<HTMLElement>('catalogue-controls');
  const count = byId<HTMLElement>('catalogue-count');
  const empty = byId<HTMLElement>('catalogue-empty');
  const more = byId<HTMLButtonElement>('catalogue-more');

  if (list === null || controls === null) return;

  const entries = items.map((item) => item.entry);
  const elementOf = new Map(items.map((item) => [item.entry.slug, item.element]));

  /*
   * Los controles llegan ocultos: sin JavaScript no harian nada, y un
   * formulario que no responde es peor que ninguno.
   */
  controls.hidden = false;

  let filters: CatalogueFilters = { ...EMPTY_FILTERS, ...filtersFromQuery(location.search) };
  let pages = 1;

  /* ---------------------------------------------------------------------- */
  /* Opciones                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Rellena un desplegable con los valores que existen de verdad.
   *
   * Se escribe el HTML entero en vez de crear nodos: los tipos del runtime de
   * Workers definen su propio `Element` y `append` no encaja con el del DOM.
   */
  const fillOptions = (id: string, values: string[], selected: string | null): void => {
    const select = byId<HTMLSelectElement>(id);
    if (select === null) return;

    // Se conserva la primera opcion ("Todas"), que viene del HTML.
    const anyLabel = select.options[0]?.textContent ?? '';

    const options = values
      .map(
        (value) =>
          `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`,
      )
      .join('');

    select.innerHTML = `<option value="">${escapeHtml(anyLabel)}</option>${options}`;
  };

  fillOptions('filter-type', optionsOf(entries, 'propertyType'), filters.type);
  fillOptions('filter-zone', optionsOf(entries, 'area'), filters.area);

  /** Vuelca los filtros a los controles, para que la URL mande al cargar. */
  const writeControls = (): void => {
    const price = byId<HTMLInputElement>('filter-price');
    const surface = byId<HTMLInputElement>('filter-surface');
    const sort = byId<HTMLSelectElement>('filter-sort');

    if (price !== null) price.value = filters.maxPrice === null ? '' : String(filters.maxPrice);
    if (surface !== null) surface.value = filters.minArea === null ? '' : String(filters.minArea);
    if (sort !== null) sort.value = filters.sort;
  };

  writeControls();

  /* ---------------------------------------------------------------------- */
  /* Pintado                                                                */
  /* ---------------------------------------------------------------------- */

  const render = (): void => {
    const visibleEntries = applyCatalogue(entries, filters);
    const view = windowFor(visibleEntries.length, pages, PAGE_SIZE);

    // Primero se esconde todo y despues se muestra en su nuevo orden.
    for (const item of items) item.element.hidden = true;

    visibleEntries.slice(0, view.visible).forEach((entry, index) => {
      const element = elementOf.get(entry.slug);
      if (element === undefined) return;

      element.hidden = false;
      // `order` reordena sin mover nodos: no se pierde el foco ni se recarga.
      element.style.order = String(index);
    });

    if (count !== null) {
      /*
       * El singular tiene su propia frase: "1 propiedades" es un descuido que
       * se ve en cuanto queda una sola tarjeta, y no se arregla con plantilla.
       */
      count.textContent =
        view.total === 1
          ? (count.dataset.templateOne ?? '')
          : (count.dataset.template?.replace('{n}', String(view.total)) ?? '');
    }

    if (empty !== null) empty.hidden = view.total > 0;
    if (list !== null) list.hidden = view.total === 0;

    if (more !== null) {
      more.hidden = !view.hasMore;
      more.textContent = `${more.dataset.label ?? ''} (${view.remaining})`;
    }

    const clear = byId<HTMLButtonElement>('catalogue-clear');
    if (clear !== null) clear.hidden = !hasActiveFilters(filters) && filters.sort === 'newest';
  };

  /**
   * Guarda el estado en la URL sin anadir entradas al historial.
   *
   * `replaceState` y no `pushState`: filtrar no es navegar, y llenar el
   * historial obligaria a pulsar Atras diez veces para salir del catalogo.
   */
  const syncUrl = (): void => {
    const query = queryFromFilters(filters);
    history.replaceState(null, '', `${location.pathname}${query}`);
  };

  const update = (): void => {
    // Cualquier cambio de filtro devuelve la lista al principio.
    pages = 1;
    render();
    syncUrl();
  };

  /* ---------------------------------------------------------------------- */
  /* Eventos                                                                */
  /* ---------------------------------------------------------------------- */

  const readControls = (): void => {
    filters = {
      type: textFrom('filter-type'),
      area: textFrom('filter-zone'),
      maxPrice: numberFrom('filter-price'),
      minArea: numberFrom('filter-surface'),
      sort: (textFrom('filter-sort') ?? 'newest') as SortOption,
    };
  };

  controls.addEventListener('change', () => {
    readControls();
    update();
  });

  // `input` para que escribir un precio filtre sin esperar a salir del campo.
  controls.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    readControls();
    update();
  });

  byId<HTMLButtonElement>('catalogue-clear')?.addEventListener('click', () => {
    filters = { ...EMPTY_FILTERS };
    writeControls();

    for (const id of ['filter-type', 'filter-zone']) {
      const select = byId<HTMLSelectElement>(id);
      if (select !== null) select.value = '';
    }

    update();
  });

  more?.addEventListener('click', () => {
    pages += 1;
    render();

    /*
     * El foco salta a la primera tarjeta nueva: quien navega con teclado se
     * queda donde acaba de aparecer el contenido, no al final de la pagina.
     */
    const shown = applyCatalogue(entries, filters);
    const first = shown[(pages - 1) * PAGE_SIZE];
    if (first === undefined) return;

    const element = elementOf.get(first.slug);
    element?.querySelector('a')?.focus();
  });

  render();
}
