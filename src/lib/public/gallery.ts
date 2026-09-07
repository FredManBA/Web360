/**
 * Galeria de la ficha: la parte que no necesita DOM.
 *
 * Es poca cosa a proposito. No hay libreria de carrusel porque no hace falta
 * ninguna: la galeria es una lista de fotos de la que se ve una, y todo lo que
 * hay que decidir es cual. Eso se prueba mejor aqui que en un navegador.
 */

/**
 * La siguiente foto, dando la vuelta al llegar al final.
 *
 * Se envuelve en vez de pararse en el extremo: con pocas fotos, encontrarse el
 * boton muerto es mas molesto que volver al principio.
 */
export function stepIndex(current: number, step: number, total: number): number {
  if (total <= 0) return 0;

  return (((current + step) % total) + total) % total;
}

/** Cuanto hay que arrastrar el dedo para que cuente como pasar de foto. */
export const SWIPE_THRESHOLD = 40;

/**
 * Que significa un gesto.
 *
 * Solo cuenta si es claramente horizontal: si el dedo baja mas de lo que se
 * mueve de lado, la persona esta haciendo scroll y la galeria no debe robarle
 * el gesto.
 */
export function swipeStep(deltaX: number, deltaY: number): -1 | 0 | 1 {
  if (Math.abs(deltaX) < SWIPE_THRESHOLD) return 0;
  if (Math.abs(deltaX) <= Math.abs(deltaY)) return 0;

  // Arrastrar hacia la izquierda avanza, como pasar una pagina.
  return deltaX < 0 ? 1 : -1;
}
