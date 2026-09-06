/**
 * Envoltorio del visor de panoramas.
 *
 * Photo Sphere Viewer y Three pesan bastante y solo hacen falta en esta
 * seccion del panel, asi que se cargan con `import()` dinamico: el resto del
 * editor no arrastra ese peso.
 *
 * Todo lo que ofrece el visor tiene alternativa numerica en el formulario. Si
 * la carga falla —red, navegador viejo, sin WebGL— la seccion sigue siendo
 * usable y se dice por que: el visor es una ayuda, no el unico camino.
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

export interface PanoramaViewer {
  /** Cambia el panorama que se esta mirando. */
  show: (url: string) => Promise<void>;
  /** Pinta los saltos del nodo actual. */
  setHotspots: (hotspots: readonly PanoramaHotspot[]) => void;
  destroy: () => void;
}

export interface PanoramaViewerOptions {
  container: HTMLElement;
  /** Se llama al pinchar en el panorama, con la posicion de ese punto. */
  onPick: (position: PanoramaClick) => void;
  /** Se llama al pulsar un salto ya existente. */
  onHotspot: (id: string) => void;
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
  setPanorama: (url: string) => Promise<unknown>;
  getPlugin: (plugin: unknown) => PsvMarkersPlugin | null;
  addEventListener: (
    type: string,
    listener: (event: { data: { yaw: number; pitch: number } }) => void,
  ) => void;
  destroy: () => void;
}

/** Marca circular sencilla. Sin iconos propios: eso es otra fase. */
const HOTSPOT_HTML = '<span class="tour-hotspot" aria-hidden="true"></span>';

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
    /*
     * Los estilos del visor viajan en el mismo trozo diferido que su codigo:
     * asi el resto del panel no carga nada de esto.
     */
    const [core, markers] = await Promise.all([
      import('@photo-sphere-viewer/core'),
      import('@photo-sphere-viewer/markers-plugin'),
      import('@photo-sphere-viewer/core/index.css'),
      import('@photo-sphere-viewer/markers-plugin/index.css'),
    ]);

    const viewer = new core.Viewer({
      container: options.container,
      panorama: url,
      // La navegacion con teclado del propio visor se queda activa.
      navbar: ['zoom', 'move', 'fullscreen'],
      plugins: [markers.MarkersPlugin],
    }) as unknown as PsvViewer;

    viewer.addEventListener('click', (event) => {
      options.onPick({ yaw: event.data.yaw, pitch: event.data.pitch });
    });

    const plugin = viewer.getPlugin(markers.MarkersPlugin);
    plugin?.addEventListener('select-marker', (event) => {
      options.onHotspot(event.marker.id);
    });

    return {
      async show(next: string) {
        await viewer.setPanorama(next);
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
