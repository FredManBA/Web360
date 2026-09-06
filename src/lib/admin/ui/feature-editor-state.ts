/**
 * Estado de la seccion de caracteristicas.
 *
 * Funciones puras: cada grupo y cada caracteristica llevan lo cargado y lo
 * que hay en pantalla, de modo que "cambios sin guardar" se calcula
 * comparando, sin DOM y sin banderas sueltas.
 *
 * Pensado para que la Fase 3C-3 pueda conectar estos estados al coordinador
 * global sin rehacer la UI: cada entidad ya expone su estado y su parche.
 */

import type { Locale } from '../../domain/vocabularies';

/** Mismos estados que usa el resto del editor. */
export type EntityState = 'saved' | 'dirty' | 'saving' | 'error';

export interface GroupDraft {
  nameEs: string;
  nameEn: string;
}

export interface FeatureDraft {
  groupId: number | null;
  labelEs: string;
  valueEs: string;
  labelEn: string;
  valueEn: string;
}

export interface GroupEntry {
  id: number;
  sortOrder: number;
  /** Lo que hay en el servidor. */
  loaded: GroupDraft;
  /** Lo que hay en pantalla. */
  draft: GroupDraft;
  state: EntityState;
  error: string | null;
}

export interface FeatureEntry {
  id: number;
  sortOrder: number;
  /** Grupo persistido; el del borrador puede diferir hasta guardar. */
  groupId: number | null;
  loaded: FeatureDraft;
  draft: FeatureDraft;
  state: EntityState;
  error: string | null;
}

export interface FeatureEditorState {
  groups: GroupEntry[];
  features: FeatureEntry[];
}

/* -------------------------------------------------------------------------- */
/* Carga desde la API                                                         */
/* -------------------------------------------------------------------------- */

export interface ApiTranslation {
  label: string | null;
  value: string | null;
}

export interface ApiFeature {
  id: number;
  groupId: number | null;
  sortOrder: number;
  translations: Partial<Record<Locale, ApiTranslation>>;
}

export interface ApiGroup {
  id: number;
  sortOrder: number;
  names: Partial<Record<Locale, string | null>>;
  features: ApiFeature[];
}

export interface ApiFeaturesView {
  groups: ApiGroup[];
  ungrouped: ApiFeature[];
}

function text(value: string | null | undefined): string {
  return value ?? '';
}

export function groupDraftFromApi(names: Partial<Record<Locale, string | null>>): GroupDraft {
  return { nameEs: text(names.es), nameEn: text(names.en) };
}

export function featureDraftFromApi(feature: ApiFeature): FeatureDraft {
  return {
    groupId: feature.groupId,
    labelEs: text(feature.translations.es?.label),
    valueEs: text(feature.translations.es?.value),
    labelEn: text(feature.translations.en?.label),
    valueEn: text(feature.translations.en?.value),
  };
}

/**
 * Construye el estado a partir de la respuesta de la API.
 *
 * Se conserva EXACTAMENTE el orden recibido: el servidor ya ordena por
 * `sortOrder ASC, id ASC` y aqui no se reordena nada.
 */
