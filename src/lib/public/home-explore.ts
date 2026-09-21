/**
 * "Explora Costa Rica" en el navegador.
 *
 * - El visor (Photo Sphere Viewer) no se descarga hasta que la seccion se
 *   acerca a la pantalla: no compite con el hero ni con la primera pintura.
 * - Solo existe un visor a la vez, el del panorama visible. Al cambiar de
 *   panorama se destruye (con su contexto WebGL) y se crea el siguiente.
 * - Carrusel manual: sin cambio automatico ni animaciones.
 * - Si el visor no puede crearse, se queda el panorama como foto recortada y
 *   no se vuelve a intentar con los demas: sin WebGL fallarian igual.
 */

import { stepIndex } from './gallery';
import type { PanoramaViewer } from '../viewer/panorama-viewer';

function readList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function byId<T extends object>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function initHomeExplore(): void {
  const root = byId<HTMLElement>('explore');
  const still = byId<HTMLImageElement>('explore-still');
  const container = byId<HTMLElement>('explore-viewer');
  if (root === null || still === null || container === null) return;

  const panoramas = readList(root.dataset.panoramas);
  const positions = readList(root.dataset.positions);
  if (panoramas.length === 0) return;

  const controls = byId<HTMLElement>('explore-controls');
  const position = byId<HTMLElement>('explore-position');

  let index = 0;
  let viewer: PanoramaViewer | null = null;
  // Cada montaje o desmontaje invalida lo que estuviera cargandose antes.
  let generation = 0;
  let near = false;
  let unavailable = false;

  const unmount = (): void => {
    generation += 1;
    viewer?.destroy();
    viewer = null;
    container.hidden = true;
    container.innerHTML = '';
    root.classList.remove('is-live');
  };

  const mount = async (): Promise<void> => {
    if (unavailable || !near) return;

    unmount();
    const mine = generation;
    const url = panoramas[index];
    if (url === undefined) return;

    // El visor necesita un contenedor visible para medir.
    container.hidden = false;

    let created: PanoramaViewer | null;
    try {
      const { createPanoramaViewer } = await import('../viewer/panorama-viewer');
      if (mine !== generation) return;

      created = await createPanoramaViewer(url, {
        container,
        navbar: ['zoom', 'move'],
        // Panoramas sueltos: no hay saltos que atender.
        onHotspot: () => undefined,
      });
    } catch {
      created = null;
    }

    // Mientras cargaba, alguien cambio de panorama: se descarta.
    if (mine !== generation) {
      created?.destroy();
      return;
    }

    if (created === null) {
      // Sin visor: se queda la foto recortada, sin mensajes.
      unavailable = true;
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    viewer = created;
    root.classList.add('is-live');
  };

  const show = (next: number): void => {
    index = next;
    const url = panoramas[index];
    if (url !== undefined) still.src = url;

    if (position !== null) {
      const [visual, spoken] = [...position.children] as HTMLElement[];
      if (visual !== undefined) visual.textContent = `${index + 1} / ${panoramas.length}`;
      if (spoken !== undefined) spoken.textContent = positions[index] ?? '';
    }

    unmount();
    void mount();
  };

  if (controls !== null && panoramas.length > 1) {
    controls.hidden = false;
    byId<HTMLButtonElement>('explore-prev')?.addEventListener('click', () =>
      show(stepIndex(index, -1, panoramas.length)),
    );
    byId<HTMLButtonElement>('explore-next')?.addEventListener('click', () =>
      show(stepIndex(index, 1, panoramas.length)),
    );
  }

  const start = (): void => {
    near = true;
    void mount();
  };

  if (!('IntersectionObserver' in window)) {
    start();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    },
    { rootMargin: '200px 0px' },
  );
  observer.observe(root);
}
