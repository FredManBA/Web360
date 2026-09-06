/**
 * Estado de la seccion de multimedia.
 *
 * Mismo planteamiento que las caracteristicas: funciones puras, y cada entidad
 * lleva lo que hay en el servidor (`loaded`) y lo que hay en pantalla
 * (`draft`), de modo que "cambios sin guardar" se calcula comparando.
 *
 * Lo unico propio de multimedia es la cola de subidas, que no es estado
 * persistido sino el progreso de un trabajo en curso.
 */

import type { Locale, MediaKind, SourceProvider } from '../../domain/vocabularies';

/** Mismos estados que usa el resto del editor. */
export type EntityState = 'saved' | 'dirty' | 'saving' | 'error';

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

export interface MediaGroupDraft {
  nameEs: string;
  nameEn: string;
}

export interface MediaGroupEntry {
  id: number;
  sortOrder: number;
  loaded: MediaGroupDraft;
  draft: MediaGroupDraft;
  state: EntityState;
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/* Archivos                                                                   */
/* -------------------------------------------------------------------------- */

/** Lo editable de un archivo. El resto son datos tecnicos de solo lectura. */
export interface MediaDraft {
  groupId: number | null;
  titleEs: string;
  altTextEs: string;
  captionEs: string;
  titleEn: string;
  altTextEn: string;
  captionEn: string;
}

export interface MediaEntry {
  id: number;
  /** Grupo persistido; el del borrador puede diferir hasta guardar. */
  groupId: number | null;
  sortOrder: number;

  mediaKind: MediaKind;
  sourceProvider: SourceProvider;
  objectKey: string | null;
  youtubeVideoId: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;

  isHero: boolean;
  isCatalogCover: boolean;

