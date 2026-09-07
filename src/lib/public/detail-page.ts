/**
 * La ficha en el navegador.
 *
 * Tres cosas independientes, todas mejora progresiva: la galeria, el video de
 * YouTube y el recorrido 360. Si este modulo no llega a ejecutarse, la ficha
 * sigue completa —fotos, enlaces al video, lista de panoramas—, solo que sin
 * interaccion.
 *
 * Nada de esto pide datos al servidor: la pagina es estatica y todo lo que
 * hace falta ya viaja en el HTML.
 */

import { stepIndex, swipeStep } from './gallery';
import type { PublicTourNode } from './read-model';
import { destinationsOf, nodeByKey, nodeLabel, parseTour, startNode } from './tour';
import type { PanoramaViewer } from '../viewer/panorama-viewer';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------------- */
/* Galeria                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Convierte la lista de fotos en una galeria de una en una.
 *
 * Las fotos ya estan en el HTML: aqui solo se esconden las que no tocan. Las
 * ocultas no se descargan —`loading="lazy"` mas `hidden`—, asi que abrir la
 * ficha cuesta una sola fotografia por mucho que tenga la propiedad.
 */
function initGallery(): void {
  const gallery = byId<HTMLElement>('galeria');
  const stage = byId<HTMLElement>('gallery-stage');
  const controls = byId<HTMLElement>('gallery-controls');
  if (gallery === null || stage === null || controls === null) return;

  const slides = all<HTMLElement>('[data-gallery-slide]');
  // Con una sola foto no hay nada que navegar: se deja como esta.
  if (slides.length < 2) return;

  const position = byId<HTMLElement>('gallery-position');
  const template = position?.dataset.template ?? '';

  // La marca dice a la hoja de estilos que ahora se ve una foto a la vez.
  gallery.dataset.interactive = 'true';
  controls.hidden = false;

  let index = 0;

  const render = (): void => {
    slides.forEach((slide, position_) => {
      slide.hidden = position_ !== index;
    });

    if (position !== null) {
      position.textContent = template.replace('{n}', String(index + 1));
    }
  };

  const go = (step: number): void => {
    index = stepIndex(index, step, slides.length);
    render();
  };

  byId<HTMLButtonElement>('gallery-prev')?.addEventListener('click', () => go(-1));
  byId<HTMLButtonElement>('gallery-next')?.addEventListener('click', () => go(1));

  gallery.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') go(-1);
    else if (event.key === 'ArrowRight') go(1);
    else return;

    // Solo se consume la flecha cuando de verdad ha movido la galeria.
    event.preventDefault();
  });

  /*
   * Gesto en movil. Se escucha en pasivo: la galeria no cancela el scroll, y
   * `swipeStep` ya descarta lo que sea mas vertical que horizontal.
   */
  let startX = 0;
  let startY = 0;

  stage.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.changedTouches[0];
      if (touch === undefined) return;

      startX = touch.clientX;
      startY = touch.clientY;
    },
    { passive: true },
  );

  stage.addEventListener(
    'touchend',
    (event) => {
      const touch = event.changedTouches[0];
      if (touch === undefined) return;

      const step = swipeStep(touch.clientX - startX, touch.clientY - startY);
      if (step !== 0) go(step);
    },
    { passive: true },
  );

  render();
}

/* -------------------------------------------------------------------------- */
/* Video de YouTube                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Cambia la portada por el reproductor, y solo al pulsar.
 *
 * Hasta ese momento no se ha pedido nada a YouTube salvo la miniatura, que
 * ademas es diferida. El `autoplay` va aqui porque responde a una pulsacion:
 * quien acaba de darle al play espera que empiece.
 */
