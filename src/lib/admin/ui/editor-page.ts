/**
 * Editor de propiedades en el navegador.
 *
 * Carga la propiedad por la API administrativa, permite editar informacion
 * basica, precio, superficie y ubicacion, y lo guarda todo con un unico PATCH
 * parcial. Sin autosave, sin estado global y sin router de cliente.
 *
 * Las reglas viven en `editor-form.ts` y `editor-state.ts`; aqui solo hay
 * cableado de DOM.
 */

import { bindingFor, FIELD_BINDINGS } from './editor-fields';
import {
  areaPreview,
  fieldsToRaw,
  parseEditorForm,
  pricePreview,
  type EditorFormRaw,
} from './editor-form';
import {
  buildPatch,
  isDirty,
  loadStateMessage,
  mapSaveError,
  resolveLoadState,
  saveStateLabel,
  shouldWarnBeforeUnload,
  toEditorFields,
  type EditorFields,
  type PropertyPayload,
  type SaveState,
} from './editor-state';
import { commercialStatusLabel, publicationStatusLabel } from './labels';
import { resolveTitle, type PropertyTypePayload } from './property-row';
import type { PublicationStatus } from '../../domain/vocabularies';

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
function byId<T extends object>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function inputValue(id: string): string {
  const element = byId<HTMLInputElement | HTMLSelectElement>(id);
  return element === null ? '' : element.value;
}

function checkboxValue(id: string): boolean {
  const element = byId<HTMLInputElement>(id);
  return element === null ? false : element.checked;
}

