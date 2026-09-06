/**
 * Editor de propiedades en el navegador.
 *
 * Cablea el DOM con las reglas puras que viven en `editor-form.ts`,
 * `editor-state.ts`, `translation-state.ts` y `save-coordinator.ts`.
 *
 * El guardado pasa siempre por el coordinador: autosave y boton manual
 * comparten camino. La API escribe tres cosas por separado (nucleo, ES, EN) y
 * aqui no se finge que sean una sola.
 */

import { bindingFor, FIELD_BINDINGS } from './editor-fields';
import { initFeatureEditor } from './feature-editor';
import { initMediaEditor } from './media-editor';
import { initTourEditor } from './tour-editor';
import {
  areaPreview,
  fieldsToRaw,
  parseEditorForm,
  pricePreview,
  type EditorFormRaw,
} from './editor-form';
import {
  buildPatch,
  isDirty as isCoreDirty,
  loadStateMessage,
  mapSaveError,
  resolveLoadState,
  saveStateLabel,
  toEditorFields,
  type EditorFields,
  type PropertyPayload,
  type SaveState,
} from './editor-state';
import { commercialStatusLabel, publicationStatusLabel } from './labels';
import { resolveTitle, type PropertyTypePayload } from './property-row';
import {
  createSaveCoordinator,
  type GroupFieldError,
  type PersistResult,
  type SaveCoordinator,
  type SaveGroup,
  type SaveGroupPort,
} from './save-coordinator';
import {
  EMPTY_TRANSLATION,
  isTranslationDirty,
  languageStatusLabel,
  parseTranslationForm,
  resolveLanguageStatus,
  slugFromTitle,
  translationToRaw,
  type TranslationFields,
  type TranslationFormRaw,
} from './translation-state';
import type { Locale, PublicationStatus } from '../../domain/vocabularies';

interface EditorProperty extends PropertyPayload {
  publicationStatus: PublicationStatus;
}

interface TranslationPayload extends TranslationFields {
  locale: Locale;
}

