/**
 * Editor de informacion basica en el navegador.
 *
 * Carga la propiedad por la API administrativa, permite editar los cinco
 * campos de esta subfase y los guarda con un PATCH parcial. Sin autosave, sin
 * estado global y sin router de cliente.
 */

import {
  buildPatch,
  isDirty,
  loadStateMessage,
  mapSaveError,
  resolveLoadState,
  saveStateLabel,
  shouldWarnBeforeUnload,
  toBasicFields,
  validateCodeLocally,
  type BasicFields,
  type PropertyPayload,
  type SaveState,
} from './editor-state';
import { commercialStatusLabel, publicationStatusLabel } from './labels';
import { resolveTitle, type PropertyTypePayload } from './property-row';
import type { CommercialStatus, PublicationStatus } from '../../domain/vocabularies';

interface EditorProperty extends PropertyPayload {
  publicationStatus: PublicationStatus;
}

interface TranslationPayload {
  locale: 'es' | 'en';
  title: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/*
 * Se usan aserciones en vez del generico de `querySelector`: los tipos del
 * runtime de Workers definen su propio `Element` (el de HTMLRewriter) y
 * chocan con el del DOM.
 */
function el<T extends object>(selector: string): T | null {
  return document.querySelector(selector) as T | null;
}

export function initEditorPage(): void {
  const root = el<HTMLElement>('#admin-editor');
  if (root === null) return;

  const propertyId = Number(root.dataset.propertyId);
  if (!Number.isSafeInteger(propertyId) || propertyId <= 0) return;

  const stateBox = el<HTMLElement>('#editor-state');
  const form = el<HTMLFormElement>('#editor-form');
  const headerBox = el<HTMLElement>('#editor-header');
  const saveStatus = el<HTMLElement>('#editor-save-status');
  const saveButton = el<HTMLButtonElement>('#editor-save');

  const codeInput = el<HTMLInputElement>('#field-code');
  const codeError = el<HTMLElement>('#field-code-error');
  const typeSelect = el<HTMLSelectElement>('#field-type');
  const commercialSelect = el<HTMLSelectElement>('#field-commercial');
  const featuredInput = el<HTMLInputElement>('#field-featured');
  const showWhenSoldInput = el<HTMLInputElement>('#field-show-when-sold');
  const formError = el<HTMLElement>('#editor-form-error');

  if (form === null || stateBox === null) return;

  let loaded: BasicFields | null = null;
  let saveState: SaveState = 'saved';

  const readForm = (): BasicFields => ({
    code: codeInput?.value ?? '',
    propertyTypeId:
      typeSelect === null || typeSelect.value === '' ? null : Number(typeSelect.value),
    commercialStatus: (commercialSelect?.value ?? 'available') as CommercialStatus,
    isFeatured: featuredInput?.checked ?? false,
    showWhenSold: showWhenSoldInput?.checked ?? false,
  });

  const setSaveState = (next: SaveState): void => {
    saveState = next;
    if (saveStatus !== null) {
      saveStatus.textContent = saveStateLabel(next);
      saveStatus.dataset.state = next;
    }
    if (saveButton !== null) saveButton.disabled = next === 'saving';
  };

  const setCodeError = (message: string | null): void => {
    if (codeInput === null || codeError === null) return;

    codeError.textContent = message ?? '';
    codeError.hidden = message === null;
    codeInput.setAttribute('aria-invalid', message === null ? 'false' : 'true');
  };

  const setFormError = (message: string | null): void => {
    if (formError === null) return;
    formError.textContent = message ?? '';
    formError.hidden = message === null;
  };

  const refreshDirty = (): void => {
    if (loaded === null || saveState === 'saving') return;
    setSaveState(isDirty(loaded, readForm()) ? 'dirty' : 'saved');
  };

  const renderHeader = (property: EditorProperty, translations: TranslationPayload[]): void => {
    if (headerBox === null) return;

    const title = resolveTitle({
      titleEs: translations.find((t) => t.locale === 'es')?.title ?? null,
      titleEn: translations.find((t) => t.locale === 'en')?.title ?? null,
    });

    const titleClass = title.locale === null ? 'admin-title admin-title-missing' : 'admin-title';
    const langNote =
      title.locale === 'en'
        ? ' <span class="admin-lang-note" title="Falta el título en español">Falta ES</span>'
        : '';

    headerBox.innerHTML = `
      <p class="admin-code">${escapeHtml(property.code)}</p>
      <p class="editor-title"><span class="${titleClass}">${escapeHtml(title.text)}</span>${langNote}</p>
      <p class="editor-badges">
        <span class="admin-badge admin-badge-${property.publicationStatus}">${escapeHtml(
          publicationStatusLabel(property.publicationStatus),
        )}</span>
        <span class="admin-badge admin-badge-${property.commercialStatus}">${escapeHtml(
          commercialStatusLabel(property.commercialStatus),
        )}</span>
      </p>`;
  };

  const fillTypes = (types: PropertyTypePayload[], selected: number | null): void => {
    if (typeSelect === null) return;

    const options = types.map((type) => {
      const label = type.names.es ?? type.names.en ?? `Tipo ${type.id}`;
      return `<option value="${type.id}">${escapeHtml(label)}</option>`;
    });

    typeSelect.innerHTML = `<option value="">Sin tipo</option>${options.join('')}`;
    typeSelect.value = selected === null ? '' : String(selected);
  };

  const showState = (message: string, withBackLink: boolean): void => {
    form.hidden = true;
    stateBox.hidden = false;
    stateBox.innerHTML = `
      <div class="admin-state${withBackLink ? ' admin-state-error' : ''}">
        <p>${escapeHtml(message)}</p>
        ${withBackLink ? '<p><a href="/admin/propiedades">Volver a propiedades</a></p>' : ''}
      </div>`;
  };

  const load = async (): Promise<void> => {
    showState('Cargando propiedad…', false);

    let types: PropertyTypePayload[] = [];
    try {
      const typesResponse = await fetch('/api/admin/property-types', {
        headers: { accept: 'application/json' },
      });
      if (typesResponse.ok) {
        const body = (await typesResponse.json()) as { data?: PropertyTypePayload[] };
        types = body.data ?? [];
      }
    } catch {
      // Sin tipos el editor sigue siendo usable: se muestra "Sin tipo".
    }

    // Se asigna en ambas ramas del try/catch, asi que no lleva valor inicial.
    let status: number | null;
    let payload: { property?: EditorProperty; translations?: TranslationPayload[] } | null = null;

    try {
      const response = await fetch(`/api/admin/properties/${propertyId}`, {
        headers: { accept: 'application/json' },
      });
      status = response.status;

      if (response.ok) {
        const body = (await response.json()) as {
          data?: { property?: EditorProperty; translations?: TranslationPayload[] };
        };
        payload = body.data ?? null;
      }
    } catch {
      status = 0;
    }

    const loadState = resolveLoadState(status);

    if (loadState !== 'ready' || payload?.property === undefined) {
      showState(loadStateMessage(loadState) ?? 'No pudimos cargar la propiedad.', true);
      return;
    }

    const property = payload.property;

    stateBox.hidden = true;
    form.hidden = false;

    renderHeader(property, payload.translations ?? []);
    fillTypes(types, property.propertyTypeId);

    if (codeInput !== null) codeInput.value = property.code;
    if (commercialSelect !== null) commercialSelect.value = property.commercialStatus;
    if (featuredInput !== null) featuredInput.checked = property.isFeatured;
    if (showWhenSoldInput !== null) showWhenSoldInput.checked = property.showWhenSold;

    loaded = toBasicFields(property);
    setSaveState('saved');
  };

  const save = async (): Promise<void> => {
    if (loaded === null || saveState === 'saving') return;

    setCodeError(null);
    setFormError(null);

    const current = readForm();

    // Comprobacion local previa; la API sigue siendo la autoridad.
    const codeProblem = validateCodeLocally(current.code);
    if (codeProblem !== null) {
      setCodeError(codeProblem);
      setSaveState('error');
      codeInput?.focus();
      return;
    }

    const patch = buildPatch(loaded, current);
    if (Object.keys(patch).length === 0) {
      setSaveState('saved');
      return;
    }

    setSaveState('saving');

    try {
      const response = await fetch(`/api/admin/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }

        const error = mapSaveError(response.status, body);
        if (error.field === 'code') {
          setCodeError(error.message);
          codeInput?.focus();
        } else {
          setFormError(error.message);
        }

        // Los cambios locales se conservan para no perder el trabajo.
        setSaveState('error');
        return;
      }

      const body = (await response.json()) as { data?: EditorProperty };
      if (body.data !== undefined) {
        loaded = toBasicFields(body.data);
        if (codeInput !== null) codeInput.value = body.data.code;
      } else {
        loaded = current;
      }

      setSaveState('saved');
    } catch {
      setFormError('No pudimos guardar los cambios.');
      setSaveState('error');
    }
  };

  form.addEventListener('input', refreshDirty);
  form.addEventListener('change', refreshDirty);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });

  /*
   * Solo se avisa al salir cuando hay cambios que se perderian. Basta con
   * `preventDefault()`: `returnValue` esta obsoleto y los navegadores
   * actuales ya no lo necesitan.
   */
  window.addEventListener('beforeunload', (event) => {
    if (!shouldWarnBeforeUnload(saveState)) return;
    event.preventDefault();
  });

  void load();
}
