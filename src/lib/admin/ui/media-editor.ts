/**
 * Seccion de multimedia del editor.
 *
 * Solo cableado de DOM: el estado vive en `media-editor-state.ts` y las
 * llamadas en `media-api.ts`. Nunca toca D1 ni R2 directamente.
 *
 * Que pasa por el coordinador de guardado y que no:
 *
 * - los nombres de los grupos y los textos de cada archivo son puertos mas del
 *   coordinador, con el mismo debounce que el resto del editor;
 * - subir, anadir un video de YouTube, cambiar hero o portada y eliminar son
 *   acciones explicitas e inmediatas, fuera del debounce.
 *
 * Todavia no hay URL publica de los archivos, asi que no se pinta ninguna
 * miniatura: cada tarjeta se identifica por su tipo, su titulo y su estado.
 */

import { createMediaApi, type MediaApi } from './media-api';
import {
  addGroup,
  addMedia,
  applyCatalogCover,
  applyHero,
  clearFinishedUploads,
  createUploadItem,
  formatFileSize,
  groupDisplayName,
  groupPatch,
  hasActiveUploads,
  isEmpty,
  isGroupDirty,
  isMediaDirty,
  markGroupSaved,
  markMediaSaved,
  mediaDisplayName,
  mediaKindLabel,
  mediaOfGroup,
  mediaPatch,
  removeGroup,
  removeMedia,
  runUploadQueue,
  stateFromApi,
  summarizeUploads,
  ungroupedMedia,
  type EntityState,
  type GroupNameView,
  type MediaDraft,
  type MediaEditorState,
  type MediaEntry,
  type MediaGroupDraft,
  type MediaGroupEntry,
  type UploadItem,
} from './media-editor-state';
import { saveStateLabel } from './editor-state';
import { type PersistResult, type SaveCoordinator } from './save-coordinator';
import { MEDIA_KINDS, type MediaKind } from '../../domain/vocabularies';

export const LOADING_TEXT = 'Cargando archivos…';
export const EMPTY_TEXT = 'Aún no hay archivos.';

/** Aviso extra cuando la entidad tiene cambios que aun no se han guardado. */
const UNSAVED_WARNING = 'Tiene cambios sin guardar que se perderán.';

const CONFIRM_DELETE_GROUP_BASE =
  'Se eliminará el grupo. Los archivos del grupo no se eliminarán; pasarán a "Sin grupo".';

const CONFIRM_DELETE_MEDIA_BASE =
  'Se eliminará el archivo y su copia almacenada. Esta acción no se puede deshacer.';

export function deleteGroupMessage(dirty: boolean): string {
  return dirty ? `${CONFIRM_DELETE_GROUP_BASE} ${UNSAVED_WARNING}` : CONFIRM_DELETE_GROUP_BASE;
}

export function deleteMediaMessage(dirty: boolean): string {
  return dirty ? `${CONFIRM_DELETE_MEDIA_BASE} ${UNSAVED_WARNING}` : CONFIRM_DELETE_MEDIA_BASE;
}

/** Claves de los puertos dinamicos de esta seccion. */
export function mediaGroupPortKey(groupId: number): string {
  return `media-group:${groupId}`;
}