const LOCALES: readonly Locale[] = ['es', 'en'];

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
  const element = byId<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
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

  let loadedCore: EditorFields | null = null;
  const loadedTranslations: Record<Locale, TranslationFields> = {
    es: { ...EMPTY_TRANSLATION },
    en: { ...EMPTY_TRANSLATION },
  };
  let publicationStatus: PublicationStatus = 'draft';
  let coordinator: SaveCoordinator | null = null;

  /* ---------------------------------------------------------------------- */
  /* Lectura y escritura del formulario                                     */
  /* ---------------------------------------------------------------------- */

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

  const readTranslationRaw = (locale: Locale): TranslationFormRaw => ({
    title: inputValue(`field-${locale}-title`),
    slug: inputValue(`field-${locale}-slug`),
    marketingDescription: inputValue(`field-${locale}-marketing`),
    technicalDescription: inputValue(`field-${locale}-technical`),
  });

  const writeRaw = (raw: EditorFormRaw): void => {
    for (const [field, value] of Object.entries(raw)) {
      const binding = bindingFor(field);
      if (binding === null) continue;

      const element = byId<HTMLInputElement | HTMLSelectElement>(binding.input);
      if (element === null) continue;

      if (typeof value === 'boolean') {
        (element as HTMLInputElement).checked = value;
      } else {
        element.value = value;
      }
    }
  };

  const writeTranslation = (locale: Locale, fields: TranslationFields): void => {
    const raw = translationToRaw(fields);

    for (const [key, value] of Object.entries(raw)) {
      const element = byId<HTMLInputElement | HTMLTextAreaElement>(
        `field-${locale}-${
          key === 'marketingDescription'
            ? 'marketing'
            : key === 'technicalDescription'
              ? 'technical'
              : key
        }`,
      );
      if (element !== null) element.value = value;
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Errores                                                                */
  /* ---------------------------------------------------------------------- */

  const clearErrors = (): void => {
    for (const binding of Object.values(FIELD_BINDINGS)) {
      if (binding.error === undefined) continue;

      const box = byId<HTMLElement>(binding.error);
      if (box !== null) {
        box.textContent = '';
        box.hidden = true;
      }
      byId<HTMLElement>(binding.input)?.setAttribute('aria-invalid', 'false');
    }

    if (formError !== null) {
      formError.textContent = '';
      formError.hidden = true;
    }
  };

  /** Asocia el error a su campo, o lo deja general si no hay uno concreto. */
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

  /*
   * Los errores de grupos y caracteristicas ya se pintan en su propia tarjeta,
   * que es donde el usuario esta mirando. Repetirlos en el aviso general del
   * formulario solo los alejaria del campo que los provoca.
   */
  const belongsToFeatures = (field: string): boolean =>
    field.startsWith('group:') ||
    field.startsWith('feature:') ||
    field.startsWith('media-group:') ||
    field.startsWith('media:') ||
    field.startsWith('tour-node:') ||
    field.startsWith('tour-link:');

  const showErrors = (errors: GroupFieldError[]): void => {
    for (const error of errors) {
      if (belongsToFeatures(error.field)) continue;
      showFieldError(error.field, error.message);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Pintado                                                                */
  /* ---------------------------------------------------------------------- */

  const setSaveState = (next: SaveState): void => {
    if (saveStatus !== null) {
      saveStatus.textContent = saveStateLabel(next);
      saveStatus.dataset.state = next;
    }
    if (saveButton !== null) saveButton.disabled = next === 'saving';
  };

  const renderHeader = (): void => {
    if (headerBox === null || loadedCore === null) return;

    const title = resolveTitle({
      titleEs: loadedTranslations.es.title,
      titleEn: loadedTranslations.en.title,
    });

    const titleClass = title.locale === null ? 'admin-title admin-title-missing' : 'admin-title';
    const langNote =
      title.locale === 'en'
        ? ' <span class="admin-lang-note" title="Falta el título en español">Falta ES</span>'
        : '';

    headerBox.innerHTML = `
      <p class="admin-code">${escapeHtml(loadedCore.code)}</p>
      <p class="editor-title"><span class="${titleClass}">${escapeHtml(title.text)}</span>${langNote}</p>
      <p class="editor-badges">
        <span class="admin-badge admin-badge-${publicationStatus}">${escapeHtml(
          publicationStatusLabel(publicationStatus),
        )}</span>
        <span class="admin-badge admin-badge-${loadedCore.commercialStatus}">${escapeHtml(
          commercialStatusLabel(loadedCore.commercialStatus),
        )}</span>
      </p>`;
  };

  /** Etiqueta informativa de cada idioma, calculada sobre lo que hay escrito. */
  const refreshLanguageStatus = (): void => {
    for (const locale of LOCALES) {
      const badge = byId<HTMLElement>(`lang-${locale}-status`);
      if (badge === null) continue;

      const parsed = parseTranslationForm(locale, readTranslationRaw(locale));
      const fields = parsed.ok ? parsed.fields : loadedTranslations[locale];
      const status = resolveLanguageStatus(fields);

      badge.textContent = languageStatusLabel(status);
      badge.dataset.status = status;
    }
  };

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

    refreshLanguageStatus();
  };

  /* ---------------------------------------------------------------------- */
  /* Puertos de guardado                                                    */
  /* ---------------------------------------------------------------------- */

  const corePort: SaveGroupPort = {
    isDirty(): boolean {
      if (loadedCore === null) return false;
      const parsed = parseEditorForm(readRaw());
      // Si no se puede interpretar, hay cambios pendientes igualmente.
      return parsed.ok ? isCoreDirty(loadedCore, parsed.fields) : true;
    },

    validate(): GroupFieldError[] {
      const parsed = parseEditorForm(readRaw());
      return parsed.ok ? [] : parsed.errors;
    },

    async persist(): Promise<PersistResult> {
      if (loadedCore === null) return { ok: true };

      const parsed = parseEditorForm(readRaw());
      if (!parsed.ok) return { ok: false, errors: parsed.errors };

      // Instantanea: es exactamente lo que esta ronda intenta persistir.
      const snapshot = parsed.fields;
      const patch = buildPatch(loadedCore, snapshot);

      if (Object.keys(patch).length === 0) {
        loadedCore = snapshot;
        return { ok: true };
      }

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
          return {
            ok: false,
            errors: [{ field: error.field ?? 'core', message: error.message }],
          };
        }

        const body = (await response.json()) as { data?: EditorProperty };

        /*
         * Se adopta lo que devuelve el servidor como "persistido", pero NO se
         * reescriben los campos: el usuario puede estar escribiendo y no debe
         * perder lo tecleado durante la peticion.
         */
        loadedCore = body.data === undefined ? snapshot : toEditorFields(body.data);
        if (body.data !== undefined) publicationStatus = body.data.publicationStatus;

        renderHeader();
        return { ok: true };
      } catch {
        return { ok: false, message: 'No pudimos guardar los cambios.' };
      }
    },
  };

  const translationPort = (locale: Locale): SaveGroupPort => ({
    isDirty(): boolean {
      const parsed = parseTranslationForm(locale, readTranslationRaw(locale));
      return parsed.ok ? isTranslationDirty(loadedTranslations[locale], parsed.fields) : true;
    },

    validate(): GroupFieldError[] {
      const parsed = parseTranslationForm(locale, readTranslationRaw(locale));
      return parsed.ok ? [] : parsed.errors;
    },

    async persist(): Promise<PersistResult> {
      const parsed = parseTranslationForm(locale, readTranslationRaw(locale));
      if (!parsed.ok) return { ok: false, errors: parsed.errors };

      const snapshot = parsed.fields;

      /*
       * Sin cambios no se escribe. Esto evita crear una fila de traduccion
       * vacia solo por haber abierto el editor.
       */
      if (!isTranslationDirty(loadedTranslations[locale], snapshot)) return { ok: true };

      try {
        const response = await fetch(`/api/admin/properties/${propertyId}/translations/${locale}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          // El slug viaja siempre explicito, para que el servidor no lo
          // regenere por su cuenta a partir del titulo.
          body: JSON.stringify({
            slug: snapshot.slug,
            title: snapshot.title,
            marketingDescription: snapshot.marketingDescription,
            technicalDescription: snapshot.technicalDescription,
          }),
        });

        if (!response.ok) {
          let body: unknown = null;
          try {
            body = await response.json();
          } catch {
            body = null;
          }

          const error = mapSaveError(response.status, body);

          // El error se ancla al idioma que fallo: nunca al otro.
          const field = error.field === null ? locale : `${locale}.${error.field}`;
          return { ok: false, errors: [{ field, message: error.message }] };
        }

        loadedTranslations[locale] = snapshot;
        renderHeader();
        refreshLanguageStatus();
        return { ok: true };
      } catch {
        return { ok: false, message: 'No pudimos guardar los cambios.' };
      }
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Carga                                                                  */
  /* ---------------------------------------------------------------------- */

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

  /** Devuelve si la propiedad quedo cargada, para decidir el resto del arranque. */
  const load = async (): Promise<boolean> => {
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
      return false;
    }

    const property = payload.property;

    stateBox.hidden = true;
    form.hidden = false;

    loadedCore = toEditorFields(property);
    publicationStatus = property.publicationStatus;
    writeRaw(fieldsToRaw(loadedCore));
    fillTypes(types, property.propertyTypeId);

    // Un idioma sin traduccion se queda con sus campos vacios.
    for (const locale of LOCALES) {
      const found = (payload.translations ?? []).find((entry) => entry.locale === locale);

      loadedTranslations[locale] =
        found === undefined
          ? { ...EMPTY_TRANSLATION }
          : {
              title: found.title,
              slug: found.slug,
              marketingDescription: found.marketingDescription,
              technicalDescription: found.technicalDescription,
            };

      writeTranslation(locale, loadedTranslations[locale]);
    }

    renderHeader();
    clearErrors();
    refreshConditionalUi();
    setSaveState('saved');
    return true;
  };

  /* ---------------------------------------------------------------------- */
  /* Coordinador                                                            */
  /* ---------------------------------------------------------------------- */

  coordinator = createSaveCoordinator({
    ports: { core: corePort, es: translationPort('es'), en: translationPort('en') },
    onRoundStart: clearErrors,
    onErrors: showErrors,
    onChange: (snapshot) => setSaveState(snapshot.global),
  });

  /** A que grupo pertenece un control, segun el prefijo de su `name`. */
  const groupOf = (element: EventTarget | null): SaveGroup => {
    const name =
      element !== null && 'name' in element ? String((element as { name: unknown }).name) : '';

    if (name.startsWith('es.')) return 'es';
    if (name.startsWith('en.')) return 'en';
    return 'core';
  };

  const onEdit = (event: Event): void => {
    refreshConditionalUi();
    coordinator?.notifyChange(groupOf(event.target));
  };

  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void coordinator?.saveNow();
  });

  // Generar slug: accion explicita, sobre el titulo del MISMO idioma.
  form.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const locale = target.dataset.generateSlug as Locale | undefined;
    if (locale === undefined) return;

    event.preventDefault();

    const result = slugFromTitle(inputValue(`field-${locale}-title`));

    if (!result.ok) {
      showFieldError(`${locale}.slug`, result.message);
      return;
    }

    const slugInput = byId<HTMLInputElement>(`field-${locale}-slug`);
    if (slugInput === null) return;

    slugInput.value = result.slug;
    showFieldError(`${locale}.slug`, '');
    byId<HTMLElement>(`field-${locale}-slug`)?.setAttribute('aria-invalid', 'false');

    const errorBox = byId<HTMLElement>(`field-${locale}-slug-error`);
    if (errorBox !== null) errorBox.hidden = true;

    // Queda marcado como sucio y entra en el flujo normal de autosave.
    coordinator?.notifyChange(locale);
    refreshLanguageStatus();
  });

  /*
   * Una sola fuente de verdad: el coordinador ya vigila core, los dos idiomas
   * y cada grupo, caracteristica, archivo y punto del recorrido registrados.
   * Basta con `preventDefault()`:
   * `returnValue` esta obsoleto.
   */
  window.addEventListener('beforeunload', (event) => {
    if (coordinator?.snapshot().hasPendingWork !== true) return;
    event.preventDefault();
  });

  void load().then((loaded) => {
    // Sin propiedad no hay caracteristicas que editar: la seccion sigue oculta.
    if (!loaded || coordinator === null) return;

    const featuresBox = byId<HTMLElement>('editor-features');
    if (featuresBox !== null) featuresBox.hidden = false;

    const mediaBox = byId<HTMLElement>('editor-media');
    if (mediaBox !== null) mediaBox.hidden = false;

    const tourBox = byId<HTMLElement>('editor-tour');
    if (tourBox !== null) tourBox.hidden = false;

    // Sus entidades se registran como puertos del MISMO coordinador.
    initFeatureEditor(propertyId, coordinator);
    initMediaEditor(propertyId, coordinator);
    initTourEditor(propertyId, coordinator);
  });
}
