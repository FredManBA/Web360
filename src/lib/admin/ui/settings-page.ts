/**
 * Configuracion del sitio en el navegador.
 *
 * Usa el MISMO coordinador de guardado que el editor de propiedades: un solo
 * patron en todo el panel, con su debounce, sus escrituras serializadas y sus
 * instantaneas. Aqui los grupos son tres: los ajustes del negocio y los textos
 * de cada idioma.
 *
 * Las redes sociales quedan fuera del autosave a proposito: anadir y borrar
 * son acciones explicitas, no ediciones continuas, igual que los grupos de
 * caracteristicas.
 */

import {
  createSaveCoordinator,
  type GroupFieldError,
  type PersistResult,
  type SaveCoordinator,
  type SaveGroup,
  type SaveGroupPort,
} from './save-coordinator';
import type { Locale } from '../../domain/vocabularies';

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

const LOCALES: readonly Locale[] = ['es', 'en'];

const SETTING_FIELDS = [
  'businessName',
  'address',
  'defaultCurrencyCode',
  'phone',
  'whatsapp',
  'email',
  'notificationsEmail',
  'reviewerEmail',
] as const;

const TEXT_FIELDS = [
  'brandTagline',
  'homeHeroTitle',
  'homeHeroSubtitle',
  'globalSeoTitle',
  'globalSeoDescription',
] as const;

type SettingField = (typeof SETTING_FIELDS)[number];
type TextField = (typeof TEXT_FIELDS)[number];

type SettingsRaw = Record<SettingField, string>;
type TextsRaw = Record<TextField, string>;

interface SocialLink {
  id: number;
  platform: string;
  url: string;
  sortOrder: number;
  isActive: boolean;
}

interface ConfigPayload {
  settings: Partial<Record<SettingField, string | null>>;
  translations: ({ locale: Locale } & Partial<Record<TextField, string | null>>)[];
  social: SocialLink[];
}

