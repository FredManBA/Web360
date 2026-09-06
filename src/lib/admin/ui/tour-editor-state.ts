/**
 * Estado del editor del recorrido 360.
 *
 * Mismo planteamiento que el resto del panel: funciones puras, y cada entidad
 * lleva lo cargado (`loaded`) y lo que hay en pantalla (`draft`), de modo que
 * "cambios sin guardar" se calcula comparando.
 *
 * Lo propio de esta seccion es que hay un nodo SELECCIONADO: la lista y el
 * visor miran siempre al mismo, y esa eleccion es estado de la pantalla, no
 * algo que se guarde.
 */

import type { Locale, MediaKind } from '../../domain/vocabularies';

export type EntityState = 'saved' | 'dirty' | 'saving' | 'error';

/* -------------------------------------------------------------------------- */
/* Nodos y enlaces                                                            */
/* -------------------------------------------------------------------------- */

export interface NodeDraft {
  nameEs: string;
  nameEn: string;
}

export interface LinkDraft {
  yaw: number;
  pitch: number;
}

export interface LinkEntry {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  sortOrder: number;
  loaded: LinkDraft;
  draft: LinkDraft;
  state: EntityState;
  error: string | null;
}

export interface NodeEntry {
  id: number;
  sortOrder: number;
  isStart: boolean;

  /** Panorama en el que se apoya. `null` si el archivo ya no esta. */
  panoramaId: number | null;

  loaded: NodeDraft;
  draft: NodeDraft;
  state: EntityState;
  error: string | null;

  links: LinkEntry[];
}

export interface TourEditorState {
  nodes: NodeEntry[];
  /** Nodo que se esta mirando. `null` cuando el recorrido esta vacio. */
  selectedNodeId: number | null;
}

/* -------------------------------------------------------------------------- */
/* Carga desde la API                                                         */
/* -------------------------------------------------------------------------- */

export interface ApiTourLink {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  yaw: number;
  pitch: number;
  sortOrder: number;
}

export interface ApiTourNode {
  id: number;
  sortOrder: number;
  isStart: boolean;
  panorama: { id: number; mediaKind: MediaKind } | null;
  names: Partial<Record<Locale, string | null>>;
  links: ApiTourLink[];
}

export interface ApiTourView {
  nodes: ApiTourNode[];
  startNodeId: number | null;
}

function text(value: string | null | undefined): string {
  return value ?? '';
}

function toLinkEntry(link: ApiTourLink): LinkEntry {
  const draft: LinkDraft = { yaw: link.yaw, pitch: link.pitch };

  return {
    id: link.id,
    fromNodeId: link.fromNodeId,
    toNodeId: link.toNodeId,
    sortOrder: link.sortOrder,
    loaded: draft,
    draft: { ...draft },
    state: 'saved',
    error: null,
  };
}

/**
 * Construye el estado a partir de la respuesta de la API.
 *
 * Se conserva EXACTAMENTE el orden recibido. La seleccion se mantiene si el
 * nodo sigue existiendo; si no, se cae al primero, que es lo que el usuario
 * espera ver despues de borrar el que estaba mirando.
 */
