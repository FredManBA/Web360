/**
 * Seccion de caracteristicas del editor.
 *
 * Solo cableado de DOM: el estado vive en `feature-editor-state.ts` y las
 * llamadas en `feature-api.ts`. Nunca toca D1 y no duplica reglas de dominio.
 *
 * Desde la Fase 3C-3 cada grupo y cada caracteristica son un puerto mas del
 * coordinador de guardado. Ya no hay botones de guardar por entidad: escribir
 * dispara el autosave y `Guardar cambios` fuerza la misma ronda. Lo unico que
 * queda fuera del debounce son crear, eliminar y reordenar, que son acciones
 * explicitas e inmediatas.
 */

import { createFeatureApi, type FeatureApi } from './feature-api';
import {
  addFeature,
  addGroup,
  applyFeatureOrder,
  applyGroupOrder,
  featurePatch,
  featuresOfGroup,
  groupDisplayName,
  groupOrder,
  groupPatch,
  isEmpty,
  isFeatureDirty,
  isGroupDirty,
  markFeatureSaved,
  markGroupSaved,
  moveAvailability,
  moveFeature,
  moveGroup,
  removeFeature,
  removeGroup,
  stateFromApi,
  TOO_LONG_MESSAGE,
  ungroupedFeatures,
  validateFeatureDraft,
  validateGroupDraft,
  type EntityState,
  type FeatureDraft,
  type FeatureEditorState,
  type FeatureEntry,
  type GroupDraft,
  type GroupEntry,
  type GroupNameView,
  type MoveDirection,
} from './feature-editor-state';
import { saveStateLabel } from './editor-state';
import {
  featurePortKey,
  groupPortKey,
  type PersistResult,
  type SaveCoordinator,
} from './save-coordinator';

const CONFIRM_DELETE_GROUP_BASE =
  'Se eliminará el grupo. Las características del grupo no se eliminarán; pasarán a "Sin grupo".';

const CONFIRM_DELETE_FEATURE_BASE =
  'Se eliminará esta característica. Esta acción no se puede deshacer.';

/** Aviso extra cuando la entidad tiene cambios que aun no se han guardado. */
const UNSAVED_WARNING = 'Tiene cambios sin guardar que se perderán.';

export const LOADING_TEXT = 'Cargando características…';
export const EMPTY_TEXT = 'Aún no hay características.';

/** El texto del aviso depende de si hay algo que perder. */
export function deleteGroupMessage(dirty: boolean): string {
  return dirty ? `${CONFIRM_DELETE_GROUP_BASE} ${UNSAVED_WARNING}` : CONFIRM_DELETE_GROUP_BASE;
}

export function deleteFeatureMessage(dirty: boolean): string {
  return dirty ? `${CONFIRM_DELETE_FEATURE_BASE} ${UNSAVED_WARNING}` : CONFIRM_DELETE_FEATURE_BASE;
}

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
  /** Da de baja todos los puertos. Util al descartar la seccion. */
  dispose: () => void;
}

