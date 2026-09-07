/**
 * Los mapas en el navegador.
 *
 * Dos usos del mismo motor: la pagina de mapa, donde el mapa manda y hay un
 * listado al lado, y el mapa pequeno de una ficha.
 *
 * Mejora progresiva, como el resto del sitio publico: el HTML ya trae el
 * listado completo y la ubicacion en texto. Este modulo solo aparece si hay
 * JavaScript, y entonces ensena el mapa. Sin el —o sin token, o sin WebGL— no
 * queda ningun hueco roto, queda la pagina de antes.
 */

import { MAX_ZOOM, parseMapPoints, viewportFor, type MapPoint } from './map';
import { createPublicMap, type MapTexts } from './mapbox';

/*
 * Aserciones en vez del generico de `querySelector`: los tipos del runtime de
 * Workers definen su propio `Element` (el de HTMLRewriter) y chocan con el DOM.
 */
function byId<T extends object>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function all<T extends object>(selector: string): T[] {
  return [...document.querySelectorAll(selector)] as T[];
}

const DEFAULT_TEXTS: MapTexts = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetNorth: 'Reset north',
  approximate: 'Approximate location',
  openProperty: 'Open',
};

function readTexts(id: string): MapTexts {
  const raw = byId<HTMLElement>(id)?.textContent;
  if (raw === null || raw === undefined) return DEFAULT_TEXTS;

  try {
    return { ...DEFAULT_TEXTS, ...(JSON.parse(raw) as Partial<MapTexts>) };
  } catch {
    return DEFAULT_TEXTS;
  }
}

function readPoints(id: string): MapPoint[] {
  const raw = byId<HTMLElement>(id)?.textContent;
  return raw === null || raw === undefined ? [] : parseMapPoints(raw);
}

/* -------------------------------------------------------------------------- */
/* Pagina de mapa                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Mapa protagonista con su listado al lado.
 *
 * El listado es la interfaz de verdad: esta en el HTML, se recorre con el
 * tabulador y cada propiedad enlaza a su ficha. El mapa anade el "donde", y
 * los dos se senalan mutuamente.
 */
export function initMapPage(): void {
  const canvas = byId<HTMLElement>('map-canvas');
  if (canvas === null) return;

  const points = readPoints('map-data');
  if (points.length === 0) return;

  const token = canvas.dataset.token ?? '';
  const texts = readTexts('map-labels');

  const items = all<HTMLElement>('[data-map-item]');
  const itemOf = new Map(items.map((item) => [item.dataset.slug ?? '', item]));

  /** Deja marcada la propiedad elegida, en el mapa y en el listado. */
  const highlight = (slug: string): void => {
    for (const item of items) {
      const current = item.dataset.slug === slug;
      item.classList.toggle('is-current', current);

      const button = item.querySelector('[data-map-focus]');
      if (button !== null) button.setAttribute('aria-pressed', String(current));
    }
  };

  // Sin token no se destapa nada: el listado ya es la pagina.
  if (token.length === 0) {
    showUnavailable();
    return;
  }

  const explorer = byId<HTMLElement>('map-explorer');

  /*
   * El contenedor se destapa y se coloca ANTES de crear el mapa: Mapbox mide
   * la caja al nacer, y no vuelve a mirarla. Sobre un elemento oculto se
   * queda de tamano cero, y si el ancho cambia despues —al pasar a dos
   * columnas— el encuadre se queda con las medidas viejas y los marcadores
   * acaban fuera de la vista.
   */
  canvas.hidden = false;
  explorer?.classList.add('has-map');

  void (async () => {
    const map = await createPublicMap({
      container: canvas,
      token,
      points,
      viewport: viewportFor(points),
      texts,
      onSelect: (slug) => {
        highlight(slug);
        itemOf.get(slug)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      },
    });

    if (map === null) {
      // Sin mapa, el listado recupera la pagina entera.
      canvas.hidden = true;
      explorer?.classList.remove('has-map');
      showUnavailable();
      return;
    }

    canvas.dataset.ready = 'true';

    for (const item of items) {
      const button = item.querySelector('[data-map-focus]');
      const slug = item.dataset.slug;
      if (button === null || slug === undefined) continue;

      (button as HTMLElement).hidden = false;
      button.addEventListener('click', () => {
        map.select(slug);
        highlight(slug);
      });
    }
  })();
}

function showUnavailable(): void {
  const notice = byId<HTMLElement>('map-unavailable');
  if (notice !== null) notice.hidden = false;
}

/* -------------------------------------------------------------------------- */
/* Mapa de una ficha                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Mapa discreto de una propiedad.
 *
 * Es un extra: la ubicacion en texto esta siempre encima, y si el mapa no
 * carga no se pierde ningun dato. Con ubicacion aproximada no se deja acercar
 * tanto, para no insinuar una precision que no existe.
 */
export function initPropertyMap(): void {
  const canvas = byId<HTMLElement>('property-map');
  if (canvas === null) return;

  const points = readPoints('property-map-data');
  const point = points[0];
  if (point === undefined) return;

  const token = canvas.dataset.token ?? '';
  const texts = readTexts('property-map-labels');

  if (token.length === 0) return;

  canvas.hidden = false;

  void (async () => {
    const map = await createPublicMap({
      container: canvas,
      token,
      points,
      viewport: viewportFor(points),
      texts,
      compact: true,
      maxZoom: MAX_ZOOM[point.precision],
    });

    if (map === null) {
      canvas.hidden = true;
      return;
    }

    canvas.dataset.ready = 'true';
  })();
}
