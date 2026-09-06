/**
 * Seccion del recorrido 360 del editor.
 *
 * Solo cableado de DOM: el estado vive en `tour-editor-state.ts`, las llamadas
 * en `tour-api.ts` y el visor en `panorama-viewer.ts`.
 *
 * Que pasa por el coordinador de guardado y que no:
 *
 * - los nombres de cada punto y la posicion de cada salto son puertos mas del
 *   coordinador, con el mismo debounce que el resto del editor;
 * - crear, eliminar y marcar el punto inicial son acciones explicitas e
 *   inmediatas, fuera del debounce.
 *
 * El visor es una ayuda, no el unico camino: pinchar en el panorama rellena
 * los mismos campos numericos que se pueden teclear, y si el visor no carga la
 * seccion sigue siendo utilizable.
 */

import { createPanoramaViewer, type PanoramaViewer } from './panorama-viewer';
import { createTourApi, panoramaUrl, type TourApi } from './tour-api';
import {
  addLink,
  addNode,
  applyStartNode,
  availablePanoramas,
  formatAngle,
  isEmpty,
  isLinkDirty,
  isNodeDirty,
  linkPatch,
  linkTargets,
  markLinkSaved,
  markNodeSaved,
  nodeById,
  nodePatch,
  nodeDisplayName,
  parseAngle,
  removeLink,
  removeNode,
  roundAngle,
  selectedNode,
  stateFromApi,
  type AvailablePanorama,
  type EntityState,
  type LinkDraft,
  type LinkEntry,
  type NodeDraft,
  type NodeEntry,
  type TourEditorState,
} from './tour-editor-state';
import { saveStateLabel } from './editor-state';
import { type PersistResult, type SaveCoordinator } from './save-coordinator';

export const LOADING_TEXT = 'Cargando recorrido…';
export const EMPTY_TEXT = 'Aún no hay puntos en el recorrido.';
export const NO_PANORAMAS_TEXT =
  'Todavía no hay panoramas 360° en esta propiedad. Súbelos en la sección Multimedia y vuelve aquí.';
export const VIEWER_FALLBACK_TEXT =
  'No pudimos cargar el visor 360°. Puedes seguir editando las posiciones a mano con los campos de giro e inclinación.';

const UNSAVED_WARNING = 'Tiene cambios sin guardar que se perderán.';

const CONFIRM_DELETE_NODE_BASE =
  'Se eliminará el punto y todos los saltos que entran o salen de él. El panorama no se borra.';

const CONFIRM_DELETE_LINK_BASE = 'Se eliminará este salto. Esta acción no se puede deshacer.';

export function deleteNodeMessage(dirty: boolean): string {
  return dirty ? `${CONFIRM_DELETE_NODE_BASE} ${UNSAVED_WARNING}` : CONFIRM_DELETE_NODE_BASE;
}

export function deleteLinkMessage(dirty: boolean): string {
  return dirty ? `${CONFIRM_DELETE_LINK_BASE} ${UNSAVED_WARNING}` : CONFIRM_DELETE_LINK_BASE;
}

/** Claves de los puertos dinamicos de esta seccion. */
export function tourNodePortKey(nodeId: number): string {
  return `tour-node:${nodeId}`;
}

