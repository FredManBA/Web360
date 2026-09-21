/**
 * "Explora Costa Rica" en el navegador: carrusel manual y visor 360 bajo
 * demanda.
 *
 * - Sin cambio automatico ni animaciones: se pasa de propiedad con las flechas.
 * - El visor (Photo Sphere Viewer) no se descarga hasta que alguien pulsa el
 *   boton, y solo muestra el panorama inicial: el recorrido entero vive en la
 *   ficha.
 * - Al cambiar de propiedad el visor se destruye (con su contexto WebGL) y
 *   vuelve la foto de la siguiente.
 * - Si el visor no puede crearse, no se dice nada a gritos: se queda la foto y
 *   el enlace a la propiedad. Sin reintentos automaticos.
 */

import { stepIndex } from './gallery';
import type { PanoramaView, PanoramaViewer } from '../viewer/panorama-viewer';

interface Slide {
  root: HTMLElement;
  open: HTMLButtonElement;
  container: HTMLElement;
  panorama: string;
  view: PanoramaView | null;
  position: string;
}

function readView(raw: string | undefined): PanoramaView | null {
  if (raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as PanoramaView | null;
    return parsed !== null && typeof parsed.yaw === 'number' && typeof parsed.pitch === 'number'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function initHomeExplore(): void {
  const root = document.getElementById('explore') as HTMLElement | null;
  if (root === null) return;

  const slides = ([...root.querySelectorAll('[data-explore-slide]')] as HTMLElement[]).flatMap(
    (element): Slide[] => {
      const open = element.querySelector('.explore-open') as HTMLButtonElement | null;
      const container = element.querySelector('.explore-viewer') as HTMLElement | null;
      const panorama = element.dataset.panorama;
      if (open === null || container === null || panorama === undefined) return [];

      return [
        {
          root: element,
          open,
          container,
          panorama,
          view: readView(element.dataset.view),
          position: element.dataset.position ?? '',
        },
      ];
    },
  );
  if (slides.length === 0) return;

  const controls = root.querySelector('.explore-controls') as HTMLElement | null;
  const position = root.querySelector('.explore-position') as HTMLElement | null;

  let index = 0;
  let viewer: PanoramaViewer | null = null;
  // Cada apertura o cierre invalida lo que estuviera cargandose antes.
  let generation = 0;

  const closeViewer = (): void => {
    generation += 1;
    viewer?.destroy();
    viewer = null;

    for (const slide of slides) {
      slide.container.hidden = true;
      slide.container.innerHTML = '';
      slide.root.classList.remove('is-live');
      if (slide.root.dataset.viewerFailed === undefined) {
        slide.open.hidden = false;
        slide.open.disabled = false;
      }
    }
  };

  const show = (next: number): void => {
    closeViewer();
    index = next;

    slides.forEach((slide, current) => {
      slide.root.hidden = current !== index;
    });

    if (position !== null) {
      const [visual, spoken] = [...position.children] as HTMLElement[];
      if (visual !== undefined) visual.textContent = `${index + 1} / ${slides.length}`;
      if (spoken !== undefined) spoken.textContent = slides[index]?.position ?? '';
    }
  };

  const openViewer = async (slide: Slide): Promise<void> => {
    closeViewer();
    const mine = generation;

    slide.open.disabled = true;
    slide.container.hidden = false;

    let created: PanoramaViewer | null;
    try {
      const { createPanoramaViewer } = await import('../viewer/panorama-viewer');
      if (mine !== generation) return;

      created = await createPanoramaViewer(slide.panorama, {
        container: slide.container,
        navbar: ['zoom', 'move'],
        view: slide.view,
        // En la portada no hay saltos: solo el panorama inicial.
        onHotspot: () => undefined,
      });
    } catch {
      created = null;
    }

    // Mientras cargaba, alguien cambio de propiedad o cerro: se descarta.
    if (mine !== generation) {
      created?.destroy();
      return;
    }

    if (created === null) {
      // Se queda la foto; el boton se retira para no invitar a un fallo seguro.
      slide.container.hidden = true;
      slide.container.innerHTML = '';
      slide.root.dataset.viewerFailed = 'true';
      slide.open.hidden = true;
      return;
    }

    viewer = created;
    slide.open.hidden = true;
    slide.root.classList.add('is-live');
  };

  root.dataset.interactive = 'true';

  for (const slide of slides) {
    slide.open.hidden = false;
    slide.open.addEventListener('click', () => void openViewer(slide));
  }

  if (controls !== null && slides.length > 1) {
    controls.hidden = false;
    root
      .querySelector('.explore-prev')
      ?.addEventListener('click', () => show(stepIndex(index, -1, slides.length)));
    root
      .querySelector('.explore-next')
      ?.addEventListener('click', () => show(stepIndex(index, 1, slides.length)));
  }

  show(0);
}
