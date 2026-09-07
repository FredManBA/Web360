/**
 * Envoltorio de Mapbox GL JS.
 *
 * Mapbox pesa varios cientos de kilobytes y solo hace falta cuando alguien
 * mira un mapa de verdad, asi que se carga con `import()` diferido, igual que
 * el visor de panoramas. Sus estilos viajan como texto dentro del mismo trozo
 * diferido: importarlos de la forma normal hace que el empaquetador los
 * enlace en el `<head>`, y entonces los descarga tambien quien abre una ficha
 * sin ubicacion.
 *
 * Si algo falla —sin token, sin WebGL, red caida— devuelve `null` y quien
 * llama debe seguir funcionando. Nunca se deja una caja rota: la ubicacion en
 * texto esta siempre en el HTML, con mapa o sin el.
 *
 * Aqui no hay ninguna regla de privacidad porque no puede haberla: solo
 * recibe `MapPoint`, que ya viene con la coordenada publica y nada mas.
 */

import { MAX_ZOOM, type MapPoint, type MapViewport } from './map';

/** Textos que el mapa necesita en el idioma de la pagina. */
export interface MapTexts {
  zoomIn: string;
  zoomOut: string;
  resetNorth: string;
  approximate: string;
  openProperty: string;
}

export interface PublicMapOptions {
  container: HTMLElement;
  /** Token publico de Mapbox. Sin el, no se crea nada. */
  token: string;
  points: readonly MapPoint[];
  viewport: MapViewport;
  texts: MapTexts;
  /** Se llama al elegir un marcador, con el `slug` de su propiedad. */
  onSelect?: (slug: string) => void;
  /** Limite de acercamiento; en una ficha depende de la precision. */
  maxZoom?: number;
  /** Una ficha muestra un mapa quieto: sin arrastrar ni hacer zoom con rueda. */
  compact?: boolean;
}

export interface PublicMap {
  /** Centra el mapa en una propiedad y abre su ficha flotante. */
  select: (slug: string) => void;
  destroy: () => void;
}

/*
 * Los tipos de Mapbox no se importan de forma estatica: eso arrastraria el
 * paquete al grafo del modulo aunque nunca se use. Se declara la forma minima
 * que este archivo consume.
 */
interface MapboxPopup {
  setHTML: (html: string) => MapboxPopup;
  setLngLat: (position: [number, number]) => MapboxPopup;
  addTo: (map: MapboxMap) => MapboxPopup;
  remove: () => void;
  isOpen: () => boolean;
}

interface MapboxMarker {
  setLngLat: (position: [number, number]) => MapboxMarker;
  setPopup: (popup: MapboxPopup) => MapboxMarker;
  addTo: (map: MapboxMap) => MapboxMarker;
  togglePopup: () => MapboxMarker;
  getPopup: () => MapboxPopup | undefined;
  remove: () => void;
}

interface MapboxMap {
  addControl: (control: unknown, position?: string) => MapboxMap;
  fitBounds: (bounds: [[number, number], [number, number]], options?: unknown) => void;
  flyTo: (options: unknown) => void;
  scrollZoom: { disable: () => void };
  dragPan: { disable: () => void };
  resize: () => void;
  remove: () => void;
  on: (type: string, listener: () => void) => void;
}

const PADDING = 64;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let stylesInjected = false;

async function injectStyles(): Promise<void> {
  if (stylesInjected) return;

  const css = await import('mapbox-gl/dist/mapbox-gl.css?inline');

  /*
   * `insertAdjacentHTML` en vez de crear el nodo: los tipos del runtime de
   * Workers definen su propio `Element` y chocan con los del DOM.
   */
  document.head.insertAdjacentHTML('beforeend', `<style data-mapbox>${css.default}</style>`);
  stylesInjected = true;
}

/**
 * Marcador de una propiedad.
 *
 * Es un `<button>` de verdad, no un `<div>` decorado: asi se alcanza con el
 * tabulador y se activa con Intro sin escribir ni una linea de teclado.
 *
 * Una ubicacion aproximada se dibuja distinta —un anillo abierto en vez de una
 * chincheta— y lo dice en su texto accesible, para que nadie lea el punto como
 * si fuera la parcela.
 */
function markerElement(point: MapPoint, texts: MapTexts): HTMLButtonElement {
  const element = document.createElement('button');

  element.type = 'button';
  element.className =
    point.precision === 'approximate' ? 'map-pin map-pin--approximate' : 'map-pin';
  element.dataset.slug = point.slug;

  const suffix = point.precision === 'approximate' ? ` (${texts.approximate})` : '';
  element.setAttribute('aria-label', `${point.title}${suffix}`);
  element.innerHTML = '<span class="map-pin-mark" aria-hidden="true"></span>';

  return element;
}

/** Ficha flotante del marcador. Repite lo que ya esta en el listado. */
function popupHtml(point: MapPoint, texts: MapTexts): string {
  const place =
    point.place === null ? '' : `<p class="map-popup-place">${escapeHtml(point.place)}</p>`;

  const area =
    point.areaText === null
      ? ''
      : `<span class="map-popup-area">${escapeHtml(point.areaText)}</span>`;

  const approximate =
    point.precision === 'approximate'
      ? `<p class="map-popup-approximate">${escapeHtml(texts.approximate)}</p>`
      : '';

  const image =
    point.imageUrl === null
      ? ''
      : `<img class="map-popup-image" src="${escapeHtml(point.imageUrl)}" alt="${escapeHtml(point.imageAlt ?? point.title)}" loading="lazy">`;

  return (
    `<div class="map-popup">${image}` +
    `<h3 class="map-popup-title">${escapeHtml(point.title)}</h3>` +
    place +
    `<p class="map-popup-facts"><span class="map-popup-price">${escapeHtml(point.priceText)}</span>${area}</p>` +
    approximate +
    `<a class="map-popup-link" href="${escapeHtml(point.href)}">${escapeHtml(texts.openProperty)}</a>` +
    '</div>'
  );
}