export function tourLinkPortKey(linkId: number): string {
  return `tour-link:${linkId}`;
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

export interface TourEditorHandle {
  dispose: () => void;
}

export function initTourEditor(
  propertyId: number,
  coordinator: SaveCoordinator,
  api: TourApi = createTourApi(propertyId),
): TourEditorHandle {
  const root = byId<HTMLElement>('admin-tour');
  if (root === null) return { dispose: () => undefined };

  let state: TourEditorState = { nodes: [], selectedNodeId: null };
  let panoramas: AvailablePanorama[] = [];

  let loadError: string | null = null;
  let sectionError: string | null = null;
  /** Cierto cuando el visor no pudo cargarse; se avisa y se sigue. */
  let viewerUnavailable = false;

  let viewer: PanoramaViewer | null = null;
  let viewerNodeId: number | null = null;

  /* ---------------------------------------------------------------------- */
  /* Puertos del coordinador                                                */
  /* ---------------------------------------------------------------------- */

  const linkById = (linkId: number): LinkEntry | undefined => {
    for (const node of state.nodes) {
      const found = node.links.find((link) => link.id === linkId);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const registerNodePort = (nodeId: number): void => {
    coordinator.register(tourNodePortKey(nodeId), {
      isDirty: () => {
        const entry = nodeById(state, nodeId);
        return entry !== undefined && isNodeDirty(entry);
      },

      validate: () => [],

      persist: async (): Promise<PersistResult> => {
        const entry = nodeById(state, nodeId);
        if (entry === undefined) return { ok: true };

        const snapshot: NodeDraft = { ...entry.draft };

        entry.state = 'saving';
        entry.error = null;
        paintStatus(`tour-node-${nodeId}-status`, entry.state, entry.error);

        const result = await api.updateNode(nodeId, nodePatch(entry));

        const current = nodeById(state, nodeId);
        if (current === undefined) return { ok: true };

        if (result.ok) {
          markNodeSaved(current, snapshot);
        } else {
          current.state = 'error';
          current.error = result.message;
        }

        render();

        // El mensaje ya se ve junto al punto; no se repite arriba.
        return result.ok ? { ok: true } : { ok: false };
      },
    });
  };

  const registerLinkPort = (linkId: number): void => {
    coordinator.register(tourLinkPortKey(linkId), {
      isDirty: () => {
        const entry = linkById(linkId);
        return entry !== undefined && isLinkDirty(entry);
      },

      validate: () => [],

      persist: async (): Promise<PersistResult> => {
        const entry = linkById(linkId);
        if (entry === undefined) return { ok: true };

        const snapshot: LinkDraft = { ...entry.draft };

        entry.state = 'saving';
        entry.error = null;
        paintStatus(`tour-link-${linkId}-status`, entry.state, entry.error);

        const result = await api.updateLink(linkId, linkPatch(entry));

        const current = linkById(linkId);
        if (current === undefined) return { ok: true };

        if (result.ok) {
          markLinkSaved(current, snapshot);
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
    for (const node of state.nodes) {
      registerNodePort(node.id);
      for (const link of node.links) registerLinkPort(link.id);
    }
  };

  const unregisterAll = (): void => {
    for (const node of state.nodes) {
      coordinator.unregister(tourNodePortKey(node.id));
      for (const link of node.links) coordinator.unregister(tourLinkPortKey(link.id));
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */

  const statusMarkup = (entryState: EntityState, error: string | null): string => {
    const label = error ?? saveStateLabel(entryState);
    return `<p class="editor-save-status tour-status" data-state="${entryState}">${escapeHtml(label)}</p>`;
  };

  /** Nombre de un punto tal y como se ve en la lista. */
  const nameOf = (node: NodeEntry): string => {
    const position = state.nodes.indexOf(node) + 1;
    return nodeDisplayName(node, position).text;
  };

  const nodeListMarkup = (): string => {
    const items = state.nodes
      .map((node, index) => {
        const name = nodeDisplayName(node, index + 1);
        const selected = node.id === state.selectedNodeId;

        const note = name.missingSpanish
          ? ' <span class="admin-lang-note" title="Falta el nombre en español">Falta ES</span>'
          : '';

        const startBadge = node.isStart
          ? ' <span class="admin-badge tour-badge-start">Inicio</span>'
          : '';

        return `
          <li>
            <button type="button" class="tour-node-item" data-action="select-node"
              data-node="${node.id}" aria-current="${selected}"${selected ? ' data-selected="true"' : ''}>
              <span class="tour-node-name">${escapeHtml(name.text)}${note}</span>
              ${startBadge}
              <span class="tour-node-links">${node.links.length} salto(s)</span>
            </button>
          </li>`;
      })
      .join('');

    return `<ul class="tour-node-list" aria-label="Puntos del recorrido">${items}</ul>`;
  };

  const addNodeMarkup = (): string => {
    const free = availablePanoramas(state, panoramas);

    if (panoramas.length === 0) {
      return `<p class="admin-muted" id="tour-no-panoramas">${NO_PANORAMAS_TEXT}</p>`;
    }

    if (free.length === 0) {
      return `<p class="admin-muted">Todos los panoramas de la propiedad ya son puntos del recorrido.</p>`;
    }

    const options = free
      .map((panorama) => `<option value="${panorama.id}">${escapeHtml(panorama.label)}</option>`)
      .join('');

    return `
      <div class="admin-field">
        <label for="tour-new-panorama">Panorama disponible</label>
        <select id="tour-new-panorama">${options}</select>
      </div>
      <button type="button" class="admin-button" data-action="add-node">Añadir punto</button>`;
  };

  const linkMarkup = (link: LinkEntry): string => {
    const id = link.id;
    const target = nodeById(state, link.toNodeId);
    const invalid = link.state === 'error' ? 'true' : 'false';
    const name = target === undefined ? `Punto ${link.toNodeId}` : nameOf(target);

    return `
      <article class="tour-link" data-link="${id}">
        <p class="tour-link-target">Salta a <strong>${escapeHtml(name)}</strong></p>

        <div class="tour-grid">
          <div class="admin-field">
            <label for="tour-link-${id}-yaw">Giro (yaw)</label>
            <input type="number" step="0.01" id="tour-link-${id}-yaw" data-field="yaw"
              aria-invalid="${invalid}" value="${escapeHtml(formatAngle(link.draft.yaw))}" />
          </div>
          <div class="admin-field">
            <label for="tour-link-${id}-pitch">Inclinación (pitch)</label>
            <input type="number" step="0.01" id="tour-link-${id}-pitch" data-field="pitch"
              aria-invalid="${invalid}" value="${escapeHtml(formatAngle(link.draft.pitch))}" />
          </div>
        </div>

        <div class="tour-actions">
          <button type="button" class="admin-button" data-action="pick-link">
            Usar el último punto marcado
          </button>
          <button type="button" class="admin-button admin-button-quiet" data-action="delete-link">
            Eliminar salto
          </button>
          <div class="tour-status-box" id="tour-link-${id}-status" role="status">${statusMarkup(
            link.state,
            link.error,
          )}</div>
        </div>
      </article>`;
  };

  const newLinkMarkup = (node: NodeEntry): string => {
    const targets = linkTargets(state, node.id);

    if (targets.length === 0) {
      return `<p class="admin-muted">No quedan puntos a los que saltar desde aquí.</p>`;
    }

    const options = targets
      .map((target) => `<option value="${target.id}">${escapeHtml(nameOf(target))}</option>`)
      .join('');

    return `
      <div class="tour-grid">
        <div class="admin-field">
          <label for="tour-new-link-target">Saltar a</label>
          <select id="tour-new-link-target">${options}</select>
        </div>
      </div>
      <p class="editor-help" id="tour-pick-help">
        Marca el sitio pinchando en el panorama, o escribe el giro y la inclinación a mano.
      </p>
      <div class="tour-grid">
        <div class="admin-field">
          <label for="tour-new-link-yaw">Giro (yaw)</label>
          <input type="number" step="0.01" id="tour-new-link-yaw" value="${escapeHtml(
            formatAngle(lastPick.yaw),
          )}" aria-describedby="tour-pick-help" />
        </div>
        <div class="admin-field">
          <label for="tour-new-link-pitch">Inclinación (pitch)</label>
          <input type="number" step="0.01" id="tour-new-link-pitch" value="${escapeHtml(
            formatAngle(lastPick.pitch),
          )}" aria-describedby="tour-pick-help" />
        </div>
      </div>
      <button type="button" class="admin-button" data-action="add-link">Añadir salto</button>`;
  };

  const detailMarkup = (): string => {
    const node = selectedNode(state);
    if (node === undefined) return '';

    const invalid = node.state === 'error' ? 'true' : 'false';
    const id = node.id;

    return `
      <section class="tour-detail" data-node="${id}" aria-labelledby="tour-detail-heading">
        <h3 id="tour-detail-heading">${escapeHtml(nameOf(node))}</h3>

        <div class="tour-grid">
          <div class="admin-field">
            <label for="tour-node-${id}-name-es">Nombre en español</label>
            <input type="text" id="tour-node-${id}-name-es" data-field="nameEs"
              aria-invalid="${invalid}" value="${escapeHtml(node.draft.nameEs)}" />
          </div>
          <div class="admin-field">
            <label for="tour-node-${id}-name-en">Name in English</label>
            <input type="text" id="tour-node-${id}-name-en" data-field="nameEn"
              aria-invalid="${invalid}" value="${escapeHtml(node.draft.nameEn)}" />
          </div>
        </div>

        <div class="tour-actions">
          <button type="button" class="admin-button" data-action="toggle-start"
            aria-pressed="${node.isStart}">
            ${node.isStart ? 'Quitar como punto de inicio' : 'Usar como punto de inicio'}
          </button>
          <button type="button" class="admin-button admin-button-quiet" data-action="delete-node">
            Eliminar punto
          </button>
          <div class="tour-status-box" id="tour-node-${id}-status" role="status">${statusMarkup(
            node.state,
            node.error,
          )}</div>
        </div>

        <h4>Saltos desde este punto</h4>
        <div class="tour-links">
          ${node.links.length === 0 ? '<p class="admin-muted">Este punto todavía no salta a ningún sitio.</p>' : node.links.map(linkMarkup).join('')}
        </div>

        <h4>Añadir un salto</h4>
        ${newLinkMarkup(node)}
      </section>`;
  };

  const viewerMarkup = (): string => {
    const node = selectedNode(state);

    if (node === undefined || node.panoramaId === null) {
      return `<p class="admin-muted">Selecciona un punto para ver su panorama.</p>`;
    }

    const warning = viewerUnavailable
      ? `<p class="editor-error" role="alert">${escapeHtml(VIEWER_FALLBACK_TEXT)}</p>`
      : '';

    return `
      ${warning}
      <div class="tour-viewer" id="tour-viewer"></div>
      <p class="editor-help" id="tour-viewer-help">
        Pincha en el panorama para tomar esa posición. También puedes escribirla en los campos.
      </p>
      <p class="admin-muted" id="tour-last-pick" role="status">
        Última posición marcada: giro ${escapeHtml(formatAngle(lastPick.yaw))}, inclinación
        ${escapeHtml(formatAngle(lastPick.pitch))}
      </p>`;
  };

  const render = (): void => {
    if (loadError !== null) {
      root.innerHTML = `
        <div class="admin-state admin-state-error">
          <p>${escapeHtml(loadError)}</p>
          <button type="button" class="admin-button" data-action="retry-tour">Reintentar</button>
        </div>`;
      return;
    }

    const errorMarkup =
      sectionError === null
        ? ''
        : `<p class="editor-error" id="tour-error" role="alert">${escapeHtml(sectionError)}</p>`;

    const emptyMarkup = isEmpty(state)
      ? `<p class="admin-muted" id="tour-empty">${EMPTY_TEXT}</p>`
      : '';

    root.innerHTML = `
      ${errorMarkup}
      <div class="tour-layout">
        <div class="tour-side">
          ${emptyMarkup}
          ${isEmpty(state) ? '' : nodeListMarkup()}
          <div class="tour-add">${addNodeMarkup()}</div>
        </div>
        <div class="tour-main">
          ${viewerMarkup()}
          ${detailMarkup()}
        </div>
      </div>`;

    void syncViewer();
  };

  /* ---------------------------------------------------------------------- */
  /* Visor                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Ultima posicion marcada, compartida por el visor y el formulario. */
  let lastPick = { yaw: 0, pitch: 0 };

  const hotspotsOf = (node: NodeEntry) =>
    node.links.map((link) => {
      const target = nodeById(state, link.toNodeId);

      return {
        id: String(link.id),
        yaw: link.draft.yaw,
        pitch: link.draft.pitch,
        label: `Ir a ${target === undefined ? `punto ${link.toNodeId}` : nameOf(target)}`,
      };
    });

  /**
   * Pone el visor al dia con el punto seleccionado.
   *
   * Se crea una sola vez y despues solo se cambia el panorama: destruirlo y
   * rehacerlo en cada repintado tiraria la camara del usuario al suelo.
   */
  const syncViewer = async (): Promise<void> => {
    const node = selectedNode(state);
    const container = byId<HTMLElement>('tour-viewer');

    if (node === undefined || node.panoramaId === null || container === null) {
      viewer?.destroy();
      viewer = null;
      viewerNodeId = null;
      return;
    }

    const url = panoramaUrl(propertyId, node.panoramaId);

    if (viewer === null) {
      viewer = await createPanoramaViewer(url, {
        container,
        onPick: (position) => {
          lastPick = { yaw: roundAngle(position.yaw), pitch: roundAngle(position.pitch) };
          paintLastPick();
        },
        onHotspot: (id) => {
          // Pulsar un salto lleva al punto de destino, como en el visor real.
          const link = linkById(Number(id));
          if (link !== undefined) selectNode(link.toNodeId);
        },
      });

      if (viewer === null) {
        viewerUnavailable = true;
        // Se repinta una vez para mostrar el aviso, sin volver a intentarlo.
        const warning = byId<HTMLElement>('tour-viewer');
        if (warning !== null) warning.hidden = true;
        return;
      }
    } else if (viewerNodeId !== node.id) {
      await viewer.show(url);
    }

    viewerNodeId = node.id;
    viewer.setHotspots(hotspotsOf(node));
  };

  const paintLastPick = (): void => {
    const box = byId<HTMLElement>('tour-last-pick');
    if (box === null) return;

    box.textContent = `Última posición marcada: giro ${formatAngle(lastPick.yaw)}, inclinación ${formatAngle(lastPick.pitch)}`;

    // Los campos del salto nuevo siguen a lo ultimo marcado.
    const yaw = byId<HTMLInputElement>('tour-new-link-yaw');
    const pitch = byId<HTMLInputElement>('tour-new-link-pitch');
    if (yaw !== null) yaw.value = formatAngle(lastPick.yaw);
    if (pitch !== null) pitch.value = formatAngle(lastPick.pitch);
  };

  /* ---------------------------------------------------------------------- */
  /* Utilidades                                                             */
  /* ---------------------------------------------------------------------- */

  const closestId = (element: HTMLElement, attribute: 'node' | 'link'): number | null => {
    const host = element.closest(`[data-${attribute}]`);
    if (host === null) return null;

    const value = Number((host as HTMLElement).dataset[attribute]);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };

  const paintStatus = (
    containerId: string,
    entryState: EntityState,
    error: string | null,
  ): void => {
    const box = byId<HTMLElement>(containerId);
    if (box !== null) box.innerHTML = statusMarkup(entryState, error);
  };

  const numberFrom = (id: string): number => {
    const parsed = parseAngle(byId<HTMLInputElement>(id)?.value ?? '');
    return parsed ?? 0;
  };

  const selectNode = (nodeId: number): void => {
    state.selectedNodeId = nodeId;
    sectionError = null;
    render();
  };

  /* ---------------------------------------------------------------------- */
  /* Carga                                                                  */
  /* ---------------------------------------------------------------------- */

  const load = async (): Promise<void> => {
    root.innerHTML = `<p class="admin-muted">${LOADING_TEXT}</p>`;

    const [tour, media] = await Promise.all([api.load(), api.loadPanoramas()]);

    if (!tour.ok) {
      // El fallo se queda dentro de la seccion: el resto del editor sigue vivo.
      loadError = tour.message;
      render();
      return;
    }

    unregisterAll();

    loadError = null;
    sectionError = null;

    const previous = state.selectedNodeId;
    state = stateFromApi(tour.data, previous);

    /*
     * Los panoramas se sacan del listado de multimedia. Si esa lectura falla,
     * el recorrido existente se sigue pudiendo editar: solo se queda sin la
     * lista de candidatos.
     */
    panoramas = media.ok
      ? [...media.data.groups.flatMap((group) => group.media), ...media.data.ungrouped]
          .filter((item) => item.mediaKind === 'panorama')
          .map((item) => ({
            id: item.id,
            label:
              item.translations.es?.title?.trim() ??
              item.objectKey?.split('/').pop() ??
              `Panorama ${item.id}`,
          }))
      : [];

    registerAll();
    render();
  };

  /* ---------------------------------------------------------------------- */
  /* Acciones                                                               */
  /* ---------------------------------------------------------------------- */

  const createNode = async (button: HTMLButtonElement): Promise<void> => {
    const panoramaId = Number(byId<HTMLSelectElement>('tour-new-panorama')?.value ?? '');
    if (!Number.isSafeInteger(panoramaId) || panoramaId <= 0) return;

    button.disabled = true;
    const result = await api.createNode(panoramaId);
    button.disabled = false;

    if (result === null) return;

    if (!result.ok) {
      sectionError = result.message;
      render();
      return;
    }

    sectionError = null;
    const entry = addNode(state, result.data);
    registerNodePort(entry.id);
    selectNode(entry.id);
  };

  const toggleStart = async (node: NodeEntry): Promise<void> => {
    const next = !node.isStart;

    node.state = 'saving';
    node.error = null;
    paintStatus(`tour-node-${node.id}-status`, node.state, node.error);

    const result = await api.setStart(node.id, next);

    if (result.ok) {
      // El servidor ya retiro la marca del anterior en la misma operacion.
      applyStartNode(state, node.id, next);
      node.state = isNodeDirty(node) ? 'dirty' : 'saved';
      sectionError = null;
    } else {
      node.state = 'error';
      node.error = result.message;
    }

    render();
  };

  const deleteNode = async (node: NodeEntry): Promise<void> => {
    if (!window.confirm(deleteNodeMessage(isNodeDirty(node)))) return;

    const result = await api.deleteNode(node.id);

    if (result.ok) {
      /*
       * Se dan de baja tambien los puertos de los saltos que desaparecen con
       * el, incluidos los que le apuntaban desde otros puntos.
       */
      coordinator.unregister(tourNodePortKey(node.id));
      for (const link of node.links) coordinator.unregister(tourLinkPortKey(link.id));

      for (const other of state.nodes) {
        for (const link of other.links) {
          if (link.toNodeId === node.id) coordinator.unregister(tourLinkPortKey(link.id));
        }
      }

      removeNode(state, node.id);
      sectionError = null;
    } else {
      node.state = 'error';
      node.error = result.message;
    }

    render();
  };

  const createLink = async (button: HTMLButtonElement, fromNodeId: number): Promise<void> => {
    const toNodeId = Number(byId<HTMLSelectElement>('tour-new-link-target')?.value ?? '');
    if (!Number.isSafeInteger(toNodeId) || toNodeId <= 0) return;

    button.disabled = true;

    const result = await api.createLink({
      fromNodeId,
      toNodeId,
      yaw: numberFrom('tour-new-link-yaw'),
      pitch: numberFrom('tour-new-link-pitch'),
    });

    button.disabled = false;

    if (result === null) return;

    if (!result.ok) {
      sectionError = result.message;
      render();
      return;
    }

    sectionError = null;
    const entry = addLink(state, result.data);
    if (entry !== null) registerLinkPort(entry.id);
    render();
  };

  const deleteLink = async (link: LinkEntry): Promise<void> => {
    if (!window.confirm(deleteLinkMessage(isLinkDirty(link)))) return;

    const result = await api.deleteLink(link.id);

    if (result.ok) {
      coordinator.unregister(tourLinkPortKey(link.id));
      removeLink(state, link.id);
      sectionError = null;
    } else {
      link.state = 'error';
      link.error = result.message;
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

    const value = (target as HTMLInputElement).value;
    const linkId = closestId(target, 'link');

    if (linkId !== null) {
      const entry = linkById(linkId);
      if (entry === undefined) return;

      const angle = parseAngle(value);
      if (angle === null) return;

      if (field === 'yaw') entry.draft.yaw = angle;
      if (field === 'pitch') entry.draft.pitch = angle;

      entry.state = isLinkDirty(entry) ? 'dirty' : 'saved';
      entry.error = null;
      paintStatus(`tour-link-${entry.id}-status`, entry.state, entry.error);

      // El hotspot se mueve en el visor sin esperar al guardado.
      const node = selectedNode(state);
      if (node !== undefined) viewer?.setHotspots(hotspotsOf(node));

      coordinator.notifyChange(tourLinkPortKey(entry.id));
      return;
    }

    const nodeId = closestId(target, 'node');
    if (nodeId === null) return;

    const entry = nodeById(state, nodeId);
    if (entry === undefined) return;

    if (field in entry.draft) {
      (entry.draft as unknown as Record<string, string>)[field] = value;
    }

    entry.state = isNodeDirty(entry) ? 'dirty' : 'saved';
    entry.error = null;
    paintStatus(`tour-node-${entry.id}-status`, entry.state, entry.error);

    coordinator.notifyChange(tourNodePortKey(entry.id));
  };

  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const trigger = target.closest('[data-action]');
    if (trigger === null) return;

    const element = trigger as HTMLElement;
    const action = element.dataset.action;
    if (action === undefined) return;

    const button = element as HTMLButtonElement;
    const linkId = closestId(element, 'link');
    const nodeId = closestId(element, 'node');

    switch (action) {
      case 'retry-tour':
        void load();
        break;

      case 'select-node': {
        const chosen = Number(element.dataset.node);
        if (Number.isSafeInteger(chosen) && chosen > 0) selectNode(chosen);
        break;
      }

      case 'add-node':
        void createNode(button);
        break;

      case 'toggle-start': {
        const entry = nodeId === null ? undefined : nodeById(state, nodeId);
        if (entry !== undefined) void toggleStart(entry);
        break;
      }

      case 'delete-node': {
        const entry = nodeId === null ? undefined : nodeById(state, nodeId);
        if (entry !== undefined) void deleteNode(entry);
        break;
      }

      case 'add-link':
        if (state.selectedNodeId !== null) void createLink(button, state.selectedNodeId);
        break;

      case 'pick-link': {
        // Lleva la ultima posicion marcada a un salto que ya existe.
        const entry = linkId === null ? undefined : linkById(linkId);
        if (entry === undefined) break;

        entry.draft.yaw = lastPick.yaw;
        entry.draft.pitch = lastPick.pitch;
        entry.state = isLinkDirty(entry) ? 'dirty' : 'saved';

        coordinator.notifyChange(tourLinkPortKey(entry.id));
        render();
        break;
      }

      case 'delete-link': {
        const entry = linkId === null ? undefined : linkById(linkId);
        if (entry !== undefined) void deleteLink(entry);
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
      viewer?.destroy();
      viewer = null;
    },
  };
}
