/**
 * Seccion de caracteristicas del editor.
 *
 * Solo cableado de DOM: el estado vive en `feature-editor-state.ts` y las
 * llamadas en `feature-api.ts`. Nunca toca D1 y no duplica reglas de dominio.
 *
 * En esta subfase cada grupo y cada caracteristica tienen su propio boton de
 * guardar, deliberadamente fuera del coordinador global. La Fase 3C-3 podra
 * conectarlos sin rehacer esta UI, porque cada entidad ya expone su estado y
 * su parche.
 */

import { createFeatureApi, type FeatureApi } from './feature-api';
import {
  addFeature,
  addGroup,
  featurePatch,
  featuresOfGroup,
  groupDisplayName,
  groupPatch,
  hasPendingFeatureWork,
  isEmpty,
  isFeatureDirty,
  isGroupDirty,
  markFeatureSaved,
  markGroupSaved,
  removeFeature,
  removeGroup,
  stateFromApi,
  ungroupedFeatures,
  type EntityState,
  type FeatureEditorState,
  type FeatureEntry,
  type GroupEntry,
  type GroupNameView,
} from './feature-editor-state';
import { saveStateLabel } from './editor-state';

/** Texto exacto de la confirmacion: explica que las caracteristicas se quedan. */
export const CONFIRM_DELETE_GROUP =
  'Se eliminará el grupo. Las características del grupo no se eliminarán; pasarán a "Sin grupo".';

export const CONFIRM_DELETE_FEATURE =
  'Se eliminará esta característica. Esta acción no se puede deshacer.';

export const LOADING_TEXT = 'Cargando características…';
export const EMPTY_TEXT = 'Aún no hay características.';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/*
 * Aserciones en vez del generico de `querySelector`: los tipos del runtime de
 * Workers definen su propio `Element` (el de HTMLRewriter) y chocan con el DOM.
 */
function byId<T extends object>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Nombre del grupo con la nota discreta cuando falta el espanol. */
function headingMarkup(name: GroupNameView): string {
  const note = name.missingSpanish
    ? ' <span class="admin-lang-note" title="Falta el nombre en español">Falta ES</span>'
    : '';
  return `${escapeHtml(name.text)}${note}`;
}

export interface FeatureEditorHandle {
  /** Lo consulta el editor para el aviso de salida. */
  hasPendingWork: () => boolean;
}

