/**
 * Editor visual del recorrido 360.
 *
 * Todo lo que el usuario coloca sale del propio visor: nunca se le piden
 * ángulos. El estado es el tour en memoria y cuatro variables; el guardado es
 * manual y escribe `tour_json` de una vez.
 *
 * Regla que no se puede romper: `#tour-viewer` es un nodo permanente del HTML.
 * Las listas y el detalle se regeneran, el contenedor del visor no; sustituirlo
 * dejaba la instancia de Photo Sphere Viewer colgada de un nodo fuera del
 * documento y el panorama desaparecía tras cualquier acción.
 */
import type { media as mediaTable } from '../../../db/schema';
import type { Tour } from '../../domain/content';
import {
  addTourNode,
  removeTourLink,
  removeTourNode,
  renameTourNode,
  setTourInitialView,
  setTourStart,
  tourNode,
  upsertTourLink,
} from '../../domain/tour';
import { createPanoramaViewer, type PanoramaViewer } from '../../viewer/panorama-viewer';
import { api, escape, message } from './simple';

type Media = typeof mediaTable.$inferSelect;

const VIEWER_FALLBACK =
  'No se pudo cargar el visor 360°. Recarga la página para volver a intentarlo.';

export function initTour() {
  const root = document.getElementById('r2-tour');
  if (!root) return;
  const id = root.dataset.id!;
  /*
   * Aserción en vez del genérico de `getElementById`: los tipos del runtime de
   * Workers traen su propio `Element` y chocan con los del DOM.
   */
  const el = <T extends object>(name: string) => document.getElementById(name) as T;
  const json = <T>(name: string) =>
    JSON.parse(document.getElementById(name)?.textContent || 'null') as T;

  const box = el<HTMLElement>('tour-viewer');
  const nodeList = el<HTMLElement>('r2-tour-nodes');
  const detail = el<HTMLElement>('r2-tour-detail');
  const addSelect = el<HTMLSelectElement>('r2-tour-add');
  const targetSelect = el<HTMLSelectElement>('r2-tour-link-target');
  const returnBox = el<HTMLInputElement>('r2-tour-return');
  const cancelButton = el<HTMLButtonElement>('r2-tour-cancel');
  const hintBox = el<HTMLElement>('r2-tour-hint');
  const statusBox = el<HTMLElement>('r2-tour-status');

  let tour = json<Tour | null>('r2-tour-data');
  let panoramas = (json<Media[]>('r2-media-data') ?? []).filter((m) => m.kind === 'panorama');
  let selectedMediaId: number | null = tour?.startMediaId ?? null;
  let mode: 'browse' | 'placing' = 'browse';
  let pendingDestination: number | null = null;
  let returning = false;
  let dirty = false;

  let viewer: PanoramaViewer | null = null;
  let pending: Promise<void> | null = null;
  let viewerFailed = false;
  let shownMediaId: number | null = null;
  let showSeq = 0;

  /* -- Textos -------------------------------------------------------------- */

  const fileUrl = (mediaId: number) => `/api/admin/properties/${id}/media/${mediaId}/file`;
  const panoramaLabel = (mediaId: number) => {
    const file = panoramas.find((m) => m.id === mediaId);
    return file?.altEs?.trim() || `Panorama ${mediaId}`;
  };
  const nodeName = (mediaId: number) => {
    const node = tourNode(tour, mediaId);
    return node?.name_es?.trim() || node?.name_en?.trim() || panoramaLabel(mediaId);
  };
  const status = (text: string) => {
    statusBox.textContent = text;
  };
  /**
   * Indicación de la sección. La instrucción de colocar un enlace se repite
   * dentro del visor, que es donde está mirando el usuario y lo único que se
   * ve a pantalla completa; el resto se queda fuera para no tapar el panorama.
   */
  const hint = (text: string, inViewer = false) => {
    hintBox.textContent = text;
    viewer?.notify(inViewer && text ? text : null);
  };
  const touch = () => {
    dirty = true;
    status('Cambios del recorrido sin guardar');
  };

  /* -- Visor --------------------------------------------------------------- */

  const viewOf = (mediaId: number) => {
    const view = tourNode(tour, mediaId)?.initialView;
    return view && view.yaw !== null && view.pitch !== null
      ? { yaw: view.yaw, pitch: view.pitch, fov: view.fov }
      : null;
  };
  const hotspotsOf = (mediaId: number) =>
    (tourNode(tour, mediaId)?.links ?? []).map((link) => ({
      id: String(link.toMediaId),
      yaw: link.yaw,
      pitch: link.pitch,
      label: `Ir a ${nodeName(link.toMediaId)}`,
    }));

  /** Las sincronizaciones se encadenan: nunca hay dos cargas del visor a la vez. */
  function sync(): Promise<void> {
    pending = (pending ?? Promise.resolve()).then(syncViewer, () => undefined);
    return pending;
  }

  async function syncViewer(): Promise<void> {
    const node = tourNode(tour, selectedMediaId);
    box.hidden = node === null || viewerFailed;
    if (node === null || viewerFailed) return;
    if (viewer === null) {
      // Una sola instancia para toda la sesión de edición; se destruye al salir de la página.
      viewer = await createPanoramaViewer(fileUrl(node.mediaId), {
        container: box,
        view: viewOf(node.mediaId),
        onPick: (position) => place(position.yaw, position.pitch),
        onHotspot: (hotspot) => {
          if (mode === 'browse') select(Number(hotspot));
        },
      });
      if (viewer === null) {
        viewerFailed = true;
        box.hidden = true;
        hint(VIEWER_FALLBACK);
        return;
      }
      shownMediaId = node.mediaId;
      // La selección puede haber cambiado mientras cargaba.
      return syncViewer();
    }
    if (shownMediaId !== node.mediaId) {
      const seq = ++showSeq;
      shownMediaId = node.mediaId;
      await viewer.show(fileUrl(node.mediaId), viewOf(node.mediaId));
      // Una carga anulada por otra más nueva no debe pintar sus hotspots.
      if (seq !== showSeq) return;
    }
    viewer.setHotspots(hotspotsOf(node.mediaId));
  }

  /* -- Pintado ------------------------------------------------------------- */

  function options(select: HTMLSelectElement, items: { value: number; label: string }[]) {
    select.innerHTML = items
      .map((item) => `<option value="${item.value}">${escape(item.label)}</option>`)
      .join('');
    select.disabled = items.length === 0;
  }

  function render() {
    const node = tourNode(tour, selectedMediaId);
    el<HTMLElement>('r2-tour-empty').hidden = tour !== null;
    nodeList.innerHTML = (tour?.nodes ?? [])
      .map(
        (item) =>
          `<li><button type="button" class="admin-button" data-node="${item.mediaId}"${
            item.mediaId === selectedMediaId ? ' aria-current="true"' : ''
          }>${escape(nodeName(item.mediaId))}</button>${
            item.mediaId === tour?.startMediaId ? ' <span>Inicio</span>' : ''
          }</li>`,
      )
      .join('');

    options(
      addSelect,
      panoramas
        .filter((file) => tourNode(tour, file.id) === null)
        .map((file) => ({ value: file.id, label: panoramaLabel(file.id) })),
    );
    options(
      targetSelect,
      (tour?.nodes ?? [])
        .filter((item) => item.mediaId !== selectedMediaId)
        .map((item) => ({ value: item.mediaId, label: nodeName(item.mediaId) })),
    );

    detail.innerHTML =
      node === null
        ? '<p>Selecciona un panorama del recorrido para editarlo.</p>'
        : `<label>Nombre ES<input data-name="name_es" maxlength="200" value="${escape(node.name_es)}"></label>
      <label>Name EN<input data-name="name_en" maxlength="200" value="${escape(node.name_en)}"></label>
      <p>Enlaces desde este punto</p>${
        node.links.length === 0
          ? '<p>Todavía no hay enlaces aquí.</p>'
          : `<ul class="r2-tour-links">${node.links
              .map(
                (link) =>
                  `<li>→ ${escape(nodeName(link.toMediaId))} <button type="button" class="admin-button" data-remove-link="${link.toMediaId}">Eliminar</button></li>`,
              )
              .join('')}</ul>`
      }`;

    const placing = mode === 'placing';
    cancelButton.hidden = !placing;
    cancelButton.textContent = returning ? 'Omitir' : 'Cancelar';
    for (const name of ['r2-tour-link', 'r2-tour-view', 'r2-tour-start', 'r2-tour-remove'])
      el<HTMLButtonElement>(name).disabled = node === null || placing;
    el<HTMLButtonElement>('r2-tour-link').disabled =
      node === null || placing || targetSelect.disabled;
    el<HTMLButtonElement>('r2-tour-preview').disabled = tour === null || placing;
    el<HTMLButtonElement>('r2-tour-add-button').disabled = addSelect.disabled || placing;
    if (!placing && !viewerFailed)
      hint(node === null ? '' : 'Gira el panorama; los enlaces se colocan con un clic.');
    void sync();
  }

  /* -- Acciones ------------------------------------------------------------ */

  function select(mediaId: number) {
    if (tourNode(tour, mediaId) === null) return;
    selectedMediaId = mediaId;
    render();
  }

  function stopPlacing() {
    mode = 'browse';
    pendingDestination = null;
    returning = false;
    render();
  }

  /** Un clic en el panorama coloca el enlace pendiente; nada más lo coloca. */
  function place(yaw: number, pitch: number) {
    if (mode !== 'placing' || tour === null || selectedMediaId === null) return;
    const destination = pendingDestination;
    if (destination === null) return;
    const origin = selectedMediaId;
    tour = upsertTourLink(tour, origin, destination, yaw, pitch);
    touch();
    if (!returning && returnBox.checked) {
      // El regreso se coloca igual: se navega al destino y se pide un clic más.
      selectedMediaId = destination;
      pendingDestination = origin;
      returning = true;
      render();
      hint(`Haz clic donde está el paso de vuelta hacia ${nodeName(origin)}`, true);
      return;
    }
    stopPlacing();
  }

  nodeList.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-node]');
    if (button) select(Number(button.dataset.node));
  });

  detail.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-remove-link]');
    if (!button || tour === null || selectedMediaId === null) return;
    tour = removeTourLink(tour, selectedMediaId, Number(button.dataset.removeLink));
    touch();
    render();
  });

  detail.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.dataset.name || tour === null || selectedMediaId === null) return;
    const node = tourNode(tour, selectedMediaId)!;
    const value = input.value.trim() || null;
    tour = renameTourNode(tour, selectedMediaId, {
      name_es: input.dataset.name === 'name_es' ? value : node.name_es,
      name_en: input.dataset.name === 'name_en' ? value : node.name_en,
    });
    touch();
  });
  // El nombre se refleja en la lista al salir del campo: repintar antes robaría el foco.
  detail.addEventListener('change', () => render());

  el<HTMLButtonElement>('r2-tour-add-button').addEventListener('click', () => {
    const mediaId = Number(addSelect.value);
    if (!mediaId) return;
    tour = addTourNode(tour, mediaId);
    selectedMediaId = mediaId;
    touch();
    render();
  });

  el<HTMLButtonElement>('r2-tour-link').addEventListener('click', () => {
    const destination = Number(targetSelect.value);
    if (!destination || selectedMediaId === null) return;
    mode = 'placing';
    pendingDestination = destination;
    returning = false;
    render();
    hint(`Haz clic en el panorama donde está el paso hacia ${nodeName(destination)}`, true);
  });

  cancelButton.addEventListener('click', () => stopPlacing());

  el<HTMLButtonElement>('r2-tour-view').addEventListener('click', () => {
    if (tour === null || selectedMediaId === null || viewer === null) return;
    tour = setTourInitialView(tour, selectedMediaId, viewer.getView());
    touch();
    hint('Vista inicial actualizada');
  });

  el<HTMLButtonElement>('r2-tour-start').addEventListener('click', () => {
    if (tour === null || selectedMediaId === null) return;
    tour = setTourStart(tour, selectedMediaId);
    touch();
    render();
  });

  el<HTMLButtonElement>('r2-tour-preview').addEventListener('click', () => {
    if (tour === null) return;
    if (viewer === null) {
      hint('Espera a que cargue el visor y vuelve a intentar Vista previa.');
      return;
    }
    /*
     * La pantalla completa se pide dentro del propio gesto: tras una espera el
     * navegador ya no la considera activada por el usuario y la rechaza. El
     * panorama de inicio se carga después, ya a pantalla completa.
     */
    viewer.enterFullscreen();
    selectedMediaId = tour.startMediaId;
    render();
  });

  el<HTMLButtonElement>('r2-tour-remove').addEventListener('click', () => {
    if (tour === null || selectedMediaId === null) return;
    if (!confirm('¿Quitar este panorama del recorrido? El archivo se conserva en Multimedia.'))
      return;
    tour = removeTourNode(tour, selectedMediaId);
    selectedMediaId = tour?.startMediaId ?? null;
    touch();
    render();
  });

  const saveButton = el<HTMLButtonElement>('r2-tour-save');
  saveButton.addEventListener('click', () => {
    saveButton.disabled = true;
    void (async () => {
      try {
        tour = await api<Tour | null>(`properties/${id}/tour`, 'PUT', { tour });
        dirty = false;
        if (tourNode(tour, selectedMediaId) === null) selectedMediaId = tour?.startMediaId ?? null;
        status('Recorrido guardado');
        render();
      } catch (error) {
        status(message(error));
      } finally {
        saveButton.disabled = false;
      }
    })();
  });

  /*
   * Multimedia y recorrido comparten los mismos archivos: al borrar un panorama
   * el servidor limpia `tour_json`, y aquí se refleja lo mismo sin inventar nada.
   */
  document.addEventListener('r2-media', (event) => {
    panoramas = (event as CustomEvent<Media[]>).detail.filter((m) => m.kind === 'panorama');
    const known = new Set(panoramas.map((m) => m.id));
    for (const node of tour?.nodes ?? [])
      if (!known.has(node.mediaId)) tour = removeTourNode(tour, node.mediaId);
    if (tourNode(tour, selectedMediaId) === null) selectedMediaId = tour?.startMediaId ?? null;
    render();
  });

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });

  render();
}