  loaded: MediaDraft;
  draft: MediaDraft;
  state: EntityState;
  error: string | null;
}

export interface MediaEditorState {
  groups: MediaGroupEntry[];
  media: MediaEntry[];
}

/* -------------------------------------------------------------------------- */
/* Carga desde la API                                                         */
/* -------------------------------------------------------------------------- */

export interface ApiMediaTranslation {
  title: string | null;
  altText: string | null;
  caption: string | null;
}

export interface ApiMedia {
  id: number;
  groupId: number | null;
  sortOrder: number;
  mediaKind: MediaKind;
  sourceProvider: SourceProvider;
  objectKey: string | null;
  youtubeVideoId: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  isHero: boolean;
  isCatalogCover: boolean;
  translations: Partial<Record<Locale, ApiMediaTranslation>>;
}

export interface ApiMediaGroup {
  id: number;
  sortOrder: number;
  names: Partial<Record<Locale, string | null>>;
  media: ApiMedia[];
}

export interface ApiMediaView {
  groups: ApiMediaGroup[];
  ungrouped: ApiMedia[];
  heroId: number | null;
  catalogCoverId: number | null;
}

function text(value: string | null | undefined): string {
  return value ?? '';
}

export function mediaDraftFromApi(media: ApiMedia): MediaDraft {
  return {
    groupId: media.groupId,
    titleEs: text(media.translations.es?.title),
    altTextEs: text(media.translations.es?.altText),
    captionEs: text(media.translations.es?.caption),
    titleEn: text(media.translations.en?.title),
    altTextEn: text(media.translations.en?.altText),
    captionEn: text(media.translations.en?.caption),
  };
}

/**
 * Construye el estado a partir de la respuesta de la API.
 *
 * Se conserva EXACTAMENTE el orden recibido: el servidor ya ordena por
 * `sortOrder ASC, id ASC` y aqui no se reordena nada.
 */
export function stateFromApi(view: ApiMediaView): MediaEditorState {
  const groups: MediaGroupEntry[] = view.groups.map((group) => {
    const draft: MediaGroupDraft = {
      nameEs: text(group.names.es),
      nameEn: text(group.names.en),
    };

    return {
      id: group.id,
      sortOrder: group.sortOrder,
      loaded: draft,
      draft: { ...draft },
      state: 'saved',
      error: null,
    };
  });

  const toEntry = (media: ApiMedia): MediaEntry => {
    const draft = mediaDraftFromApi(media);

    return {
      id: media.id,
      groupId: media.groupId,
      sortOrder: media.sortOrder,

      mediaKind: media.mediaKind,
      sourceProvider: media.sourceProvider,
      objectKey: media.objectKey,
      youtubeVideoId: media.youtubeVideoId,
      mimeType: media.mimeType,
      fileSizeBytes: media.fileSizeBytes,

      isHero: media.isHero,
      isCatalogCover: media.isCatalogCover,

      loaded: draft,
      draft: { ...draft },
      state: 'saved',
      error: null,
    };
  };

  const media: MediaEntry[] = [
    ...view.groups.flatMap((group) => group.media.map(toEntry)),
    ...view.ungrouped.map(toEntry),
  ];

  return { groups, media };
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

export function mediaOfGroup(state: MediaEditorState, groupId: number): MediaEntry[] {
  return state.media.filter((item) => item.groupId === groupId);
}

export function ungroupedMedia(state: MediaEditorState): MediaEntry[] {
  return state.media.filter((item) => item.groupId === null);
}

export function isEmpty(state: MediaEditorState): boolean {
  return state.groups.length === 0 && state.media.length === 0;
}

export function isGroupDirty(entry: MediaGroupEntry): boolean {
  return entry.draft.nameEs !== entry.loaded.nameEs || entry.draft.nameEn !== entry.loaded.nameEn;
}

export function isMediaDirty(entry: MediaEntry): boolean {
  const { draft, loaded } = entry;

  return (
    draft.groupId !== loaded.groupId ||
    draft.titleEs !== loaded.titleEs ||
    draft.altTextEs !== loaded.altTextEs ||
    draft.captionEs !== loaded.captionEs ||
    draft.titleEn !== loaded.titleEn ||
    draft.altTextEn !== loaded.altTextEn ||
    draft.captionEn !== loaded.captionEn
  );
}

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

export function heroId(state: MediaEditorState): number | null {
  return state.media.find((item) => item.isHero)?.id ?? null;
}

export function catalogCoverId(state: MediaEditorState): number | null {
  return state.media.find((item) => item.isCatalogCover)?.id ?? null;
}

/**
 * Aplica el rol en local despues de que el servidor lo confirme.
 *
 * Retira el rol de quien lo tuviera antes: solo puede haber uno por
 * propiedad, igual que garantizan los indices parciales del esquema.
 */
export function applyHero(state: MediaEditorState, mediaId: number, value: boolean): void {
  for (const item of state.media) {
    item.isHero = value && item.id === mediaId;
  }
}

export function applyCatalogCover(state: MediaEditorState, mediaId: number, value: boolean): void {
  for (const item of state.media) {
    item.isCatalogCover = value && item.id === mediaId;
  }
}

/* -------------------------------------------------------------------------- */
/* Nombre visible                                                             */
/* -------------------------------------------------------------------------- */

export interface GroupNameView {
  text: string;
  /** Cierto cuando se muestra el ingles porque falta el espanol. */
  missingSpanish: boolean;
}

const UNNAMED_GROUP = 'Grupo sin nombre';

/** Espanol preferido, ingles de respaldo, y si no hay ninguno un texto neutro. */
export function groupDisplayName(draft: MediaGroupDraft): GroupNameView {
  const es = draft.nameEs.trim();
  if (es.length > 0) return { text: es, missingSpanish: false };

  const en = draft.nameEn.trim();
  if (en.length > 0) return { text: en, missingSpanish: true };

  return { text: UNNAMED_GROUP, missingSpanish: false };
}

const KIND_LABELS: Record<MediaKind, string> = {
  image: 'Imagen',
  video: 'Vídeo',
  document: 'Documento',
  panorama: 'Panorama 360°',
};

export function mediaKindLabel(kind: MediaKind): string {
  return KIND_LABELS[kind];
}

/**
 * Como se llama un archivo en pantalla.
 *
 * Todavia no hay URL publica ni miniatura, asi que se identifica por su titulo
 * y, a falta de titulo, por algo reconocible: el final de la clave de R2 o el
 * identificador de YouTube.
 */
export function mediaDisplayName(entry: MediaEntry): string {
  const title = entry.draft.titleEs.trim() || entry.draft.titleEn.trim();
  if (title.length > 0) return title;

  if (entry.youtubeVideoId !== null) return `YouTube ${entry.youtubeVideoId}`;

  const tail = entry.objectKey?.split('/').pop();
  return tail !== undefined && tail.length > 0
    ? tail
    : `${mediaKindLabel(entry.mediaKind)} sin título`;
}

/** Tamano legible. `null` cuando no se conoce, como en YouTube. */
export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null) return null;

  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/* -------------------------------------------------------------------------- */
/* Parches                                                                    */
/* -------------------------------------------------------------------------- */

export function groupPatch(entry: MediaGroupEntry): Record<string, string> {
  return { nameEs: entry.draft.nameEs, nameEn: entry.draft.nameEn };
}

/** Cuerpo del PATCH de un archivo. No incluye tipo, proveedor ni roles. */
export function mediaPatch(entry: MediaEntry): Record<string, unknown> {
  return {
    groupId: entry.draft.groupId,
    titleEs: entry.draft.titleEs,
    altTextEs: entry.draft.altTextEs,
    captionEs: entry.draft.captionEs,
    titleEn: entry.draft.titleEn,
    altTextEn: entry.draft.altTextEn,
    captionEn: entry.draft.captionEn,
  };
}

/* -------------------------------------------------------------------------- */
/* Mutaciones                                                                 */
/* -------------------------------------------------------------------------- */

export function markGroupSaved(entry: MediaGroupEntry, snapshot: MediaGroupDraft): void {
  entry.loaded = { ...snapshot };
  entry.state = isGroupDirty(entry) ? 'dirty' : 'saved';
  entry.error = null;
}

export function markMediaSaved(entry: MediaEntry, snapshot: MediaDraft, sortOrder?: number): void {
  entry.loaded = { ...snapshot };
  // El movimiento entre grupos solo se consolida cuando el PATCH va bien.
  entry.groupId = snapshot.groupId;
  if (sortOrder !== undefined) entry.sortOrder = sortOrder;
  entry.state = isMediaDirty(entry) ? 'dirty' : 'saved';
  entry.error = null;
}

/**
 * Elimina el grupo del estado.
 *
 * Sus archivos NO se borran: pasan a "Sin grupo", igual que hace la base con
 * `ON DELETE SET NULL`.
 */
export function removeGroup(state: MediaEditorState, groupId: number): void {
  state.groups = state.groups.filter((group) => group.id !== groupId);

  for (const item of state.media) {
    if (item.groupId === groupId) item.groupId = null;
    if (item.draft.groupId === groupId) item.draft.groupId = null;
    if (item.loaded.groupId === groupId) item.loaded.groupId = null;
  }
}

export function removeMedia(state: MediaEditorState, mediaId: number): void {
  state.media = state.media.filter((item) => item.id !== mediaId);
}

export function addGroup(
  state: MediaEditorState,
  group: { id: number; sortOrder: number },
): MediaGroupEntry {
  const empty: MediaGroupDraft = { nameEs: '', nameEn: '' };

  const entry: MediaGroupEntry = {
    id: group.id,
    sortOrder: group.sortOrder,
    loaded: empty,
    draft: { ...empty },
    state: 'saved',
    error: null,
  };

  state.groups.push(entry);
  return entry;
}

/** Anade al estado un archivo recien creado por la API. */
export function addMedia(state: MediaEditorState, media: ApiMedia): MediaEntry {
  const draft = mediaDraftFromApi(media);

  const entry: MediaEntry = {
    id: media.id,
    groupId: media.groupId,
    sortOrder: media.sortOrder,

    mediaKind: media.mediaKind,
    sourceProvider: media.sourceProvider,
    objectKey: media.objectKey,
    youtubeVideoId: media.youtubeVideoId,
    mimeType: media.mimeType,
    fileSizeBytes: media.fileSizeBytes,

    isHero: media.isHero,
    isCatalogCover: media.isCatalogCover,

    loaded: draft,
    draft: { ...draft },
    state: 'saved',
    error: null,
  };

  state.media.push(entry);
  return entry;
}

/* -------------------------------------------------------------------------- */
/* Cola de subidas                                                            */
/* -------------------------------------------------------------------------- */

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface UploadItem {
  /** Identificador local; no tiene nada que ver con el de la base. */
  key: string;
  fileName: string;
  sizeBytes: number;
  status: UploadStatus;
  error: string | null;
}

export function createUploadItem(key: string, file: { name: string; size: number }): UploadItem {
  return { key, fileName: file.name, sizeBytes: file.size, status: 'pending', error: null };
}

/** Cierto mientras quede algun archivo por subir o subiendose. */
export function hasActiveUploads(queue: readonly UploadItem[]): boolean {
  return queue.some((item) => item.status === 'pending' || item.status === 'uploading');
}

export interface UploadSummary {
  total: number;
  done: number;
  failed: number;
}

export function summarizeUploads(queue: readonly UploadItem[]): UploadSummary {
  return {
    total: queue.length,
    done: queue.filter((item) => item.status === 'done').length,
    failed: queue.filter((item) => item.status === 'error').length,
  };
}

/**
 * Quita de la cola lo que ya termino bien.
 *
 * Los fallos se quedan a la vista: son lo unico que el administrador todavia
 * tiene que atender.
 */
export function clearFinishedUploads(queue: readonly UploadItem[]): UploadItem[] {
  return queue.filter((item) => item.status !== 'done');
}

export type UploadAttempt = { ok: true; media: ApiMedia } | { ok: false; message: string };

export interface UploadRunner {
  /** Sube un archivo. Cada llamada es independiente de las demas. */
  send: (file: File) => Promise<UploadAttempt>;
  /** Se anota lo que si llego a subirse, en el momento en que llega. */
  onUploaded: (media: ApiMedia) => void;
  /** Permite repintar el progreso entre archivo y archivo. */
  onProgress: () => void;
}

/**
 * Procesa la cola de subidas.
 *
 * En serie a proposito: cada archivo lleva su propia peticion, no se satura la
 * conexion y el resultado de uno no afecta al siguiente. Un fallo NO detiene
 * la cola ni deshace lo ya subido; se queda anotado en su fila.
 */
export async function runUploadQueue(
  queue: UploadItem[],
  files: ReadonlyMap<string, File>,
  runner: UploadRunner,
): Promise<void> {
  for (const item of queue) {
    if (item.status !== 'pending') continue;

    const file = files.get(item.key);

    if (file === undefined) {
      item.status = 'error';
      item.error = 'El archivo ya no está disponible.';
      runner.onProgress();
      continue;
    }

    item.status = 'uploading';
    runner.onProgress();

    const attempt = await runner.send(file);

    if (attempt.ok) {
      item.status = 'done';
      item.error = null;
      runner.onUploaded(attempt.media);
    } else {
      item.status = 'error';
      item.error = attempt.message;
    }

    runner.onProgress();
  }
}
