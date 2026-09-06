/**
 * Piezas compartidas por la capa administrativa.
 *
 * Nacieron con las caracteristicas, pero no tienen nada de especifico suyo:
 * multimedia usa exactamente las mismas reglas para el texto opcional y para
 * colocar algo al final de una lista.
 */

/** Texto opcional: se recorta y el vacio se guarda como `null`. */
export function normalizeText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Siguiente posicion dentro de un conjunto.
 *
 * Se deriva del MAXIMO existente, no de `COUNT(*)`: contar filas reutilizaria
 * la posicion de algo borrado y colocaria dos elementos en el mismo hueco.
 */
export function nextSortOrder(current: readonly number[]): number {
  if (current.length === 0) return 0;
  return Math.max(...current) + 1;
}