export function initEditorPage(): void {
  const root = byId<HTMLElement>('admin-editor');
  if (root === null) return;

  const propertyId = Number(root.dataset.propertyId);
  if (!Number.isSafeInteger(propertyId) || propertyId <= 0) return;

  const stateBox = byId<HTMLElement>('editor-state');
  const form = byId<HTMLFormElement>('editor-form');
  const headerBox = byId<HTMLElement>('editor-header');
  const saveStatus = byId<HTMLElement>('editor-save-status');
  const saveButton = byId<HTMLButtonElement>('editor-save');
  const formError = byId<HTMLElement>('editor-form-error');

  const pricePreviewBox = byId<HTMLElement>('field-price-amount-preview');
  const areaPreviewBox = byId<HTMLElement>('field-area-preview');
  const precisionNote = byId<HTMLElement>('field-precision-note');
  const priceRow = byId<HTMLElement>('price-amount-row');

  if (form === null || stateBox === null) return;

  let loaded: EditorFields | null = null;
  let saveState: SaveState = 'saved';
  /** Traducciones de la ultima carga, para repintar la cabecera al guardar. */
  let translations: TranslationPayload[] = [];

  const readRaw = (): EditorFormRaw => ({
    code: inputValue('field-code'),
    propertyTypeId: inputValue('field-type'),
    commercialStatus: inputValue('field-commercial'),
    isFeatured: checkboxValue('field-featured'),
    showWhenSold: checkboxValue('field-show-when-sold'),

    priceMode: inputValue('field-price-mode'),
    priceAmount: inputValue('field-price-amount'),
    currencyCode: inputValue('field-currency'),

    areaSquareMeters: inputValue('field-area'),

    province: inputValue('field-province'),
    canton: inputValue('field-canton'),
    district: inputValue('field-district'),
    locality: inputValue('field-locality'),

    privateLatitude: inputValue('field-private-lat'),
    privateLongitude: inputValue('field-private-lng'),
    publicLatitude: inputValue('field-public-lat'),
    publicLongitude: inputValue('field-public-lng'),
    locationPrecision: inputValue('field-precision'),
  });

  const writeRaw = (raw: EditorFormRaw): void => {
    for (const [field, value] of Object.entries(raw)) {
      const binding = bindingFor(field);
      if (binding === undefined || binding === null) continue;

      const element = byId<HTMLInputElement | HTMLSelectElement>(binding.input);
      if (element === null) continue;

      if (typeof value === 'boolean') {
        (element as HTMLInputElement).checked = value;
      } else {
        element.value = value;
      }
    }
  };

  const clearErrors = (): void => {
    for (const binding of Object.values(FIELD_BINDINGS)) {
      if (binding.error === undefined) continue;

      const box = byId<HTMLElement>(binding.error);
      if (box !== null) {
        box.textContent = '';
        box.hidden = true;
      }

      const input = byId<HTMLElement>(binding.input);
      input?.setAttribute('aria-invalid', 'false');
    }

    if (formError !== null) {
      formError.textContent = '';
      formError.hidden = true;
    }
  };

  /** Asocia el error a su campo, o lo deja como error general si no hay uno. */
  const showFieldError = (field: string | null, message: string): void => {
    const binding = field === null ? null : bindingFor(field);

    if (binding?.error !== undefined) {
      const box = byId<HTMLElement>(binding.error);
      if (box !== null) {
        box.textContent = message;
        box.hidden = false;
      }
      byId<HTMLElement>(binding.input)?.setAttribute('aria-invalid', 'true');
      return;
    }

    if (formError !== null) {
      formError.textContent = message;
      formError.hidden = false;
    }
  };

  const focusField = (field: string | null): void => {
    const binding = field === null ? null : bindingFor(field);
    if (binding === null) return;
    byId<HTMLElement & { focus: () => void }>(binding.input)?.focus();
  };

  const setSaveState = (next: SaveState): void => {
    saveState = next;
    if (saveStatus !== null) {
      saveStatus.textContent = saveStateLabel(next);
      saveStatus.dataset.state = next;
    }
    if (saveButton !== null) saveButton.disabled = next === 'saving';
  };

  /**
   * Refresca lo que depende del modo de precio y de la precision.
   *
   * En modo "Consultar" el importe se DESACTIVA, no se borra: cambiar el
   * selector no debe hacer desaparecer un dato que el usuario todavia no ha
   * guardado.
   */
  const refreshConditionalUi = (): void => {
    const mode = inputValue('field-price-mode');
    const needsAmount = mode === 'exact' || mode === 'negotiable';

    const amountInput = byId<HTMLInputElement>('field-price-amount');
    const currencySelect = byId<HTMLSelectElement>('field-currency');

    if (amountInput !== null) amountInput.disabled = !needsAmount;
    if (currencySelect !== null) currencySelect.disabled = !needsAmount;
    if (priceRow !== null) priceRow.dataset.disabled = String(!needsAmount);

    if (pricePreviewBox !== null) {
      pricePreviewBox.textContent =
        pricePreview(inputValue('field-price-amount'), inputValue('field-currency')) ?? '';
    }

    if (areaPreviewBox !== null) {
      areaPreviewBox.textContent = areaPreview(inputValue('field-area')) ?? '';
    }

    if (precisionNote !== null) {
      precisionNote.hidden = inputValue('field-precision') !== 'approximate';
    }
  };

  const refreshDirty = (): void => {
    refreshConditionalUi();
    if (loaded === null || saveState === 'saving') return;

    const parsed = parseEditorForm(readRaw());

    // Con el formulario a medio corregir, se sigue considerando "sin guardar".
    if (!parsed.ok) {
      setSaveState('dirty');
      return;
    }

    setSaveState(isDirty(loaded, parsed.fields) ? 'dirty' : 'saved');
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
    const typeSelect = byId<HTMLSelectElement>('field-type');
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

    translations = payload.translations ?? [];
    renderHeader(property, translations);

    loaded = toEditorFields(property);
    writeRaw(fieldsToRaw(loaded));
    // El select de tipos se rellena despues, para conservar la seleccion.
    fillTypes(types, property.propertyTypeId);

    clearErrors();
    refreshConditionalUi();
    setSaveState('saved');
  };

  const save = async (): Promise<void> => {
    if (loaded === null || saveState === 'saving') return;

    clearErrors();

    const parsed = parseEditorForm(readRaw());

    // Si la validacion local falla, no se llega a enviar el PATCH.
    if (!parsed.ok) {
      for (const error of parsed.errors) showFieldError(error.field, error.message);
      focusField(parsed.errors[0]?.field ?? null);
      setSaveState('error');
      return;
    }

    const patch = buildPatch(loaded, parsed.fields);
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
        showFieldError(error.field, error.message);
        focusField(error.field);

        // Los cambios locales se conservan para no perder el trabajo.
        setSaveState('error');
        return;
      }

      const body = (await response.json()) as { data?: EditorProperty };
      if (body.data !== undefined) {
        loaded = toEditorFields(body.data);
        writeRaw(fieldsToRaw(loaded));
        renderHeader(body.data, translations);
      } else {
        loaded = parsed.fields;
      }

      refreshConditionalUi();
      setSaveState('saved');
    } catch {
      showFieldError(null, 'No pudimos guardar los cambios.');
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