export function stateFromApi(view: ApiFeaturesView): FeatureEditorState {
  const groups: GroupEntry[] = view.groups.map((group) => {
    const draft = groupDraftFromApi(group.names);
    return {
      id: group.id,
      sortOrder: group.sortOrder,
      loaded: draft,
      draft: { ...draft },
      state: 'saved',
      error: null,
    };
  });

  const toEntry = (feature: ApiFeature): FeatureEntry => {
    const draft = featureDraftFromApi(feature);
    return {
      id: feature.id,
      sortOrder: feature.sortOrder,
      groupId: feature.groupId,
      loaded: draft,
      draft: { ...draft },
      state: 'saved',
      error: null,
    };
  };

  const features: FeatureEntry[] = [
    ...view.groups.flatMap((group) => group.features.map(toEntry)),
    ...view.ungrouped.map(toEntry),
  ];

  return { groups, features };
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

/** Caracteristicas ya persistidas dentro de un grupo. */
export function featuresOfGroup(state: FeatureEditorState, groupId: number): FeatureEntry[] {
  return state.features.filter((feature) => feature.groupId === groupId);
}

export function ungroupedFeatures(state: FeatureEditorState): FeatureEntry[] {
  return state.features.filter((feature) => feature.groupId === null);
}

export function isEmpty(state: FeatureEditorState): boolean {
  return state.groups.length === 0 && state.features.length === 0;
}

export function isGroupDirty(entry: GroupEntry): boolean {
  return entry.draft.nameEs !== entry.loaded.nameEs || entry.draft.nameEn !== entry.loaded.nameEn;
}

export function isFeatureDirty(entry: FeatureEntry): boolean {
  const { draft, loaded } = entry;

  return (
    draft.groupId !== loaded.groupId ||
    draft.labelEs !== loaded.labelEs ||
    draft.valueEs !== loaded.valueEs ||
    draft.labelEn !== loaded.labelEn ||
    draft.valueEn !== loaded.valueEn
  );
}

/**
 * Queda trabajo por guardar en esta seccion.
 *
 * El editor lo suma a lo que ya vigila el coordinador global, para que
 * `beforeunload` avise tambien por las caracteristicas.
 */
export function hasPendingFeatureWork(state: FeatureEditorState): boolean {
  const pending = (entryState: EntityState): boolean => entryState !== 'saved';

  return (
    state.groups.some((group) => pending(group.state)) ||
    state.features.some((feature) => pending(feature.state))
  );
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
export function groupDisplayName(draft: GroupDraft): GroupNameView {
  const es = draft.nameEs.trim();
  if (es.length > 0) return { text: es, missingSpanish: false };

  const en = draft.nameEn.trim();
  if (en.length > 0) return { text: en, missingSpanish: true };

  return { text: UNNAMED_GROUP, missingSpanish: false };
}

/* -------------------------------------------------------------------------- */
/* Parches                                                                    */
/* -------------------------------------------------------------------------- */

/** Cuerpo del PATCH de grupo: solo campos que la API admite. */
export function groupPatch(entry: GroupEntry): Record<string, string> {
  return { nameEs: entry.draft.nameEs, nameEn: entry.draft.nameEn };
}

/** Cuerpo del PATCH de caracteristica. `sortOrder` no se toca desde la UI. */
export function featurePatch(entry: FeatureEntry): Record<string, unknown> {
  return {
    groupId: entry.draft.groupId,
    labelEs: entry.draft.labelEs,
    valueEs: entry.draft.valueEs,
    labelEn: entry.draft.labelEn,
    valueEn: entry.draft.valueEn,
  };
}

/* -------------------------------------------------------------------------- */
/* Validacion local                                                           */
/* -------------------------------------------------------------------------- */

/** Mismo limite que aceptan los endpoints de caracteristicas. */
export const MAX_TEXT_LENGTH = 500;

export const TOO_LONG_MESSAGE = `El texto no puede pasar de ${MAX_TEXT_LENGTH} caracteres.`;

function tooLong(value: string): boolean {
  return value.trim().length > MAX_TEXT_LENGTH;
}

/** Devuelve los campos demasiado largos, vacio si todo cabe. */
export function validateGroupDraft(draft: GroupDraft): string[] {
  return (['nameEs', 'nameEn'] as const).filter((field) => tooLong(draft[field]));
}

export function validateFeatureDraft(draft: FeatureDraft): string[] {
  return (['labelEs', 'valueEs', 'labelEn', 'valueEn'] as const).filter((field) =>
    tooLong(draft[field]),
  );
}

/* -------------------------------------------------------------------------- */
/* Mutaciones                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Tras guardar, la INSTANTANEA enviada pasa a ser lo persistido.
 *
 * Se recibe la instantanea y no se lee `draft`: si el usuario siguio
 * escribiendo durante la peticion, esos cambios posteriores deben seguir
 * pendientes. Por eso el estado se recalcula comparando, en vez de fijarlo a
 * "guardado" sin mirar.
 */
export function markGroupSaved(entry: GroupEntry, snapshot: GroupDraft): void {
  entry.loaded = { ...snapshot };
  entry.state = isGroupDirty(entry) ? 'dirty' : 'saved';
  entry.error = null;
}

export function markFeatureSaved(
  entry: FeatureEntry,
  snapshot: FeatureDraft,
  sortOrder?: number,
): void {
  entry.loaded = { ...snapshot };
  // El movimiento entre grupos solo se consolida cuando el PATCH va bien.
  entry.groupId = snapshot.groupId;
  // El servidor manda sobre la posicion tras un cambio de grupo.
  if (sortOrder !== undefined) entry.sortOrder = sortOrder;
  entry.state = isFeatureDirty(entry) ? 'dirty' : 'saved';
  entry.error = null;
}

/**
 * Elimina el grupo del estado.
 *
 * Sus caracteristicas NO se borran: pasan a "Sin grupo", igual que hace la
 * base con `ON DELETE SET NULL`.
 */
export function removeGroup(state: FeatureEditorState, groupId: number): void {
  state.groups = state.groups.filter((group) => group.id !== groupId);

  for (const feature of state.features) {
    if (feature.groupId === groupId) feature.groupId = null;
    if (feature.draft.groupId === groupId) feature.draft.groupId = null;
    if (feature.loaded.groupId === groupId) feature.loaded.groupId = null;
  }
}

export function removeFeature(state: FeatureEditorState, featureId: number): void {
  state.features = state.features.filter((feature) => feature.id !== featureId);
}

export function addGroup(
  state: FeatureEditorState,
  group: { id: number; sortOrder: number },
): GroupEntry {
  const empty: GroupDraft = { nameEs: '', nameEn: '' };
  const entry: GroupEntry = {
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

export function addFeature(
  state: FeatureEditorState,
  feature: { id: number; sortOrder: number; groupId: number | null },
): FeatureEntry {
  const empty: FeatureDraft = {
    groupId: feature.groupId,
    labelEs: '',
    valueEs: '',
    labelEn: '',
    valueEn: '',
  };

  const entry: FeatureEntry = {
    id: feature.id,
    sortOrder: feature.sortOrder,
    groupId: feature.groupId,
    loaded: empty,
    draft: { ...empty },
    state: 'saved',
    error: null,
  };

  state.features.push(entry);
  return entry;
}

/* -------------------------------------------------------------------------- */
/* Orden                                                                      */
/* -------------------------------------------------------------------------- */

export type MoveDirection = 'up' | 'down';

export interface MoveAvailability {
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/**
 * Que movimientos tienen sentido para un elemento.
 *
 * Es lo que decide si `Subir` y `Bajar` salen deshabilitados: el primero no
 * puede subir y el ultimo no puede bajar. Un elemento que no esta en la lista
 * no puede moverse en ninguna direccion.
 */
export function moveAvailability(ids: readonly number[], id: number): MoveAvailability {
  const position = ids.indexOf(id);
  if (position === -1) return { canMoveUp: false, canMoveDown: false };

  return { canMoveUp: position > 0, canMoveDown: position < ids.length - 1 };
}

/** Ids de los grupos en el orden en que se ven. */
export function groupOrder(state: FeatureEditorState): number[] {
  return state.groups.map((group) => group.id);
}

/** Ids de las caracteristicas de un ambito, en el orden en que se ven. */
export function featureOrder(state: FeatureEditorState, groupId: number | null): number[] {
  return state.features.filter((f) => f.groupId === groupId).map((f) => f.id);
}

/**
 * Calcula la lista resultante de mover un id una posicion.
 *
 * Devuelve `null` en los extremos: no hay nada que enviar y el boton
 * correspondiente ya deberia estar deshabilitado.
 */
function swapped(ids: readonly number[], id: number, direction: MoveDirection): number[] | null {
  const from = ids.indexOf(id);
  if (from === -1) return null;

  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return null;

  const next = [...ids];
  const moved = next[from];
  const displaced = next[to];
  if (moved === undefined || displaced === undefined) return null;

  next[from] = displaced;
  next[to] = moved;
  return next;
}

/** Nuevo orden de grupos tras mover uno. No toca el estado. */
export function moveGroup(
  state: FeatureEditorState,
  groupId: number,
  direction: MoveDirection,
): number[] | null {
  return swapped(groupOrder(state), groupId, direction);
}

/**
 * Nuevo orden dentro del ambito de la caracteristica. No toca el estado.
 *
 * El ambito es su grupo ACTUAL (el persistido) o "Sin grupo": moverse entre
 * grupos es otra operacion distinta, la del selector.
 */
export function moveFeature(
  state: FeatureEditorState,
  featureId: number,
  direction: MoveDirection,
): { groupId: number | null; featureIds: number[] } | null {
  const entry = state.features.find((feature) => feature.id === featureId);
  if (entry === undefined) return null;

  const featureIds = swapped(featureOrder(state, entry.groupId), featureId, direction);
  return featureIds === null ? null : { groupId: entry.groupId, featureIds };
}

/** Aplica el orden ya confirmado por el servidor. */
export function applyGroupOrder(state: FeatureEditorState, groupIds: readonly number[]): void {
  const byId = new Map(state.groups.map((group) => [group.id, group]));

  const ordered: GroupEntry[] = [];
  groupIds.forEach((id, index) => {
    const entry = byId.get(id);
    if (entry === undefined) return;

    entry.sortOrder = index;
    ordered.push(entry);
  });

  // Lo que no venga en la lista se conserva al final, nunca se pierde.
  for (const group of state.groups) {
    if (!groupIds.includes(group.id)) ordered.push(group);
  }

  state.groups = ordered;
}

/**
 * Aplica el orden de un ambito sin tocar los demas.
 *
 * Se reescriben solo las posiciones que ocupaban esas caracteristicas dentro
 * del array general, de modo que el resto de grupos queda intacto.
 */
export function applyFeatureOrder(
  state: FeatureEditorState,
  groupId: number | null,
  featureIds: readonly number[],
): void {
  const positions: number[] = [];
  state.features.forEach((feature, index) => {
    if (feature.groupId === groupId) positions.push(index);
  });

  const byId = new Map(state.features.map((feature) => [feature.id, feature]));

  featureIds.forEach((id, index) => {
    const entry = byId.get(id);
    const position = positions[index];
    if (entry === undefined || position === undefined) return;

    entry.sortOrder = index;
    state.features[position] = entry;
  });
}