export function mediaPortKey(mediaId: number): string {
  return `media:${mediaId}`;
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

function headingMarkup(name: GroupNameView): string {
  const note = name.missingSpanish
    ? ' <span class="admin-lang-note" title="Falta el nombre en español">Falta ES</span>'
    : '';
  return `${escapeHtml(name.text)}${note}`;
}

export interface MediaEditorHandle {
  /** Da de baja todos los puertos. */
  dispose: () => void;
}

export function initMediaEditor(
  propertyId: number,
  coordinator: SaveCoordinator,
  api: MediaApi = createMediaApi(propertyId),
): MediaEditorHandle {
  const root = byId<HTMLElement>('admin-media');
  if (root === null) return { dispose: () => undefined };

  let state: MediaEditorState = { groups: [], media: [] };
  let loadError: string | null = null;
  /** Fallo de una accion suelta (crear, subir, borrar, rol). */
  let sectionError: string | null = null;

  /** Archivos elegidos y todavia sin subir, o ya procesados. */
  let queue: UploadItem[] = [];
  let pendingFiles = new Map<string, File>();
  let uploading = false;
  let queueCounter = 0;

  /* ---------------------------------------------------------------------- */
  /* Puertos del coordinador                                                */
  /* ---------------------------------------------------------------------- */

  const groupById = (id: number): MediaGroupEntry | undefined =>
    state.groups.find((group) => group.id === id);

  const mediaById = (id: number): MediaEntry | undefined =>
    state.media.find((item) => item.id === id);

  const registerGroupPort = (groupId: number): void => {
    coordinator.register(mediaGroupPortKey(groupId), {
      isDirty: () => {
        const entry = groupById(groupId);
        return entry !== undefined && isGroupDirty(entry);
      },

      validate: () => [],

      persist: async (): Promise<PersistResult> => {
        const entry = groupById(groupId);
        if (entry === undefined) return { ok: true };

        const snapshot: MediaGroupDraft = { ...entry.draft };

        entry.state = 'saving';
        entry.error = null;
        paintStatus(`media-group-${groupId}-status`, entry.state, entry.error);

        const result = await api.updateGroup(groupId, groupPatch(entry));

        const current = groupById(groupId);
        if (current === undefined) return { ok: true };

        if (result.ok) {
          markGroupSaved(current, snapshot);
        } else {
          current.state = 'error';
          current.error = result.message;
        }

        render();

        // El mensaje ya se ve en la tarjeta; no se repite arriba.
        return result.ok ? { ok: true } : { ok: false };
      },
    });
  };

  const registerMediaPort = (mediaId: number): void => {
    coordinator.register(mediaPortKey(mediaId), {
      isDirty: () => {
        const entry = mediaById(mediaId);
        return entry !== undefined && isMediaDirty(entry);
      },

      validate: () => [],

      persist: async (): Promise<PersistResult> => {
        const entry = mediaById(mediaId);
        if (entry === undefined) return { ok: true };

        const snapshot: MediaDraft = { ...entry.draft };

        entry.state = 'saving';
        entry.error = null;
        paintStatus(`media-${mediaId}-status`, entry.state, entry.error);

        const result = await api.updateMedia(mediaId, mediaPatch(entry));

        const current = mediaById(mediaId);
        if (current === undefined) return { ok: true };

        if (result.ok) {
          // La tarjeta cambia de grupo AHORA, no antes.
          markMediaSaved(current, snapshot, result.data.sortOrder);
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
    for (const item of state.media) registerMediaPort(item.id);
  };

  const unregisterAll = (): void => {
    for (const group of state.groups) coordinator.unregister(mediaGroupPortKey(group.id));
    for (const item of state.media) coordinator.unregister(mediaPortKey(item.id));
  };

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */

  const statusMarkup = (entryState: EntityState, error: string | null): string => {
    const label = error ?? saveStateLabel(entryState);
    return `<p class="editor-save-status media-status" data-state="${entryState}">${escapeHtml(label)}</p>`;
  };

  const groupOptions = (selected: number | null): string => {
    const options = state.groups.map((group) => {
      const name = groupDisplayName(group.draft).text;
      const isSelected = selected === group.id ? ' selected' : '';
      return `<option value="${group.id}"${isSelected}>${escapeHtml(name)}</option>`;
    });

    const noneSelected = selected === null ? ' selected' : '';
    return `<option value=""${noneSelected}>Sin grupo</option>${options.join('')}`;
  };

  /** Distintivo visual por tipo, a falta de miniatura real. */
  const kindGlyph = (kind: MediaKind): string => {
    const glyphs: Record<MediaKind, string> = {
      image: 'IMG',
      video: 'VÍD',
      document: 'DOC',
      panorama: '360',
    };

    return glyphs[kind];
  };

  const roleBadges = (entry: MediaEntry): string => {
    const badges: string[] = [];

    if (entry.isHero)
      badges.push('<span class="admin-badge media-badge-hero">Portada de ficha</span>');
    if (entry.isCatalogCover) {
      badges.push('<span class="admin-badge media-badge-cover">Portada de catálogo</span>');
    }

    return badges.join('');
  };

  const mediaCard = (entry: MediaEntry): string => {
    const id = entry.id;
    const invalid = entry.state === 'error' ? 'true' : 'false';
    const name = mediaDisplayName(entry);
    const size = formatFileSize(entry.fileSizeBytes);

    const source =
      entry.sourceProvider === 'youtube'
        ? `YouTube · ${escapeHtml(entry.youtubeVideoId ?? '')}`
        : `Archivo${size === null ? '' : ` · ${size}`}`;

    /*
     * Los roles se ofrecen solo donde tienen sentido: el esquema no admite un
     * documento como portada, asi que tampoco se muestra el boton.
     */
    const heroButton =
      entry.mediaKind === 'image' || entry.mediaKind === 'video'
        ? `<button type="button" class="admin-button" data-action="toggle-hero"
             aria-pressed="${entry.isHero}">
             ${entry.isHero ? 'Quitar de portada de ficha' : 'Usar como portada de ficha'}
           </button>`
        : '';

    const coverButton =
      entry.mediaKind === 'image'
        ? `<button type="button" class="admin-button" data-action="toggle-cover"
             aria-pressed="${entry.isCatalogCover}">
             ${entry.isCatalogCover ? 'Quitar de portada de catálogo' : 'Usar como portada de catálogo'}
           </button>`
        : '';

    return `
      <article class="media-card" data-media="${id}" aria-labelledby="media-${id}-name">
        <div class="media-card-head">
          <span class="media-kind" aria-hidden="true">${kindGlyph(entry.mediaKind)}</span>
          <div class="media-card-title">
            <p class="media-name" id="media-${id}-name">${escapeHtml(name)}</p>
            <p class="media-meta">${escapeHtml(mediaKindLabel(entry.mediaKind))} · ${source}</p>
          </div>
          <div class="media-badges">${roleBadges(entry)}</div>
        </div>

        <div class="media-grid">
          <div class="admin-field">
            <label for="media-${id}-title-es">Título en español</label>
            <input type="text" id="media-${id}-title-es" data-field="titleEs"
              aria-invalid="${invalid}" value="${escapeHtml(entry.draft.titleEs)}" />
          </div>
          <div class="admin-field">
            <label for="media-${id}-alt-es">Texto alternativo en español</label>
            <input type="text" id="media-${id}-alt-es" data-field="altTextEs"
              aria-invalid="${invalid}" value="${escapeHtml(entry.draft.altTextEs)}" />
          </div>
          <div class="admin-field">
            <label for="media-${id}-title-en">Title in English</label>
            <input type="text" id="media-${id}-title-en" data-field="titleEn"
              aria-invalid="${invalid}" value="${escapeHtml(entry.draft.titleEn)}" />
          </div>
          <div class="admin-field">
            <label for="media-${id}-alt-en">Alt text in English</label>
            <input type="text" id="media-${id}-alt-en" data-field="altTextEn"
              aria-invalid="${invalid}" value="${escapeHtml(entry.draft.altTextEn)}" />
          </div>
          <div class="admin-field">
            <label for="media-${id}-group">Grupo</label>
            <select id="media-${id}-group" data-field="groupId">
              ${groupOptions(entry.draft.groupId)}
            </select>
          </div>
        </div>

        <div class="media-actions">
          ${heroButton}
          ${coverButton}
          <button type="button" class="admin-button admin-button-quiet" data-action="delete-media">
            Eliminar archivo
          </button>
          <div class="media-status-box" id="media-${id}-status" role="status">${statusMarkup(
            entry.state,
            entry.error,
          )}</div>
        </div>
      </article>`;
  };

  const groupSection = (group: MediaGroupEntry): string => {
    const id = group.id;
    const invalid = group.state === 'error' ? 'true' : 'false';
    const items = mediaOfGroup(state, id);

    return `
      <section class="media-group" data-group="${id}" aria-labelledby="media-group-${id}-heading">
        <h3 class="media-group-title" id="media-group-${id}-heading">${headingMarkup(
          groupDisplayName(group.draft),
        )}</h3>

        <div class="media-grid">
          <div class="admin-field">
            <label for="media-group-${id}-name-es">Nombre del grupo en español</label>
            <input type="text" id="media-group-${id}-name-es" data-field="nameEs"
              aria-invalid="${invalid}" value="${escapeHtml(group.draft.nameEs)}" />
          </div>
          <div class="admin-field">
            <label for="media-group-${id}-name-en">Group name in English</label>
            <input type="text" id="media-group-${id}-name-en" data-field="nameEn"
              aria-invalid="${invalid}" value="${escapeHtml(group.draft.nameEn)}" />
          </div>
        </div>

        <div class="media-actions">
          <button type="button" class="admin-button admin-button-quiet" data-action="delete-group">
            Eliminar grupo
          </button>
          <div class="media-status-box" id="media-group-${id}-status" role="status">${statusMarkup(
            group.state,
            group.error,
          )}</div>
        </div>

        <div class="media-list">
          ${items.length === 0 ? '<p class="admin-muted">Este grupo aún no tiene archivos.</p>' : items.map(mediaCard).join('')}
        </div>
      </section>`;
  };

  const uploadQueueMarkup = (): string => {
    if (queue.length === 0) return '';

    const rows = queue
      .map((item) => {
        const label =
          item.status === 'error'
            ? escapeHtml(item.error ?? 'No se pudo subir.')
            : { pending: 'En espera', uploading: 'Subiendo…', done: 'Subido', error: '' }[
                item.status
              ];

        return `
          <li class="upload-item" data-status="${item.status}">
            <span class="upload-name">${escapeHtml(item.fileName)}</span>
            <span class="upload-size">${escapeHtml(formatFileSize(item.sizeBytes) ?? '')}</span>
            <span class="upload-state">${label}</span>
          </li>`;
      })
      .join('');

    const summary = summarizeUploads(queue);

    return `
      <div class="upload-queue-box">
        <p class="admin-muted" id="upload-summary">
          ${summary.done} de ${summary.total} subidos${summary.failed > 0 ? ` · ${summary.failed} con error` : ''}
        </p>
        <ul class="upload-queue" aria-live="polite" aria-labelledby="upload-summary">${rows}</ul>
      </div>`;
  };

  const kindOptions = (): string =>
    MEDIA_KINDS.map(
      (kind) =>
        `<option value="${kind}"${kind === 'image' ? ' selected' : ''}>${escapeHtml(
          mediaKindLabel(kind),
        )}</option>`,
    ).join('');

  const uploadPanel = (): string => `
    <section class="media-upload" aria-labelledby="media-upload-heading">
      <h3 id="media-upload-heading">Subir archivos</h3>

      <div class="media-grid">
        <div class="admin-field">
          <label for="upload-kind">Tipo de archivo</label>
          <select id="upload-kind">${kindOptions()}</select>
        </div>
        <div class="admin-field">
          <label for="upload-group">Grupo</label>
          <select id="upload-group">${groupOptions(null)}</select>
        </div>
      </div>

      <div class="media-dropzone" id="media-dropzone">
        <label class="admin-field" for="upload-input">
          Selecciona archivos o arrástralos aquí
          <input type="file" id="upload-input" multiple
            aria-describedby="upload-help" />
        </label>
        <p class="editor-help" id="upload-help">
          Puedes elegir varios a la vez. Cada archivo se sube por separado: si uno falla, los
          demás continúan.
        </p>
      </div>

      <div class="media-actions">
        <button type="button" class="admin-button admin-button-primary" id="upload-start"
          data-action="start-upload"${hasActiveUploads(queue) ? ' disabled' : ''}>
          ${queue.filter((item) => item.status === 'pending').length > 0 ? `Subir ${queue.filter((item) => item.status === 'pending').length} archivo(s)` : 'Subir archivos'}
        </button>
        <button type="button" class="admin-button" data-action="clear-queue">Limpiar lista</button>
      </div>

      ${uploadQueueMarkup()}
    </section>`;

  const youtubePanel = (): string => `
    <section class="media-youtube" aria-labelledby="media-youtube-heading">
      <h3 id="media-youtube-heading">Añadir vídeo de YouTube</h3>
      <p class="editor-help" id="youtube-help">
        Solo se guarda el identificador del vídeo. No se sube ningún archivo.
      </p>

      <div class="media-grid">
        <div class="admin-field">
          <label for="youtube-id">Identificador del vídeo</label>
          <input type="text" id="youtube-id" aria-describedby="youtube-help"
            maxlength="64" placeholder="dQw4w9WgXcQ" />
        </div>
        <div class="admin-field">
          <label for="youtube-group">Grupo</label>
          <select id="youtube-group">${groupOptions(null)}</select>
        </div>
        <div class="admin-field">
          <label for="youtube-title-es">Título en español</label>
          <input type="text" id="youtube-title-es" maxlength="500" />
        </div>
        <div class="admin-field">
          <label for="youtube-title-en">Title in English</label>
          <input type="text" id="youtube-title-en" maxlength="500" />
        </div>
      </div>

      <div class="media-actions">
        <button type="button" class="admin-button" data-action="add-youtube">Añadir vídeo</button>
      </div>
    </section>`;

  const render = (): void => {
    if (loadError !== null) {
      root.innerHTML = `
        <div class="admin-state admin-state-error">
          <p>${escapeHtml(loadError)}</p>
          <button type="button" class="admin-button" data-action="retry-media">Reintentar</button>
        </div>`;
      return;
    }

    const loose = ungroupedMedia(state);

    const ungroupedSection =
      loose.length === 0
        ? ''
        : `
      <section class="media-group media-group-loose" aria-labelledby="media-ungrouped-heading">
        <h3 class="media-group-title" id="media-ungrouped-heading">Sin grupo</h3>
        <div class="media-list">${loose.map(mediaCard).join('')}</div>
      </section>`;

    const emptyMarkup = isEmpty(state)
      ? `<p class="admin-muted" id="media-empty">${EMPTY_TEXT}</p>`
      : '';

    const errorMarkup =
      sectionError === null
        ? ''
        : `<p class="editor-error" id="media-error" role="alert">${escapeHtml(sectionError)}</p>`;

    root.innerHTML = `
      ${errorMarkup}
      ${emptyMarkup}
      ${state.groups.map(groupSection).join('')}
      ${ungroupedSection}
      <div class="media-toolbar">
        <button type="button" class="admin-button" data-action="add-media-group">Añadir grupo</button>
      </div>
      ${uploadPanel()}
      ${youtubePanel()}`;
  };

  /* ---------------------------------------------------------------------- */
  /* Utilidades                                                             */
  /* ---------------------------------------------------------------------- */

  const closestId = (element: HTMLElement, attribute: 'group' | 'media'): number | null => {
    const host = element.closest(`[data-${attribute}]`);
    if (host === null) return null;

    const value = Number((host as HTMLElement).dataset[attribute]);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };

  const focusField = (id: string): void => {
    byId<HTMLElement & { focus: () => void }>(id)?.focus();
  };

  const paintStatus = (
    containerId: string,
    entryState: EntityState,
    error: string | null,
  ): void => {
    const box = byId<HTMLElement>(containerId);
    if (box !== null) box.innerHTML = statusMarkup(entryState, error);
  };

  const selectValue = (id: string): string => byId<HTMLSelectElement>(id)?.value ?? '';

  const groupFromSelect = (id: string): number | null => {
    const raw = selectValue(id);
    return raw === '' ? null : Number(raw);
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

    registerAll();
    render();
  };

  /* ---------------------------------------------------------------------- */
  /* Grupos                                                                 */
  /* ---------------------------------------------------------------------- */

  const createGroup = async (button: HTMLButtonElement): Promise<void> => {
    button.disabled = true;
    const result = await api.createGroup();
    button.disabled = false;

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
    focusField(`media-group-${entry.id}-name-es`);
  };

  const deleteGroup = async (entry: MediaGroupEntry): Promise<void> => {
    if (!window.confirm(deleteGroupMessage(isGroupDirty(entry)))) return;

    const result = await api.deleteGroup(entry.id);

    if (result.ok) {
      // Sus archivos pasan a "Sin grupo": sus puertos siguen registrados.
      coordinator.unregister(mediaGroupPortKey(entry.id));
      removeGroup(state, entry.id);
      sectionError = null;
    } else {
      entry.state = 'error';
      entry.error = result.message;
    }

    render();
  };

  /* ---------------------------------------------------------------------- */
  /* Subida                                                                 */
  /* ---------------------------------------------------------------------- */

  const enqueue = (files: readonly File[]): void => {
    for (const file of files) {
      queueCounter += 1;
      const key = `upload-${queueCounter}`;
      pendingFiles.set(key, file);
      queue.push(createUploadItem(key, file));
    }

    render();
  };

  /**
   * Arranca la cola.
   *
   * `uploading` impide arrancarla dos veces: el boton ademas queda
   * deshabilitado mientras quede trabajo, asi que un doble clic no duplica
   * ninguna subida. El recorrido en si vive en `runUploadQueue`.
   */
  const startUploads = async (): Promise<void> => {
    if (uploading) return;

    const mediaKind = selectValue('upload-kind') as MediaKind;
    const groupId = groupFromSelect('upload-group');

    uploading = true;
    render();

    await runUploadQueue(queue, pendingFiles, {
      send: async (file) => {
        const result = await api.upload({ file, mediaKind, groupId });
        return result.ok
          ? { ok: true, media: result.data }
          : { ok: false, message: result.message };
      },

      onUploaded: (media) => {
        // El `File` se suelta al limpiar la lista, no aqui: la fila sigue
        // visible como "Subido" hasta que el administrador la retire.
        const entry = addMedia(state, media);
        registerMediaPort(entry.id);
      },

      onProgress: render,
    });

    uploading = false;
    render();
  };

  const clearQueue = (): void => {
    for (const item of queue) {
      if (item.status === 'done') pendingFiles.delete(item.key);
    }

    queue = clearFinishedUploads(queue);
    render();
  };

  /* ---------------------------------------------------------------------- */
  /* YouTube                                                                */
  /* ---------------------------------------------------------------------- */

  const addYoutube = async (button: HTMLButtonElement): Promise<void> => {
    const input = byId<HTMLInputElement>('youtube-id');
    const videoId = input?.value.trim() ?? '';

    if (videoId.length === 0) {
      sectionError = 'Escribe el identificador del vídeo de YouTube.';
      render();
      focusField('youtube-id');
      return;
    }

    const titleEs = byId<HTMLInputElement>('youtube-title-es')?.value ?? '';
    const titleEn = byId<HTMLInputElement>('youtube-title-en')?.value ?? '';
    const groupId = groupFromSelect('youtube-group');

    button.disabled = true;

    const result = await api.createYoutube({
      youtubeVideoId: videoId,
      groupId,
      ...(titleEs.trim().length === 0 ? {} : { titleEs }),
      ...(titleEn.trim().length === 0 ? {} : { titleEn }),
    });

    button.disabled = false;

    // `null` significa que ya habia una peticion en vuelo.
    if (result === null) return;

    if (!result.ok) {
      sectionError = result.message;
      render();
      return;
    }

    sectionError = null;
    const entry = addMedia(state, result.data);
    registerMediaPort(entry.id);
    render();
    focusField(`media-${entry.id}-title-es`);
  };

  /* ---------------------------------------------------------------------- */
  /* Roles y borrado                                                        */
  /* ---------------------------------------------------------------------- */

  const toggleRole = async (entry: MediaEntry, role: 'hero' | 'cover'): Promise<void> => {
    const next = role === 'hero' ? !entry.isHero : !entry.isCatalogCover;

    entry.state = 'saving';
    entry.error = null;
    paintStatus(`media-${entry.id}-status`, entry.state, entry.error);

    const result = await api.setRoles(
      entry.id,
      role === 'hero' ? { isHero: next } : { isCatalogCover: next },
    );

    if (result.ok) {
      /*
       * El servidor ya retiro el rol al anterior en la misma operacion; aqui
       * se refleja lo mismo para que no se vean dos a la vez.
       */
      if (role === 'hero') applyHero(state, entry.id, next);
      else applyCatalogCover(state, entry.id, next);

      entry.state = isMediaDirty(entry) ? 'dirty' : 'saved';
      sectionError = null;
    } else {
      entry.state = 'error';
      entry.error = result.message;
    }

    render();
  };

  const deleteMedia = async (entry: MediaEntry): Promise<void> => {
    if (!window.confirm(deleteMediaMessage(isMediaDirty(entry)))) return;

    const result = await api.deleteMedia(entry.id);

    if (result.ok) {
      coordinator.unregister(mediaPortKey(entry.id));
      removeMedia(state, entry.id);
      sectionError = null;
    } else {
      // Un panorama en uso por el recorrido 360 no se puede borrar todavia.
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
    const mediaId = closestId(target, 'media');

    if (mediaId !== null) {
      const entry = mediaById(mediaId);
      if (entry === undefined) return;

      if (field === 'groupId') {
        // Solo cambia el borrador: la tarjeta no se mueve hasta guardar.
        entry.draft.groupId = value === '' ? null : Number(value);
      } else if (field in entry.draft) {
        (entry.draft as unknown as Record<string, string>)[field] = value;
      }

      entry.state = isMediaDirty(entry) ? 'dirty' : 'saved';
      entry.error = null;
      paintStatus(`media-${entry.id}-status`, entry.state, entry.error);

      coordinator.notifyChange(mediaPortKey(entry.id));
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
    paintStatus(`media-group-${entry.id}-status`, entry.state, entry.error);

    const heading = byId<HTMLElement>(`media-group-${entry.id}-heading`);
    if (heading !== null) heading.innerHTML = headingMarkup(groupDisplayName(entry.draft));

    coordinator.notifyChange(mediaGroupPortKey(entry.id));
  };

  root.addEventListener('input', onEdit);
  root.addEventListener('change', (event) => {
    const target = event.target;

    // El selector de archivos no es un campo del modelo: alimenta la cola.
    if (target instanceof HTMLElement && target.id === 'upload-input') {
      const files = (target as HTMLInputElement).files;
      if (files !== null && files.length > 0) enqueue([...files]);
      return;
    }

    onEdit(event);
  });

  /*
   * Arrastrar y soltar. Solo para elegir archivos: la reordenacion no entra en
   * esta fase, y el selector nativo sigue siendo el camino con teclado.
   */
  root.addEventListener('dragover', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('#media-dropzone') === null) return;

    event.preventDefault();
    byId<HTMLElement>('media-dropzone')?.classList.add('is-dragging');
  });

  root.addEventListener('dragleave', () => {
    byId<HTMLElement>('media-dropzone')?.classList.remove('is-dragging');
  });

  root.addEventListener('drop', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('#media-dropzone') === null) return;

    event.preventDefault();
    byId<HTMLElement>('media-dropzone')?.classList.remove('is-dragging');

    const files = (event as DragEvent).dataTransfer?.files;
    if (files !== undefined && files.length > 0) enqueue([...files]);
  });

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    if (action === undefined) return;

    const button = target as HTMLButtonElement;
    const mediaId = closestId(target, 'media');
    const groupId = closestId(target, 'group');

    switch (action) {
      case 'retry-media':
        void load();
        break;

      case 'add-media-group':
        void createGroup(button);
        break;

      case 'delete-group': {
        const entry = groupId === null ? undefined : groupById(groupId);
        if (entry !== undefined) void deleteGroup(entry);
        break;
      }

      case 'start-upload':
        void startUploads();
        break;

      case 'clear-queue':
        clearQueue();
        break;

      case 'add-youtube':
        void addYoutube(button);
        break;

      case 'toggle-hero': {
        const entry = mediaId === null ? undefined : mediaById(mediaId);
        if (entry !== undefined) void toggleRole(entry, 'hero');
        break;
      }

      case 'toggle-cover': {
        const entry = mediaId === null ? undefined : mediaById(mediaId);
        if (entry !== undefined) void toggleRole(entry, 'cover');
        break;
      }

      case 'delete-media': {
        const entry = mediaId === null ? undefined : mediaById(mediaId);
        if (entry !== undefined) void deleteMedia(entry);
        break;
      }

      default:
        break;
    }
  });

  void load();

  return {
    dispose: () => {
      unregisterAll();
      pendingFiles = new Map();
      queue = [];
    },
  };
}
