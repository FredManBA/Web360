/**
 * Envoltorio del visor de panoramas, compartido por el editor y el sitio
 * publico.
 *
 * Photo Sphere Viewer y Three pesan bastante y solo hacen falta cuando alguien
 * mira de verdad un panorama, asi que se cargan con `import()` dinamico: ni el
 * panel ni la ficha publica arrastran ese peso hasta que hace falta.
 *
 * Si la carga falla —red, navegador viejo, sin WebGL— devuelve `null` y quien
 * llama debe seguir funcionando: en el editor quedan los campos numericos, y
 * en la ficha publica la lista de panoramas. El visor es una ayuda, nunca el
 * unico camino.
 *
 * Vive fuera de `admin/` a proposito: lo usan los dos lados y no sabe nada de
 * ninguno.
 */

export interface PanoramaClick {
  yaw: number;
  pitch: number;
}

export interface PanoramaHotspot {
  id: string;
  yaw: number;
  pitch: number;
  /** Texto accesible del salto: "Ir a Mirador". */
  label: string;
}

/** Camara con la que abrir un panorama. */
export interface PanoramaView {
  yaw: number;
  pitch: number;
  /** Campo de vision; se deja el del visor si no se indica. */
  fov?: number | null;
}

export interface PanoramaViewer {
  /** Cambia el panorama que se esta mirando, opcionalmente mirando a un punto. */
  show: (url: string, view?: PanoramaView | null) => Promise<void>;
  /** Pinta los saltos del nodo actual. */
  setHotspots: (hotspots: readonly PanoramaHotspot[]) => void;
  destroy: () => void;
}

export interface PanoramaViewerOptions {
  container: HTMLElement;
  /**
   * Se llama al pinchar en el panorama, con la posicion de ese punto. Solo lo
   * usa el editor, que necesita marcar donde va un salto; en el sitio publico
   * pinchar no significa nada y se omite.
   */
  onPick?: (position: PanoramaClick) => void;
  /** Se llama al pulsar un salto ya existente. */
  onHotspot: (id: string) => void;
  /** Botonera del visor. La del editor y la publica no son la misma. */
  navbar?: string[];
  /** Camara inicial del primer panorama. */
  view?: PanoramaView | null;
}

/*
 * Los tipos de Photo Sphere Viewer no se importan de forma estatica: hacerlo
 * arrastraria el paquete al grafo del modulo aunque nunca se use. Se declara
 * la forma minima que este archivo consume.
 */
interface PsvMarker {
  id: string;
  position: { yaw: number; pitch: number };
  html: string;
  size: { width: number; height: number };
  anchor: string;
  tooltip: string;
}

interface PsvMarkersPlugin {
  clearMarkers: () => void;
  addMarker: (marker: PsvMarker) => void;
  addEventListener: (type: string, listener: (event: { marker: { id: string } }) => void) => void;
}

interface PsvViewer {
  setPanorama: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  getPlugin: (plugin: unknown) => PsvMarkersPlugin | null;
  zoom: (level: number) => void;
  /** El visor convierte grados de campo de vision a su nivel de zoom. */
  dataHelper: { fovToZoomLevel: (fov: number) => number };
  addEventListener: (
    type: string,
    listener: (event: { data: { yaw: number; pitch: number } }) => void,
  ) => void;
  destroy: () => void;
}

/** Marca circular sencilla. Sin iconos propios: eso es otra fase. */
const HOTSPOT_HTML = '<span class="tour-hotspot" aria-hidden="true"></span>';

/**
 * Traduce una camara nuestra a las opciones de `setPanorama`.
 *
 * Ojo: el CONSTRUCTOR del visor no acepta estos nombres —usa `defaultYaw` y
 * `defaultPitch`— y descarta en silencio lo que no reconoce. Por eso hay dos
 * traducciones y no una: mezclarlas hacia que el recorrido abriese siempre
 * mirando al frente, ignorando la camara que se guardo en el editor.
 */