export function stateFromApi(
  view: ApiTourView,
  previousSelection?: number | null,
): TourEditorState {
  const nodes: NodeEntry[] = view.nodes.map((node) => {
    const draft: NodeDraft = { nameEs: text(node.names.es), nameEn: text(node.names.en) };

    return {
      id: node.id,
      sortOrder: node.sortOrder,
      isStart: node.isStart,
      panoramaId: node.panorama?.id ?? null,
      loaded: draft,
      draft: { ...draft },
      state: 'saved',
      error: null,
      links: node.links.map(toLinkEntry),
    };
  });

  const stillThere =
    previousSelection !== undefined &&
    previousSelection !== null &&
    nodes.some((node) => node.id === previousSelection);

  return {
    nodes,
    selectedNodeId: stillThere ? previousSelection : (nodes[0]?.id ?? null),
  };
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

export function isEmpty(state: TourEditorState): boolean {
  return state.nodes.length === 0;
}

export function nodeById(state: TourEditorState, nodeId: number): NodeEntry | undefined {
  return state.nodes.find((node) => node.id === nodeId);
}

export function selectedNode(state: TourEditorState): NodeEntry | undefined {
  return state.selectedNodeId === null ? undefined : nodeById(state, state.selectedNodeId);
}

export function startNodeId(state: TourEditorState): number | null {
  return state.nodes.find((node) => node.isStart)?.id ?? null;
}

export function isNodeDirty(entry: NodeEntry): boolean {
  return entry.draft.nameEs !== entry.loaded.nameEs || entry.draft.nameEn !== entry.loaded.nameEn;
}

export function isLinkDirty(entry: LinkEntry): boolean {
  return entry.draft.yaw !== entry.loaded.yaw || entry.draft.pitch !== entry.loaded.pitch;
}

/** Nodos a los que TODAVIA se puede enlazar desde el seleccionado. */
export function linkTargets(state: TourEditorState, fromNodeId: number): NodeEntry[] {
  const from = nodeById(state, fromNodeId);
  if (from === undefined) return [];

  const already = new Set(from.links.map((link) => link.toNodeId));

  // Ni consigo mismo ni repetido: las dos reglas que la API tambien aplica.
  return state.nodes.filter((node) => node.id !== fromNodeId && !already.has(node.id));
}

/** Panoramas de la propiedad que aun no sostienen ningun nodo. */
export interface AvailablePanorama {
  id: number;
  label: string;
}

export function availablePanoramas(
  state: TourEditorState,
  panoramas: readonly AvailablePanorama[],
): AvailablePanorama[] {
  const used = new Set(state.nodes.map((node) => node.panoramaId));

  return panoramas.filter((panorama) => !used.has(panorama.id));
}

/* -------------------------------------------------------------------------- */
/* Nombre visible                                                             */
/* -------------------------------------------------------------------------- */

export interface NodeNameView {
  text: string;
  /** Cierto cuando se muestra el ingles porque falta el espanol. */
  missingSpanish: boolean;
}

/** Espanol preferido, ingles de respaldo, y si no hay ninguno un texto neutro. */
export function nodeDisplayName(entry: NodeEntry, position: number): NodeNameView {
  const es = entry.draft.nameEs.trim();
  if (es.length > 0) return { text: es, missingSpanish: false };

  const en = entry.draft.nameEn.trim();
  if (en.length > 0) return { text: en, missingSpanish: true };

  return { text: `Punto ${position}`, missingSpanish: false };
}

/* -------------------------------------------------------------------------- */
/* Angulos                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Interpreta lo que se teclea en los campos de yaw y pitch.
 *
 * Existe para que escribir a mano y pinchar en el visor lleguen al mismo
 * sitio: el campo numerico es la alternativa accesible al gesto, no un
 * segundo camino con sus propias reglas.
 */
export function parseAngle(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed.length === 0) return null;

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Redondeo estable, para que pinchar en el visor no genere ruido infinito. */
export function roundAngle(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function formatAngle(value: number): string {
  return String(roundAngle(value));
}

/* -------------------------------------------------------------------------- */
/* Parches                                                                    */
/* -------------------------------------------------------------------------- */

export function nodePatch(entry: NodeEntry): Record<string, string> {
  return { nameEs: entry.draft.nameEs, nameEn: entry.draft.nameEn };
}

export function linkPatch(entry: LinkEntry): Record<string, number> {
  return { yaw: entry.draft.yaw, pitch: entry.draft.pitch };
}

/* -------------------------------------------------------------------------- */
/* Mutaciones                                                                 */
/* -------------------------------------------------------------------------- */

export function markNodeSaved(entry: NodeEntry, snapshot: NodeDraft): void {
  entry.loaded = { ...snapshot };
  entry.state = isNodeDirty(entry) ? 'dirty' : 'saved';
  entry.error = null;
}

export function markLinkSaved(entry: LinkEntry, snapshot: LinkDraft): void {
  entry.loaded = { ...snapshot };
  entry.state = isLinkDirty(entry) ? 'dirty' : 'saved';
  entry.error = null;
}

/**
 * Aplica el nodo inicial en local tras confirmarlo el servidor.
 *
 * Retira la marca de quien la tuviera: solo puede haber uno por propiedad,
 * igual que garantiza el indice parcial del esquema.
 */
export function applyStartNode(state: TourEditorState, nodeId: number, value: boolean): void {
  for (const node of state.nodes) {
    node.isStart = value && node.id === nodeId;
  }
}

/**
 * Elimina un nodo del estado.
 *
 * Sus enlaces desaparecen con el, y tambien los que APUNTABAN a el desde otros
 * nodos: es lo mismo que hace la base con `ON DELETE CASCADE`, y si no se
 * reflejara aqui la lista mostraria saltos hacia un sitio que ya no existe.
 */
export function removeNode(state: TourEditorState, nodeId: number): void {
  state.nodes = state.nodes.filter((node) => node.id !== nodeId);

  for (const node of state.nodes) {
    node.links = node.links.filter((link) => link.toNodeId !== nodeId);
  }

  if (state.selectedNodeId === nodeId) {
    state.selectedNodeId = state.nodes[0]?.id ?? null;
  }
}

export function removeLink(state: TourEditorState, linkId: number): void {
  for (const node of state.nodes) {
    node.links = node.links.filter((link) => link.id !== linkId);
  }
}

export function addNode(state: TourEditorState, node: ApiTourNode): NodeEntry {
  const draft: NodeDraft = { nameEs: text(node.names.es), nameEn: text(node.names.en) };

  const entry: NodeEntry = {
    id: node.id,
    sortOrder: node.sortOrder,
    isStart: node.isStart,
    panoramaId: node.panorama?.id ?? null,
    loaded: draft,
    draft: { ...draft },
    state: 'saved',
    error: null,
    links: [],
  };

  state.nodes.push(entry);

  // El primer nodo se selecciona solo: no habia nada que mirar.
  if (state.selectedNodeId === null) state.selectedNodeId = entry.id;

  return entry;
}

export function addLink(state: TourEditorState, link: ApiTourLink): LinkEntry | null {
  const from = nodeById(state, link.fromNodeId);
  if (from === undefined) return null;

  const entry = toLinkEntry(link);
  from.links.push(entry);
  return entry;
}