export function initFeatureEditor(
  propertyId: number,
  coordinator: SaveCoordinator,
  api: FeatureApi = createFeatureApi(propertyId),
): FeatureEditorHandle {
  const root = byId<HTMLElement>('admin-features');
  if (root === null) return { dispose: () => undefined };

  let state: FeatureEditorState = { groups: [], features: [] };
  /** Fallo de carga: sustituye a la seccion entera, sin tocar el resto. */
  let loadError: string | null = null;
  /** Fallo de una accion suelta (crear, borrar, reordenar). */
  let sectionError: string | null = null;
  /** Ambitos con una reordenacion en vuelo: sus botones quedan inertes. */
  const reordering = new Set<string>();
  /** Que boton recuperar el foco tras el proximo repintado. */
  let focusAfterRender: string | null = null;

  const GROUPS_SCOPE = 'groups';
  const featureScopeKey = (groupId: number | null): string =>
    groupId === null ? 'features:none' : `features:${groupId}`;

  /* ---------------------------------------------------------------------- */
  /* Puertos del coordinador                                                */
  /* ---------------------------------------------------------------------- */

  const groupById = (id: number): GroupEntry | undefined =>
    state.groups.find((group) => group.id === id);

  const featureById = (id: number): FeatureEntry | undefined =>
    state.features.find((feature) => feature.id === id);

  /**
   * Puerto de un grupo.
   *
   * La instantanea se toma al empezar a escribir, y es esa la que se marca
   * como persistida: lo que el usuario teclee durante la peticion sigue
   * pendiente.
   */
  const registerGroupPort = (groupId: number): void => {
    coordinator.register(groupPortKey(groupId), {
      isDirty: () => {
        const entry = groupById(groupId);
        return entry !== undefined && isGroupDirty(entry);
      },

      validate: () => {
        const entry = groupById(groupId);
        if (entry === undefined) return [];

        return validateGroupDraft(entry.draft).map((field) => {
          entry.state = 'error';
          entry.error = TOO_LONG_MESSAGE;
          return { field: `group:${groupId}.${field}`, message: TOO_LONG_MESSAGE };
        });
      },

      persist: async (): Promise<PersistResult> => {
        const entry = groupById(groupId);
        if (entry === undefined) return { ok: true };

        const snapshot: GroupDraft = { ...entry.draft };

        entry.state = 'saving';
        entry.error = null;
        paintStatus(`group-${groupId}-status`, entry.state, entry.error);

        const result = await api.updateGroup(groupId, groupPatch(entry));

        // Pudo eliminarse mientras se guardaba.
        const current = groupById(groupId);
        if (current === undefined) return { ok: true };

        if (result.ok) {
          markGroupSaved(current, snapshot);
        } else {
          // El draft se conserva; solo cambia el estado.
          current.state = 'error';
          current.error = result.message;
        }

        render();

        /*
         * El mensaje ya se ve en la tarjeta, asi que no se devuelve al
         * coordinador: repetirlo arriba solo lo alejaria de su entidad.
         */
        return result.ok ? { ok: true } : { ok: false };
      },
    });
  };

  const registerFeaturePort = (featureId: number): void => {
    coordinator.register(featurePortKey(featureId), {
      isDirty: () => {
        const entry = featureById(featureId);
        return entry !== undefined && isFeatureDirty(entry);
      },

      validate: () => {
        const entry = featureById(featureId);
        if (entry === undefined) return [];

        return validateFeatureDraft(entry.draft).map((field) => {
          entry.state = 'error';
          entry.error = TOO_LONG_MESSAGE;
          return { field: `feature:${featureId}.${field}`, message: TOO_LONG_MESSAGE };
        });
      },

      persist: async (): Promise<PersistResult> => {
        const entry = featureById(featureId);
        if (entry === undefined) return { ok: true };

        const snapshot: FeatureDraft = { ...entry.draft };

        entry.state = 'saving';
        entry.error = null;
        paintStatus(`feature-${featureId}-status`, entry.state, entry.error);

        const result = await api.updateFeature(featureId, featurePatch(entry));

        const current = featureById(featureId);
        if (current === undefined) return { ok: true };

        if (result.ok) {
          // La tarjeta cambia de grupo AHORA, no antes: y con el orden que diga
          // el servidor.
          markFeatureSaved(current, snapshot, result.data.sortOrder);
        } else {
          current.state = 'error';
          current.error = result.message;
        }

        render();

        return result.ok ? { ok: true } : { ok: false };
      },
    });
  };

  const registerAll = (): void => {
    for (const group of state.groups) registerGroupPort(group.id);
    for (const feature of state.features) registerFeaturePort(feature.id);
  };

  const unregisterAll = (): void => {
    for (const group of state.groups) coordinator.unregister(groupPortKey(group.id));
    for (const feature of state.features) coordinator.unregister(featurePortKey(feature.id));
  };

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

  /**
   * Botones de orden.
   *
   * El nombre accesible dice QUE se mueve, no solo la direccion: "Subir" a
   * secas se repite decenas de veces en la pagina y no distingue nada.
   */
  const moveButtons = (
    kind: 'group' | 'feature',
    id: number,
    label: string,
    ids: readonly number[],
    scope: string,
  ): string => {
    const { canMoveUp, canMoveDown } = moveAvailability(ids, id);
    const busy = reordering.has(scope);

    const button = (direction: MoveDirection, text: string, enabled: boolean): string =>
      `<button type="button" class="admin-button admin-button-move"
        id="move-${kind}-${id}-${direction}"
        data-action="move-${kind}" data-direction="${direction}"
        aria-label="${escapeHtml(`${text} ${label}`)}"${enabled && !busy ? '' : ' disabled'}>${text}</button>`;

    return `
      <div class="feature-move" role="group" aria-label="${escapeHtml(`Orden de ${label}`)}">
        ${button('up', 'Subir', canMoveUp)}
        ${button('down', 'Bajar', canMoveDown)}
      </div>`;
  };

  const featureMarkup = (feature: FeatureEntry, scopeIds: readonly number[]): string => {
    const id = feature.id;
    const invalid = feature.state === 'error' ? 'true' : 'false';
    const status = statusMarkup(feature.state, feature.error);
    const name = feature.draft.labelEs.trim() || feature.draft.labelEn.trim() || 'sin etiqueta';

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
          ${moveButtons('feature', id, `característica ${name}`, scopeIds, featureScopeKey(feature.groupId))}
          <button type="button" class="admin-button admin-button-quiet" data-action="delete-feature">
            Eliminar característica
          </button>
          <div class="feature-status-box" id="feature-${id}-status" role="status">${status}</div>
        </div>
      </article>`;
  };

  const featureListMarkup = (features: readonly FeatureEntry[]): string => {
    const ids = features.map((feature) => feature.id);
    return features.map((feature) => featureMarkup(feature, ids)).join('');
  };

  const groupMarkup = (group: GroupEntry, orderIds: readonly number[]): string => {
    const id = group.id;
    const invalid = group.state === 'error' ? 'true' : 'false';
    const status = statusMarkup(group.state, group.error);
    const name = groupDisplayName(group.draft);

    return `
      <section class="feature-group" data-group="${id}" aria-labelledby="group-${id}-heading">
        <h3 class="feature-group-title" id="group-${id}-heading">${headingMarkup(name)}</h3>

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
          ${moveButtons('group', id, `grupo ${name.text}`, orderIds, GROUPS_SCOPE)}
          <button type="button" class="admin-button" data-action="add-feature">
            Añadir característica
          </button>
          <button type="button" class="admin-button admin-button-quiet" data-action="delete-group">
            Eliminar grupo
          </button>
          <div class="feature-status-box" id="group-${id}-status" role="status">${status}</div>
        </div>

        <div class="feature-list">${featureListMarkup(featuresOfGroup(state, id))}</div>
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
        <div class="feature-list">${featureListMarkup(loose)}</div>
      </section>`;

    const emptyMarkup = isEmpty(state)
      ? `<p class="admin-muted" id="features-empty">${EMPTY_TEXT}</p>`
      : '';

    const errorMarkup =
      sectionError === null
        ? ''
        : `<p class="editor-error" id="features-error" role="alert">${escapeHtml(sectionError)}</p>`;

    const order = groupOrder(state);

    root.innerHTML = `
      ${errorMarkup}
      ${emptyMarkup}
      ${state.groups.map((group) => groupMarkup(group, order)).join('')}
      ${ungroupedSection}
      <div class="feature-toolbar">
        <button type="button" class="admin-button" data-action="add-group">Añadir grupo</button>
        <button type="button" class="admin-button" data-action="add-loose-feature">
          Añadir característica sin grupo
        </button>
      </div>`;

    // Tras reordenar, el foco vuelve al boton equivalente de la entidad movida.
    if (focusAfterRender !== null) {
      restoreFocus(focusAfterRender);
      focusAfterRender = null;
    }
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

  const focusField = (id: string): void => {
    byId<HTMLElement & { focus: () => void }>(id)?.focus();
  };

  /**
   * Devuelve el foco tras repintar.
   *
   * Si el boton pedido quedo deshabilitado (la entidad llego a un extremo), se
   * pasa al de la direccion contraria: el foco nunca se queda en el aire.
   */
  const restoreFocus = (buttonId: string): void => {
    const target = byId<HTMLButtonElement>(buttonId);

    if (target !== null && !target.disabled) {
      target.focus();
      return;
    }

    const opposite = buttonId.endsWith('-up')
      ? `${buttonId.slice(0, -3)}-down`
      : `${buttonId.slice(0, -5)}-up`;

    byId<HTMLButtonElement>(opposite)?.focus();
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
  /* Carga                                                                  */
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

    unregisterAll();

    loadError = null;
    sectionError = null;
    state = stateFromApi(result.data);

    // Se registran ya con su id real: nunca antes de que exista la fila.
    registerAll();
    render();
  };

  /* ---------------------------------------------------------------------- */
  /* Crear y eliminar (fuera del debounce, siempre inmediatas)              */
  /* ---------------------------------------------------------------------- */

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
    registerGroupPort(entry.id);
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
    registerFeaturePort(entry.id);
    render();
    focusField(`feature-${entry.id}-label-es`);
  };

  const deleteGroup = async (entry: GroupEntry): Promise<void> => {
    if (!window.confirm(deleteGroupMessage(isGroupDirty(entry)))) return;

    const result = await api.deleteGroup(entry.id);

    if (result.ok) {
      // Sus caracteristicas pasan a "Sin grupo" conservando sus borradores;
      // sus puertos siguen registrados porque siguen existiendo.
      coordinator.unregister(groupPortKey(entry.id));
      removeGroup(state, entry.id);
      sectionError = null;
    } else {
      entry.state = 'error';
      entry.error = result.message;
    }

    render();
  };

  const deleteFeature = async (entry: FeatureEntry): Promise<void> => {
    if (!window.confirm(deleteFeatureMessage(isFeatureDirty(entry)))) return;

    const result = await api.deleteFeature(entry.id);

    if (result.ok) {
      coordinator.unregister(featurePortKey(entry.id));
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
  /* Orden                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Reordena un grupo.
   *
   * La UI NO se mueve hasta que el servidor confirma: si falla, el orden que
   * se ve sigue siendo el real, sin necesidad de revertir nada.
   */
  const reorderGroup = async (groupId: number, direction: MoveDirection): Promise<void> => {
    if (reordering.has(GROUPS_SCOPE)) return;

    const next = moveGroup(state, groupId, direction);
    if (next === null) return;

    reordering.add(GROUPS_SCOPE);
    render();

    const result = await api.reorderGroups(next);

    reordering.delete(GROUPS_SCOPE);

    if (result.ok) {
      applyGroupOrder(state, next);
      sectionError = null;
    } else {
      sectionError = result.message;
    }

    focusAfterRender = `move-group-${groupId}-${direction}`;
    render();
  };

  const reorderFeature = async (featureId: number, direction: MoveDirection): Promise<void> => {
    const entry = featureById(featureId);
    if (entry === undefined) return;

    const scope = featureScopeKey(entry.groupId);
    if (reordering.has(scope)) return;

    const next = moveFeature(state, featureId, direction);
    if (next === null) return;

    reordering.add(scope);
    render();

    const result = await api.reorderFeatures(next.groupId, next.featureIds);

    reordering.delete(scope);

    if (result.ok) {
      applyFeatureOrder(state, next.groupId, next.featureIds);
      sectionError = null;
    } else {
      sectionError = result.message;
    }

    focusAfterRender = `move-feature-${featureId}-${direction}`;
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
        // Solo cambia el borrador: la tarjeta no se mueve hasta que el PATCH
        // salga bien.
        entry.draft.groupId = value === '' ? null : Number(value);
      } else if (field in entry.draft) {
        (entry.draft as unknown as Record<string, string>)[field] = value;
      }

      entry.state = isFeatureDirty(entry) ? 'dirty' : 'saved';
      entry.error = null;
      paintStatus(`feature-${entry.id}-status`, entry.state, entry.error);

      // A partir de aqui manda el coordinador: mismo debounce que el resto.
      coordinator.notifyChange(featurePortKey(entry.id));
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

    coordinator.notifyChange(groupPortKey(entry.id));
  };

  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    if (action === undefined) return;

    const button = target as HTMLButtonElement;
    const direction = target.dataset.direction === 'up' ? 'up' : 'down';
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

      case 'move-group':
        if (groupId !== null) void reorderGroup(groupId, direction);
        break;

      case 'move-feature':
        if (featureId !== null) void reorderFeature(featureId, direction);
        break;

      case 'delete-group': {
        const entry = groupId === null ? undefined : groupById(groupId);
        if (entry !== undefined) void deleteGroup(entry);
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

  return { dispose: unregisterAll };
}