function viewOptions(view: PanoramaView | null | undefined): Record<string, unknown> {
  if (view === null || view === undefined) return {};

  return { position: { yaw: view.yaw, pitch: view.pitch } };
}

/** Lo mismo, con los nombres que si entiende el constructor. */
function defaultViewOptions(view: PanoramaView | null | undefined): Record<string, unknown> {
  if (view === null || view === undefined) return {};

  return { defaultYaw: view.yaw, defaultPitch: view.pitch };
}

/**
 * Aplica el campo de vision guardado.
 *
 * El visor no razona en grados sino en un nivel de 0 a 100, y la conversion
 * depende de su propia configuracion, asi que se la pedimos a el en vez de
 * inventar la formula.
 */
function applyFov(viewer: PsvViewer, view: PanoramaView | null | undefined): void {
  const fov = view?.fov;
  if (fov === null || fov === undefined) return;

  viewer.zoom(viewer.dataHelper.fovToZoomLevel(fov));
}

/*
 * Los estilos del visor, como texto y no como hoja aparte.
 *
 * Importarlos de la forma normal hace que el empaquetador los enlace en el
 * `<head>` de la pagina, y entonces los descarga TODO el que abre una ficha,
 * abra el recorrido o no. Pedirlos con `?inline` los deja dentro de este
 * trozo diferido y los pone solo cuando el visor arranca de verdad.
 */
let stylesInjected = false;

async function injectStyles(): Promise<void> {
  if (stylesInjected) return;

  const [core, markers] = await Promise.all([
    import('@photo-sphere-viewer/core/index.css?inline'),
    import('@photo-sphere-viewer/markers-plugin/index.css?inline'),
  ]);

  /*
   * `insertAdjacentHTML` en vez de crear el nodo: los tipos del runtime de
   * Workers definen su propio `Element` y chocan con los del DOM.
   */
  document.head.insertAdjacentHTML(
    'beforeend',
    `<style data-panorama-viewer>${core.default}
${markers.default}</style>`,
  );

  stylesInjected = true;
}

/**
 * Crea el visor.
 *
 * Devuelve `null` si el visor no puede cargarse; el que llama debe seguir
 * funcionando en ese caso.
 */
export async function createPanoramaViewer(
  url: string,
  options: PanoramaViewerOptions,
): Promise<PanoramaViewer | null> {
  try {
    const [core, markers] = await Promise.all([
      import('@photo-sphere-viewer/core'),
      import('@photo-sphere-viewer/markers-plugin'),
      injectStyles(),
    ]);

    const viewer = new core.Viewer({
      container: options.container,
      panorama: url,
      // La navegacion con teclado del propio visor se queda activa.
      navbar: options.navbar ?? ['zoom', 'move', 'fullscreen'],
      plugins: [markers.MarkersPlugin],
      ...defaultViewOptions(options.view),
    }) as unknown as PsvViewer;

    applyFov(viewer, options.view);

    const onPick = options.onPick;
    if (onPick !== undefined) {
      viewer.addEventListener('click', (event) => {
        onPick({ yaw: event.data.yaw, pitch: event.data.pitch });
      });
    }

    const plugin = viewer.getPlugin(markers.MarkersPlugin);
    plugin?.addEventListener('select-marker', (event) => {
      options.onHotspot(event.marker.id);
    });

    return {
      async show(next: string, view?: PanoramaView | null) {
        await viewer.setPanorama(next, viewOptions(view));
        applyFov(viewer, view);
      },

      setHotspots(hotspots) {
        if (plugin === null) return;

        plugin.clearMarkers();

        for (const hotspot of hotspots) {
          plugin.addMarker({
            id: hotspot.id,
            position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
            html: HOTSPOT_HTML,
            size: { width: 32, height: 32 },
            anchor: 'center center',
            tooltip: hotspot.label,
          });
        }
      },

      destroy() {
        viewer.destroy();
      },
    };
  } catch {
    // Sin visor. La seccion sigue siendo usable con los campos numericos.
    return null;
  }
}