/**
 * Crea el mapa.
 *
 * Devuelve `null` si no hay token o si Mapbox no puede cargarse; el que llama
 * se queda con la ubicacion en texto, que nunca depende de esto.
 */
export async function createPublicMap(options: PublicMapOptions): Promise<PublicMap | null> {
  if (options.token.length === 0) return null;

  try {
    const [mapbox] = await Promise.all([import('mapbox-gl'), injectStyles()]);
    const mapboxgl = mapbox.default;

    mapboxgl.accessToken = options.token;

    const map = new mapboxgl.Map({
      container: options.container,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      maxZoom: options.maxZoom ?? MAX_ZOOM.exact,
      attributionControl: true,
      ...initialView(options.viewport),
    }) as unknown as MapboxMap;

    /*
     * Los controles de Mapbox llegan con sus textos en ingles; se traducen,
     * porque son parte de la pagina como cualquier otro boton.
     */
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: !(options.compact === true) }),
      'top-right',
    );

    if (options.compact === true) {
      // En una ficha el mapa no debe secuestrar el scroll de la pagina.
      map.scrollZoom.disable();
    }

    translateControls(options.container, options.texts);

    /*
     * La ficha flotante se mide contra el mapa que la contiene, no contra un
     * ancho fijo: en un mapa pequeno una ficha de 17rem se sale por el lado y
     * el contenedor la recorta.
     */
    const popupWidth = `${Math.min(272, Math.round(options.container.clientWidth * 0.68))}px`;

    const popups = new Map<string, MapboxPopup>();
    const markers = new Map<string, MapboxMarker>();

    /*
     * Solo una ficha flotante a la vez.
     *
     * Mapbox cierra la suya al pinchar en el mapa, pero no al elegir otra
     * propiedad: sin esto quedaban dos abiertas, y con dos propiedades
     * cercanas se solapaban en pantalla.
     */
    const closeOthers = (keep: string): void => {
      for (const [slug, popup] of popups) {
        if (slug !== keep && popup.isOpen()) popup.remove();
      }
    };

    for (const point of options.points) {
      const position: [number, number] = [point.longitude, point.latitude];

      const popup = new mapboxgl.Popup({
        offset: 18,
        closeButton: true,
        maxWidth: popupWidth,
      }).setHTML(popupHtml(point, options.texts)) as unknown as MapboxPopup;

      const element = markerElement(point, options.texts);
      element.addEventListener('click', () => {
        closeOthers(point.slug);
        options.onSelect?.(point.slug);
      });

      const marker = new mapboxgl.Marker({ element })
        .setLngLat(position)
        .setPopup(popup as never)
        .addTo(map as never) as unknown as MapboxMarker;

      popups.set(point.slug, popup);
      markers.set(point.slug, marker);
    }

    // Con varios puntos se encuadra a todos; con uno, el zoom ya viene puesto.
    if (options.viewport.kind === 'bounds') {
      const { west, south, east, north } = options.viewport.bounds;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: PADDING, maxZoom: options.maxZoom ?? MAX_ZOOM.exact, duration: 0 },
      );
    }

    return {
      select(slug: string) {
        const point = options.points.find((candidate) => candidate.slug === slug);
        const marker = markers.get(slug);
        if (point === undefined || marker === undefined) return;

        closeOthers(slug);

        map.flyTo({
          center: [point.longitude, point.latitude],
          zoom: SELECTED_ZOOM[point.precision],
          duration: prefersReducedMotion() ? 0 : 700,
        });

        const popup = marker.getPopup();
        if (popup !== undefined && !popup.isOpen()) marker.togglePopup();
      },

      destroy() {
        for (const marker of markers.values()) marker.remove();
        map.remove();
      },
    };
  } catch {
    // Sin mapa. La ubicacion en texto y el listado siguen en su sitio.
    return null;
  }
}

/** Al elegir una propiedad no se cae en el maximo: se respeta su precision. */
const SELECTED_ZOOM = { exact: 15, approximate: 12 } as const;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Centro y zoom iniciales; con varios puntos los pone luego `fitBounds`. */
function initialView(viewport: MapViewport): Record<string, unknown> {
  if (viewport.kind === 'single') {
    return { center: [viewport.longitude, viewport.latitude], zoom: viewport.zoom };
  }

  // Costa Rica, para que el mapa no abra sobre el Atlantico mientras encuadra.
  return { center: [-84.1, 9.9], zoom: 6 };
}

/**
 * Traduce los botones que Mapbox escribe en ingles.
 *
 * Mapbox no expone estos textos por configuracion en todas las versiones, y
 * son tres atributos: se ajustan sobre el DOM que acaba de crear.
 */
function translateControls(container: HTMLElement, texts: MapTexts): void {
  const labels: Record<string, string> = {
    '.mapboxgl-ctrl-zoom-in': texts.zoomIn,
    '.mapboxgl-ctrl-zoom-out': texts.zoomOut,
    '.mapboxgl-ctrl-compass': texts.resetNorth,
  };

  for (const [selector, label] of Object.entries(labels)) {
    const button = container.querySelector(selector);
    if (button === null) continue;

    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }
}