export function initFeatureEditor(
  propertyId: number,
  api: FeatureApi = createFeatureApi(propertyId),
): FeatureEditorHandle {
  const root = byId<HTMLElement>('admin-features');
  if (root === null) return { hasPendingWork: () => false };

  let state: FeatureEditorState = { groups: [], features: [] };
  /** Fallo de carga: sustituye a la seccion entera, sin tocar el resto. */
  let loadError: string | null = null;
  /** Fallo de una accion suelta (crear, borrar): se muestra sobre la lista. */
  let sectionError: string | null = null;

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */

  const statusMarkup = (entryState: EntityState, error: string | null): string => {
    const label = error ?? saveStateLabel(entryState);
    return `<p class="editor-save-status feature-status" data-state="${entryState}">${escapeHtml(label)}</p>`;
  };

  /** El select no muestra ids: solo "Sin grupo" y los nombres visibles. */
  const groupOptions = (selected: number | null): string => {
    const options = state.groups.map((group) => {
      const name = groupDisplayName(group.draft).text;
      const isSelected = selected === group.id ? ' selected' : '';
      return `<option value="${group.id}"${isSelected}>${escapeHtml(name)}</option>`;
    });

    const noneSelected = selected === null ? ' selected' : '';
    return `<option value=""${noneSelected}>Sin grupo</option>${options.join('')}`;
  };

  const featureMarkup = (feature: FeatureEntry): string => {
    const id = feature.id;
    const invalid = feature.state === 'error' ? 'true' : 'false';
    const status = statusMarkup(feature.state, feature.error);

    return `
      <article class="feature-card" data-feature="${id}">
        <div class="feature-grid">
          <div class="admin-field">
            <label for="feature-${id}-label-es">Etiqueta en español</label>
            <input type="text" id="feature-${id}-label-es" data-field="labelEs"
              aria-invalid="${invalid}" value="${escapeHtml(feature.draft.labelEs)}" />
          </div>
          <div class="admin-field">
            <label for="feature-${id}-value-es">Valor en español</label>
            <input type="text" id="feature-${id}-value-es" data-field="valueEs"
              aria-invalid="${invalid}" value="${escapeHtml(feature.draft.valueEs)}" />
          </div>
          <div class="admin-field">
            <label for="feature-${id}-label-en">Label in English</label>
            <input type="text" id="feature-${id}-label-en" data-field="labelEn"
              aria-invalid="${invalid}" value="${escapeHtml(feature.draft.labelEn)}" />
          </div>
          <div class="admin-field">
            <label for="feature-${id}-value-en">Value in English</label>
            <input type="text" id="feature-${id}-value-en" data-field="valueEn"
              aria-invalid="${invalid}" value="${escapeHtml(feature.draft.valueEn)}" />
          </div>
          <div class="admin-field">
            <label for="feature-${id}-group">Grupo</label>
            <select id="feature-${id}-group" data-field="groupId">
              ${groupOptions(feature.draft.groupId)}
            </select>
          </div>
        </div>

        <div class="feature-actions">
          <button type="button" class="admin-button" data-action="save-feature">
            Guardar característica
          </button>
          <button type="button" class="admin-button admin-button-quiet" data-action="delete-feature">
            Eliminar característica
          </button>
          <div class="feature-status-box" id="feature-${id}-status" role="status">${status}</div>
        </div>
      </article>`;
  };

  const groupMarkup = (group: GroupEntry): string => {
    const id = group.id;
    const invalid = group.state === 'error' ? 'true' : 'false';
    const status = statusMarkup(group.state, group.error);

    return `
      <section class="feature-group" data-group="${id}" aria-labelledby="group-${id}-heading">
        <h3 class="feature-group-title" id="group-${id}-heading">${headingMarkup(
          groupDisplayName(group.draft),
        )}</h3>

        <div class="feature-grid">
          <div class="admin-field">
            <label for="group-${id}-name-es">Nombre del grupo en español</label>
            <input type="text" id="group-${id}-name-es" data-field="nameEs"
              aria-invalid="${invalid}" value="${escapeHtml(group.draft.nameEs)}" />
          </div>
          <div class="admin-field">
            <label for="group-${id}-name-en">Group name in English</label>
            <input type="text" id="group-${id}-name-en" data-field="nameEn"
              aria-invalid="${invalid}" value="${escapeHtml(group.draft.nameEn)}" />
          </div>
        </div>

        <div class="feature-actions">
          <button type="button" class="admin-button" data-action="save-group">Guardar grupo</button>
          <button type="button" class="admin-button" data-action="add-feature">
            Añadir característica
          </button>
          <button type="button" class="admin-button admin-button-quiet" data-action="delete-group">
            Eliminar grupo
          </button>
          <div class="feature-status-box" id="group-${id}-status" role="status">${status}</div>
        </div>

        <div class="feature-list">${featuresOfGroup(state, id).map(featureMarkup).join('')}</div>
      </section>`;
  };

  const render = (): void => {
    if (loadError !== null) {
      root.innerHTML = `
        <div class="admin-state admin-state-error">
          <p>${escapeHtml(loadError)}</p>
          <button type="button" class="admin-button" data-action="retry-features">Reintentar</button>
        </div>`;
      return;
    }

    const loose = ungroupedFeatures(state);

    // "Sin grupo" solo se dibuja cuando hay algo suelto que mostrar.
    const ungroupedSection =
      loose.length === 0
        ? ''
        : `
      <section class="feature-group feature-group-loose" aria-labelledby="ungrouped-heading">
        <h3 class="feature-group-title" id="ungrouped-heading">Sin grupo</h3>
        <div class="feature-list">${loose.map(featureMarkup).join('')}</div>
      </section>`;

    const emptyMarkup = isEmpty(state)
      ? `<p class="admin-muted" id="features-empty">${EMPTY_TEXT}</p>`
      : '';

    const errorMarkup =
      sectionError === null
        ? ''
        : `<p class="editor-error" id="features-error" role="alert">${escapeHtml(sectionError)}</p>`;

    root.innerHTML = `
      ${errorMarkup}
      ${emptyMarkup}
      ${state.groups.map(groupMarkup).join('')}
      ${ungroupedSection}
      <div class="feature-toolbar">
        <button type="button" class="admin-button" data-action="add-group">Añadir grupo</button>
        <button type="button" class="admin-button" data-action="add-loose-feature">
          Añadir característica sin grupo
        </button>
      </div>`;
  };

  /* ---------------------------------------------------------------------- */
  /* Utilidades                                                             */
  /* ---------------------------------------------------------------------- */

  const closestId = (element: HTMLElement, attribute: 'group' | 'feature'): number | null => {
    const host = element.closest(`[data-${attribute}]`);
    if (host === null) return null;

    const value = Number((host as HTMLElement).dataset[attribute]);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };

  const groupById = (id: number): GroupEntry | undefined =>
    state.groups.find((group) => group.id === id);

  const featureById = (id: number): FeatureEntry | undefined =>
    state.features.find((feature) => feature.id === id);

  const focusField = (id: string): void => {
    byId<HTMLElement & { focus: () => void }>(id)?.focus();
  };

  /** Refresca el estado de una entidad sin repintar, para no perder el foco. */
  const paintStatus = (
    containerId: string,
    entryState: EntityState,
    error: string | null,
  ): void => {
    const box = byId<HTMLElement>(containerId);
    if (box !== null) box.innerHTML = statusMarkup(entryState, error);
  };

  /* ---------------------------------------------------------------------- */
  /* Acciones                                                               */
  /* ---------------------------------------------------------------------- */

  const load = async (): Promise<void> => {
    root.innerHTML = `<p class="admin-muted">${LOADING_TEXT}</p>`;

    const result = await api.load();

    if (!result.ok) {
      // El fallo se queda dentro de la seccion: el resto del editor sigue vivo.
      loadError = result.message;
      render();
      return;
    }

    loadError = null;
    sectionError = null;
    state = stateFromApi(result.data);
    render();
  };

  const createGroup = async (button: HTMLButtonElement): Promise<void> => {
    button.disabled = true;
    const result = await api.createGroup();
    button.disabled = false;

    // `null` significa que ya habia una creacion en vuelo: no se duplica.
    if (result === null) return;

    if (!result.ok) {
      sectionError = result.message;
      render();
      return;
    }

    sectionError = null;
    const entry = addGroup(state, result.data);
    render();
    focusField(`group-${entry.id}-name-es`);
  };

  const createFeature = async (
    button: HTMLButtonElement,
    groupId: number | null,
  ): Promise<void> => {
    button.disabled = true;
    const result = await api.createFeature(groupId);
    button.disabled = false;

    if (result === null) return;

    if (!result.ok) {
      sectionError = result.message;
      render();
      return;
    }

    sectionError = null;
    const entry = addFeature(state, result.data);
    render();
    focusField(`feature-${entry.id}-label-es`);
  };

  const saveGroup = async (entry: GroupEntry): Promise<void> => {
    entry.state = 'saving';
    entry.error = null;
    paintStatus(`group-${entry.id}-status`, entry.state, entry.error);

    const result = await api.updateGroup(entry.id, groupPatch(entry));

    if (result.ok) {
      markGroupSaved(entry);
    } else {
      // Lo escrito se conserva: solo cambia el estado.
      entry.state = 'error';
      entry.error = result.message;
    }

    render();
  };

  const saveFeature = async (entry: FeatureEntry): Promise<void> => {
    entry.state = 'saving';
    entry.error = null;
    paintStatus(`feature-${entry.id}-status`, entry.state, entry.error);

    const result = await api.updateFeature(entry.id, featurePatch(entry));

    if (result.ok) {
      // El cambio de grupo se consolida solo cuando el PATCH sale bien.
      markFeatureSaved(entry);
    } else {
      entry.state = 'error';
      entry.error = result.message;
    }

    render();
  };

  const deleteGroup = async (entry: GroupEntry): Promise<void> => {
    if (!window.confirm(CONFIRM_DELETE_GROUP)) return;

    const result = await api.deleteGroup(entry.id);

    if (result.ok) {
      // Sus caracteristicas pasan a "Sin grupo"; no se borran.
      removeGroup(state, entry.id);
      sectionError = null;
    } else {
      entry.state = 'error';
      entry.error = result.message;
    }

    render();
  };

  const deleteFeature = async (entry: FeatureEntry): Promise<void> => {
    if (!window.confirm(CONFIRM_DELETE_FEATURE)) return;

    const result = await api.deleteFeature(entry.id);

    if (result.ok) {
      removeFeature(state, entry.id);
      sectionError = null;
    } else {
      // Si falla, la caracteristica sigue donde estaba.
      entry.state = 'error';
      entry.error = result.message;
    }

    render();
  };

  /* ---------------------------------------------------------------------- */
  /* Eventos                                                                */
  /* ---------------------------------------------------------------------- */

  const onEdit = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const field = target.dataset.field;
    if (field === undefined) return;

    const value = (target as HTMLInputElement | HTMLSelectElement).value;
    const featureId = closestId(target, 'feature');

    if (featureId !== null) {
      const entry = featureById(featureId);
      if (entry === undefined) return;

      if (field === 'groupId') {
        // Solo cambia el borrador: la tarjeta no se mueve hasta guardar.
        entry.draft.groupId = value === '' ? null : Number(value);
      } else if (field in entry.draft) {
        (entry.draft as unknown as Record<string, string>)[field] = value;
      }

      entry.state = isFeatureDirty(entry) ? 'dirty' : 'saved';
      entry.error = null;
      paintStatus(`feature-${entry.id}-status`, entry.state, entry.error);
      return;
    }

    const groupId = closestId(target, 'group');
    if (groupId === null) return;

    const entry = groupById(groupId);
    if (entry === undefined) return;

    if (field in entry.draft) {
      (entry.draft as unknown as Record<string, string>)[field] = value;
    }

    entry.state = isGroupDirty(entry) ? 'dirty' : 'saved';
    entry.error = null;
    paintStatus(`group-${entry.id}-status`, entry.state, entry.error);

    // El titulo del grupo sigue lo escrito, sin esperar al guardado.
    const heading = byId<HTMLElement>(`group-${entry.id}-heading`);
    if (heading !== null) heading.innerHTML = headingMarkup(groupDisplayName(entry.draft));
  };

  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    if (action === undefined) return;

    const button = target as HTMLButtonElement;
    const featureId = closestId(target, 'feature');
    const groupId = closestId(target, 'group');

    switch (action) {
      case 'retry-features':
        void load();
        break;

      case 'add-group':
        void createGroup(button);
        break;

      case 'add-loose-feature':
        void createFeature(button, null);
        break;

      case 'add-feature':
        if (groupId !== null) void createFeature(button, groupId);
        break;

      case 'save-group': {
        const entry = groupId === null ? undefined : groupById(groupId);
        if (entry !== undefined) void saveGroup(entry);
        break;
      }

      case 'delete-group': {
        const entry = groupId === null ? undefined : groupById(groupId);
        if (entry !== undefined) void deleteGroup(entry);
        break;
      }

      case 'save-feature': {
        const entry = featureId === null ? undefined : featureById(featureId);
        if (entry !== undefined) void saveFeature(entry);
        break;
      }

      case 'delete-feature': {
        const entry = featureId === null ? undefined : featureById(featureId);
        if (entry !== undefined) void deleteFeature(entry);
        break;
      }

      default:
        break;
    }
  });

  void load();

  return { hasPendingWork: () => hasPendingFeatureWork(state) };
}
