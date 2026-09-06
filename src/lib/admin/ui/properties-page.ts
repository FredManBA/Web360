/**
 * Comportamiento de `/admin/propiedades` en el navegador.
 *
 * Responsabilidades acotadas: cargar el listado desde la API administrativa,
 * aplicar filtros, reflejarlos en la URL, reintentar y pintar. Sin estado
 * global, sin store y sin router de cliente.
 *
 * Los datos SIEMPRE llegan por la API same-origin, nunca leyendo D1 desde
 * aqui: la capa HTTP es la que aplica la autorizacion.
 */

import {
  ALL_OPTION,
  buildApiUrl,
  buildPageUrl,
  readFilters,
  type PropertyFilters,
} from './filters';
import { createPropertyCreator, editorPath } from './create-property';
import { propertyCountLabel } from './labels';
import { canRetry, listStateMessage, resolveListState, type ListState } from './list-state';
import {
  toPropertyRowView,
  type PropertyListPayload,
  type PropertyRowView,
  type PropertyTypePayload,
} from './property-row';

interface PageState {
  loading: boolean;
  errorStatus: number | null;
  rows: PropertyRowView[] | null;
  filters: PropertyFilters;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(kind: string, status: string, label: string): string {
  return `<span class="admin-badge admin-badge-${status}" data-kind="${kind}">${escapeHtml(label)}</span>`;
}

function renderRow(row: PropertyRowView): string {
  const titleClass = row.title.locale === null ? 'admin-title admin-title-missing' : 'admin-title';
  const langNote =
    row.title.locale === 'en'
      ? ' <span class="admin-lang-note" title="Falta el título en español">Falta ES</span>'
      : '';

  const price = `${escapeHtml(row.price.text)}${
    row.price.note === null
      ? ''
      : `<span class="admin-price-note">${escapeHtml(row.price.note)}</span>`
  }`;

  /*
   * El enlace va en el codigo y el titulo, no en la fila entera: asi es
   * navegable con teclado y no hace falta `onclick` sobre un `<tr>`.
   */
  const href = editorPath(row.id);

  return `
    <tr>
      <td data-label="Código">
        <a class="admin-code admin-row-link" href="${href}">${escapeHtml(row.code)}</a>
      </td>
      <td data-label="Título">
        <a class="admin-row-link" href="${href}">
          <span class="${titleClass}">${escapeHtml(row.title.text)}</span>
        </a>${langNote}
      </td>
      <td data-label="Tipo">${
        row.typeName === null
          ? '<span class="admin-muted">Sin tipo</span>'
          : escapeHtml(row.typeName)
      }</td>
      <td data-label="Publicación">${badge('publication', row.publicationStatus, row.publicationLabel)}</td>
      <td data-label="Comercial">${badge('commercial', row.commercialStatus, row.commercialLabel)}</td>
      <td data-label="Superficie">${
        row.area === null ? '<span class="admin-muted">—</span>' : escapeHtml(row.area)
      }</td>
      <td data-label="Precio">${price}</td>
      <td data-label="Actualizada">${escapeHtml(row.updatedAt)}</td>
    </tr>`;
}

function renderState(state: ListState, hasFilters: boolean): string {
  const message = listStateMessage(state) ?? '';
  const isError = state === 'error' || state === 'forbidden';

  const actions: string[] = [];
  if (canRetry(state)) {
    actions.push(
      '<button type="button" class="admin-button" data-action="retry">Reintentar</button>',
    );
  }
  if (state === 'no-matches' && hasFilters) {
    actions.push(
      '<button type="button" class="admin-button" data-action="clear">Limpiar filtros</button>',
    );
  }

  return `
    <div class="admin-state${isError ? ' admin-state-error' : ''}">
      <p>${escapeHtml(message)}</p>
      ${actions.join('\n')}
    </div>`;
}

export function initPropertiesPage(): void {
  /*
   * Se usa asercion en lugar del generico de `querySelector`: los tipos del
   * runtime de Workers definen su propio `Element` (el de HTMLRewriter), que
   * choca con el del DOM y hace que el parametro generico no compile.
   */
  const results = document.querySelector('#admin-results') as HTMLElement | null;
  const count = document.querySelector('#admin-count') as HTMLElement | null;
  const form = document.querySelector('#admin-filters') as HTMLFormElement | null;
  const typeSelect = document.querySelector('#filter-type') as HTMLSelectElement | null;
  const createButton = document.querySelector('#admin-create') as HTMLButtonElement | null;
  const createError = document.querySelector('#admin-create-error') as HTMLElement | null;

  if (results === null || form === null) return;

  let types: PropertyTypePayload[] = [];

  const state: PageState = {
    loading: true,
    errorStatus: null,
    rows: null,
    filters: readFilters(window.location.search),
  };

  const syncFormFromFilters = (): void => {
    const publication = form.elements.namedItem('publicationStatus');
    const commercial = form.elements.namedItem('commercialStatus');

    if (publication instanceof HTMLSelectElement) {
      publication.value = state.filters.publicationStatus ?? ALL_OPTION;
    }
    if (commercial instanceof HTMLSelectElement) {
      commercial.value = state.filters.commercialStatus ?? ALL_OPTION;
    }
    if (typeSelect !== null) {
      typeSelect.value =
        state.filters.propertyTypeId === null ? ALL_OPTION : String(state.filters.propertyTypeId);
    }
  };

  const render = (): void => {
    const listState = resolveListState({
      loading: state.loading,
      errorStatus: state.errorStatus,
      count: state.rows === null ? null : state.rows.length,
      filters: state.filters,
    });

    if (count !== null) {
      count.textContent =
        listState === 'ready' && state.rows !== null ? propertyCountLabel(state.rows.length) : '';
    }

    if (listState !== 'ready' || state.rows === null) {
      results.innerHTML = renderState(
        listState,
        state.filters.publicationStatus !== null ||
          state.filters.commercialStatus !== null ||
          state.filters.propertyTypeId !== null,
      );
      return;
    }

    results.innerHTML = `
      <table class="admin-table">
        <caption>Propiedades del catálogo, de la más reciente a la más antigua.</caption>
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Título</th>
            <th scope="col">Tipo</th>
            <th scope="col">Publicación</th>
            <th scope="col">Comercial</th>
            <th scope="col">Superficie</th>
            <th scope="col">Precio</th>
            <th scope="col">Actualizada</th>
          </tr>
        </thead>
        <tbody>${state.rows.map(renderRow).join('')}</tbody>
      </table>`;
  };

  const loadTypes = async (): Promise<void> => {
    try {
      const response = await fetch('/api/admin/property-types', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return;

      const body = (await response.json()) as { data?: PropertyTypePayload[] };
      types = body.data ?? [];

      if (typeSelect !== null) {
        /*
         * Se reescriben las opciones de una vez, conservando "Todos". Se evita
         * `append` porque los tipos del runtime de Workers definen el suyo
         * (el de HTMLRewriter) y choca con el del DOM.
         */
        const options = types.map((type) => {
          const label = type.names.es ?? type.names.en ?? `Tipo ${type.id}`;
          return `<option value="${type.id}">${escapeHtml(label)}</option>`;
        });

        typeSelect.innerHTML = `<option value="">Todos</option>${options.join('')}`;
        syncFormFromFilters();
      }
    } catch {
      // Sin tipos, el listado sigue siendo utilizable: se muestra "Sin tipo".
    }
  };

  const load = async (): Promise<void> => {
    state.loading = true;
    state.errorStatus = null;
    render();

    try {
      const response = await fetch(buildApiUrl(state.filters), {
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        state.errorStatus = response.status;
        state.rows = null;
        return;
      }

      const body = (await response.json()) as { data?: PropertyListPayload[] };
      state.rows = (body.data ?? []).map((row) => toPropertyRowView(row, types));
    } catch {
      // Fallo de red: se trata como error general, sin exponer el detalle.
      state.errorStatus = 0;
      state.rows = null;
    } finally {
      state.loading = false;
      render();
    }
  };

  const applyFilters = (next: PropertyFilters): void => {
    state.filters = next;
    // Los filtros quedan en la URL sin recargar la pagina.
    window.history.replaceState(null, '', buildPageUrl(next));
    syncFormFromFilters();
    void load();
  };

  form.addEventListener('change', () => {
    const data = new FormData(form);
    const raw = new URLSearchParams();

    for (const key of ['publicationStatus', 'commercialStatus', 'propertyTypeId']) {
      const value = data.get(key);
      if (typeof value === 'string' && value !== ALL_OPTION) raw.set(key, value);
    }

    applyFilters(readFilters(raw.toString()));
  });

  form.addEventListener('submit', (event) => event.preventDefault());

  results.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    if (action === 'retry') void load();
    if (action === 'clear') {
      applyFilters({ publicationStatus: null, commercialStatus: null, propertyTypeId: null });
    }
  });

  /*
   * Nueva propiedad: se crea el borrador vacio por la API y se entra al
   * editor. El creador ignora las llamadas mientras hay una en vuelo, de modo
   * que un doble clic no genera dos propiedades.
   */
  if (createButton !== null) {
    const creator = createPropertyCreator();

    createButton.addEventListener('click', () => {
      void (async () => {
        if (createError !== null) {
          createError.hidden = true;
          createError.textContent = '';
        }

        createButton.disabled = true;
        const previousLabel = createButton.textContent;
        createButton.textContent = 'Creando…';

        const result = await creator.create();

        if (result === null) return;

        if (result.ok) {
          window.location.href = editorPath(result.id);
          return;
        }

        if (createError !== null) {
          createError.textContent = result.message;
          createError.hidden = false;
        }

        createButton.disabled = false;
        createButton.textContent = previousLabel;
      })();
    });
  }

  syncFormFromFilters();
  void loadTypes().then(load);
}