function initVideoFacades(): void {
  for (const facade of all<HTMLElement>('[data-video-facade]')) {
    const button = facade.querySelector('[data-video-play]');
    if (button === null) continue;

    button.addEventListener('click', () => {
      const embed = facade.dataset.embed;
      if (embed === undefined) return;

      const title = facade.dataset.title ?? '';

      /*
       * Se escribe el HTML en vez de crear nodos: los tipos del runtime de
       * Workers definen su propio `Element` y no encajan con los del DOM.
       */
      facade.innerHTML =
        `<iframe class="video-frame" src="${escapeHtml(embed)}?autoplay=1&amp;rel=0"` +
        ` title="${escapeHtml(title)}" loading="lazy" allowfullscreen` +
        ' allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"></iframe>';
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Recorrido 360                                                              */
/* -------------------------------------------------------------------------- */

interface TourTexts {
  point: string;
  goTo: string;
  current: string;
  unavailable: string;
  loading: string;
}

const DEFAULT_TEXTS: TourTexts = {
  point: '{n}',
  goTo: '{name}',
  current: '',
  unavailable: '',
  loading: '',
};

function readTexts(): TourTexts {
  const raw = byId<HTMLElement>('tour-labels')?.textContent;
  if (raw === null || raw === undefined) return DEFAULT_TEXTS;

  try {
    return { ...DEFAULT_TEXTS, ...(JSON.parse(raw) as Partial<TourTexts>) };
  } catch {
    return DEFAULT_TEXTS;
  }
}

/**
 * Prepara el recorrido.
 *
 * El visor NO se carga aqui. Ni siquiera su envoltorio: se importa dentro del
 * `click`, porque su hoja de estilos viaja con el y enlazarla en la ficha
 * costaria diez kilobytes a todo el que pasa sin abrir el recorrido. Del
 * envoltorio cuelga Photo Sphere Viewer, tambien diferido.
 */
function initTour(): void {
  const frame = byId<HTMLElement>('tour-frame');
  const open = byId<HTMLButtonElement>('tour-open');
  const container = byId<HTMLElement>('tour-viewer');
  const raw = byId<HTMLElement>('tour-data')?.textContent;
  if (frame === null || open === null || container === null) return;
  if (raw === null || raw === undefined) return;

  const tour = parseTour(raw);
  if (tour === null) return;

  const texts = readTexts();
  const naming = { pointName: (position: number) => texts.point.replace('{n}', String(position)) };

  const status = byId<HTMLElement>('tour-status');
  const nav = byId<HTMLElement>('tour-nav');
  const navList = byId<HTMLElement>('tour-nav-list');
  const current = byId<HTMLElement>('tour-current');
  const points = byId<HTMLElement>('tour-points');
  const poster = byId<HTMLElement>('tour-poster');

  // Hay JavaScript: ahora el marco significa algo.
  frame.hidden = false;

  let viewer: PanoramaViewer | null = null;

  const paint = (node: PublicTourNode): void => {
    if (current !== null) {
      current.textContent = `${texts.current}: ${nodeLabel(tour, node, naming)}`;
    }

    const destinations = destinationsOf(tour, node, naming);

    if (navList !== null) {
      navList.innerHTML = destinations
        .map(
          (destination) =>
            `<li><button type="button" class="tour-jump" data-tour-to="${escapeHtml(destination.key)}">` +
            `${escapeHtml(texts.goTo.replace('{name}', destination.label))}</button></li>`,
        )
        .join('');
    }

    viewer?.setHotspots(
      destinations.map((destination) => ({
        id: destination.key,
        yaw: destination.yaw,
        pitch: destination.pitch,
        label: texts.goTo.replace('{name}', destination.label),
      })),
    );
  };

  const goTo = async (key: string): Promise<void> => {
    const node = nodeByKey(tour, key);
    if (node === null || viewer === null) return;

    await viewer.show(node.url, node.initialView);
    paint(node);
  };

  /** El visor no ha podido cargarse: se dice, y la lista de puntos se queda. */
  const giveUp = (): void => {
    open.hidden = true;
    container.hidden = true;

    if (status !== null) {
      status.hidden = false;
      status.textContent = texts.unavailable;
    }
  };

  navList?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const key = target.dataset.tourTo;
    if (key !== undefined) void goTo(key);
  });

  byId<HTMLButtonElement>('tour-close')?.addEventListener('click', () => {
    viewer?.destroy();
    viewer = null;

    container.hidden = true;
    container.innerHTML = '';
    if (nav !== null) nav.hidden = true;
    if (points !== null) points.hidden = false;
    if (poster !== null) poster.hidden = false;

    open.hidden = false;
    open.disabled = false;
    open.focus();
  });

  open.addEventListener('click', () => {
    // Una sola oportunidad: sin reintentos automaticos.
    open.disabled = true;

    if (status !== null) {
      status.hidden = false;
      status.textContent = texts.loading;
    }

    void (async () => {
      const first = startNode(tour);
      if (first === null) {
        giveUp();
        return;
      }

      container.hidden = false;

      const { createPanoramaViewer } = await import('../viewer/panorama-viewer');

      const created = await createPanoramaViewer(first.url, {
        container,
        navbar: ['zoom', 'move', 'fullscreen'],
        view: first.initialView,
        onHotspot: (key) => void goTo(key),
      });

      if (created === null) {
        giveUp();
        return;
      }

      viewer = created;

      if (status !== null) {
        status.hidden = true;
        status.textContent = '';
      }

      open.hidden = true;
      if (poster !== null) poster.hidden = true;
      if (points !== null) points.hidden = true;
      if (nav !== null) nav.hidden = false;

      paint(first);
    })();
  });
}

/* -------------------------------------------------------------------------- */

export function initPropertyDetail(): void {
  initGallery();
  initVideoFacades();
  initTour();
}