/** Lo que se guarda: `""` significa "sin valor", y viaja como `null`. */
function toValue(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const SAVE_LABELS: Record<string, string> = {
  saved: 'Guardado',
  dirty: 'Sin guardar',
  saving: 'Guardando…',
  error: 'No se pudo guardar',
};

export function initSettingsPage(): void {
  const form = byId<HTMLFormElement>('settings-form');
  const state = byId<HTMLElement>('settings-state');
  if (form === null || state === null) return;

  const saveState = byId<HTMLElement>('settings-save-state');
  const errorBox = byId<HTMLElement>('settings-errors');
  const socialList = byId<HTMLElement>('social-list');
  const socialError = byId<HTMLElement>('social-error');

  let coordinator: SaveCoordinator | null = null;

  /** Lo ultimo confirmado por el servidor; con esto se decide que cambio. */
  let loadedSettings: SettingsRaw | null = null;
  const loadedTexts: Record<Locale, TextsRaw> = {
    es: emptyTexts(),
    en: emptyTexts(),
  };
  let social: SocialLink[] = [];

  function emptyTexts(): TextsRaw {
    return {
      brandTagline: '',
      homeHeroTitle: '',
      homeHeroSubtitle: '',
      globalSeoTitle: '',
      globalSeoDescription: '',
    };
  }

  const field = (name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null =>
    byId(name);

  const readSettings = (): SettingsRaw => {
    const raw = {} as SettingsRaw;
    for (const name of SETTING_FIELDS) raw[name] = field(name)?.value ?? '';
    return raw;
  };

  const readTexts = (locale: Locale): TextsRaw => {
    const raw = {} as TextsRaw;
    for (const name of TEXT_FIELDS) raw[name] = field(`${locale}.${name}`)?.value ?? '';
    return raw;
  };

  const writeSettings = (raw: SettingsRaw): void => {
    for (const name of SETTING_FIELDS) {
      const element = field(name);
      if (element !== null) element.value = raw[name];
    }
  };

  const writeTexts = (locale: Locale, raw: TextsRaw): void => {
    for (const name of TEXT_FIELDS) {
      const element = field(`${locale}.${name}`);
      if (element !== null) element.value = raw[name];
    }
  };

  /** Los campos que de verdad han cambiado respecto a lo ultimo guardado. */
  const changed = <T extends Record<string, string>>(before: T, now: T): Partial<T> => {
    const patch: Record<string, string> = {};

    for (const [key, value] of Object.entries(now)) {
      if (before[key] !== value) patch[key] = value;
    }

    return patch as Partial<T>;
  };

  const setSaveState = (value: string): void => {
    if (saveState !== null) saveState.textContent = SAVE_LABELS[value] ?? '';
  };

  const showErrors = (errors: GroupFieldError[]): void => {
    if (errorBox === null) return;

    if (errors.length === 0) {
      errorBox.hidden = true;
      errorBox.textContent = '';
      return;
    }

    errorBox.hidden = false;
    errorBox.textContent = errors.map((error) => error.message).join(' · ');
  };

  /* ---------------------------------------------------------------------- */
  /* Puertos                                                                */
  /* ---------------------------------------------------------------------- */

  const settingsPort: SaveGroupPort = {
    isDirty(): boolean {
      if (loadedSettings === null) return false;
      return Object.keys(changed(loadedSettings, readSettings())).length > 0;
    },

    validate(): GroupFieldError[] {
      const raw = readSettings();
      const errors: GroupFieldError[] = [];

      /*
       * El navegador ya valida `type="email"`, pero no cuando el script
       * escribe el valor: se comprueba igualmente, y el servidor manda.
       */
      for (const name of ['email', 'notificationsEmail', 'reviewerEmail'] as const) {
        const value = toValue(raw[name]);
        if (value !== null && !value.includes('@')) {
          errors.push({ field: name, message: 'Ese correo no parece válido.' });
        }
      }

      return errors;
    },

    async persist(): Promise<PersistResult> {
      if (loadedSettings === null) return { ok: true };

      // Instantanea: es exactamente lo que esta ronda intenta guardar.
      const snapshot = readSettings();
      const patch = changed(loadedSettings, snapshot);
      if (Object.keys(patch).length === 0) return { ok: true };

      const body: Record<string, string | null> = {};
      for (const key of Object.keys(patch)) body[key] = toValue(snapshot[key as SettingField]);

      try {
        const response = await fetch('/api/admin/settings', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) return { ok: false, errors: await readErrors(response) };

        loadedSettings = snapshot;
        return { ok: true };
      } catch {
        return { ok: false, errors: [{ field: '', message: 'Sin conexión con el servidor.' }] };
      }
    },
  };

  const textsPort = (locale: Locale): SaveGroupPort => ({
    isDirty(): boolean {
      return Object.keys(changed(loadedTexts[locale], readTexts(locale))).length > 0;
    },

    validate(): GroupFieldError[] {
      return [];
    },

    async persist(): Promise<PersistResult> {
      const snapshot = readTexts(locale);
      const patch = changed(loadedTexts[locale], snapshot);

      // Sin cambios no se escribe: abrir la pantalla no crea una fila vacia.
      if (Object.keys(patch).length === 0) return { ok: true };

      const body: Record<string, string | null> = {};
      for (const key of Object.keys(patch)) body[key] = toValue(snapshot[key as TextField]);

      try {
        const response = await fetch(`/api/admin/settings/translations/${locale}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) return { ok: false, errors: await readErrors(response) };

        loadedTexts[locale] = snapshot;
        return { ok: true };
      } catch {
        return { ok: false, errors: [{ field: '', message: 'Sin conexión con el servidor.' }] };
      }
    },
  });

  /** Traduce el error del servidor a lo que espera el coordinador. */
  async function readErrors(response: Response): Promise<GroupFieldError[]> {
    try {
      const body = (await response.json()) as {
        error?: { message?: string; field?: string; details?: { issues?: { message: string }[] } };
      };

      const issues = body.error?.details?.issues ?? [];
      if (issues.length > 0) {
        return issues.map((issue) => ({ field: body.error?.field ?? '', message: issue.message }));
      }

      return [
        { field: body.error?.field ?? '', message: body.error?.message ?? 'No se pudo guardar.' },
      ];
    } catch {
      return [{ field: '', message: 'No se pudo guardar.' }];
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Redes sociales                                                         */
  /* ---------------------------------------------------------------------- */

  const saySocial = (message: string): void => {
    if (socialError === null) return;
    socialError.hidden = message.length === 0;
    socialError.textContent = message;
  };

  const renderSocial = (): void => {
    if (socialList === null) return;

    if (social.length === 0) {
      socialList.innerHTML = '<p class="admin-empty">Todavía no hay redes configuradas.</p>';
      return;
    }

    socialList.innerHTML = social
      .map(
        (link, index) =>
          `<div class="social-row" data-link="${link.id}">` +
          `<span class="social-platform">${escapeHtml(link.platform)}</span>` +
          `<a class="social-url" href="${escapeHtml(link.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(link.url)}</a>` +
          `<label class="social-active"><input type="checkbox" data-action="toggle" data-id="${link.id}"${link.isActive ? ' checked' : ''}> Visible</label>` +
          '<span class="social-actions">' +
          `<button type="button" class="admin-button" data-action="up" data-id="${link.id}"${index === 0 ? ' disabled' : ''} aria-label="Subir ${escapeHtml(link.platform)}">↑</button>` +
          `<button type="button" class="admin-button" data-action="down" data-id="${link.id}"${index === social.length - 1 ? ' disabled' : ''} aria-label="Bajar ${escapeHtml(link.platform)}">↓</button>` +
          `<button type="button" class="admin-button admin-button-danger" data-action="delete" data-id="${link.id}">Eliminar</button>` +
          '</span>' +
          '</div>',
      )
      .join('');
  };

  const persistOrder = async (): Promise<void> => {
    try {
      const response = await fetch('/api/admin/settings/social/order', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ ids: social.map((link) => link.id) }),
      });

      if (!response.ok) {
        saySocial('No se pudo guardar el orden.');
        return;
      }

      saySocial('');
    } catch {
      saySocial('Sin conexión con el servidor.');
    }
  };

  socialList?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    const id = Number(target.dataset.id);
    if (action === undefined || !Number.isFinite(id)) return;

    const index = social.findIndex((link) => link.id === id);
    if (index < 0) return;

    void (async () => {
      if (action === 'delete') {
        const link = social[index];
        if (link === undefined) return;
        if (!window.confirm(`¿Eliminar ${link.platform}?`)) return;

        try {
          const response = await fetch(`/api/admin/settings/social/${id}`, { method: 'DELETE' });
          if (!response.ok) {
            saySocial('No se pudo eliminar el enlace.');
            return;
          }

          social = social.filter((candidate) => candidate.id !== id);
          saySocial('');
          renderSocial();
        } catch {
          saySocial('Sin conexión con el servidor.');
        }
        return;
      }

      if (action === 'up' || action === 'down') {
        const next = action === 'up' ? index - 1 : index + 1;
        const a = social[index];
        const b = social[next];
        if (a === undefined || b === undefined) return;

        social[index] = b;
        social[next] = a;
        renderSocial();
        await persistOrder();
      }
    })();
  });

  socialList?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.action !== 'toggle') return;

    const id = Number(target.dataset.id);
    const link = social.find((candidate) => candidate.id === id);
    if (link === undefined) return;

    void (async () => {
      try {
        const response = await fetch(`/api/admin/settings/social/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ isActive: target.checked }),
        });

        if (!response.ok) {
          saySocial('No se pudo cambiar la visibilidad.');
          target.checked = link.isActive;
          return;
        }

        link.isActive = target.checked;
        saySocial('');
      } catch {
        saySocial('Sin conexión con el servidor.');
        target.checked = link.isActive;
      }
    })();
  });

  byId<HTMLButtonElement>('social-add')?.addEventListener('click', () => {
    const platform = byId<HTMLInputElement>('social-platform');
    const url = byId<HTMLInputElement>('social-url');
    if (platform === null || url === null) return;

    void (async () => {
      try {
        const response = await fetch('/api/admin/settings/social', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ platform: platform.value.trim(), url: url.value.trim() }),
        });

        if (!response.ok) {
          const errors = await readErrors(response);
          saySocial(errors[0]?.message ?? 'No se pudo añadir el enlace.');
          return;
        }

        const body = (await response.json()) as { data?: SocialLink };
        if (body.data !== undefined) social.push(body.data);

        platform.value = '';
        url.value = '';
        saySocial('');
        renderSocial();
      } catch {
        saySocial('Sin conexión con el servidor.');
      }
    })();
  });

  /* ---------------------------------------------------------------------- */
  /* Carga                                                                  */
  /* ---------------------------------------------------------------------- */

  const load = async (): Promise<void> => {
    let payload: ConfigPayload | null = null;
    // Se asigna en ambas ramas del try/catch, asi que no lleva valor inicial.
    let status: number;

    try {
      const response = await fetch('/api/admin/settings', {
        headers: { accept: 'application/json' },
      });
      status = response.status;

      if (response.ok) {
        const body = (await response.json()) as { data?: ConfigPayload };
        payload = body.data ?? null;
      }
    } catch {
      status = 0;
    }

    if (payload === null) {
      state.textContent =
        status === 403
          ? 'No tienes acceso a la configuración.'
          : 'No pudimos cargar la configuración.';
      return;
    }

    const raw = {} as SettingsRaw;
    for (const name of SETTING_FIELDS) raw[name] = payload.settings[name] ?? '';
    loadedSettings = raw;
    writeSettings(raw);

    for (const locale of LOCALES) {
      const found = payload.translations.find((entry) => entry.locale === locale);
      const texts = emptyTexts();
      if (found !== undefined) {
        for (const name of TEXT_FIELDS) texts[name] = found[name] ?? '';
      }

      loadedTexts[locale] = texts;
      writeTexts(locale, texts);
    }

    social = payload.social;
    renderSocial();

    state.hidden = true;
    form.hidden = false;
    setSaveState('saved');
  };

  /* ---------------------------------------------------------------------- */
  /* Coordinador                                                            */
  /* ---------------------------------------------------------------------- */

  coordinator = createSaveCoordinator({
    ports: { core: settingsPort, es: textsPort('es'), en: textsPort('en') },
    onRoundStart: () => showErrors([]),
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

  const onEdit = (event: Event): void => coordinator?.notifyChange(groupOf(event.target));

  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);

  void load();
}
