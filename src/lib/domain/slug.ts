/**
 * Slugs para las URLs publicas.
 *
 * ES y EN son independientes: cada traduccion tiene su propio slug y el
 * esquema ya garantiza UNIQUE (locale, slug). Aqui solo se normaliza y se
 * valida el formato; la resolucion de colisiones es cosa de la capa CRUD.
 */

/** Solo minusculas, digitos y guiones simples, sin guion inicial ni final. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Marcas diacriticas que NFD separa de su letra base. */
const COMBINING_MARKS = /[̀-ͯ]/g;

export const SLUG_MAX_LENGTH = 96;

/**
 * Convierte texto libre en un slug predecible.
 *
 * "Lote Vista al Mar"  -> "lote-vista-al-mar"
 * "Finca Aneja, 100%"  -> "finca-aneja-100"
 *
 * Los acentos se descomponen con NFD y se eliminan las marcas diacriticas,
 * de modo que "n con virgulilla" pasa a "n" y "a con tilde" a "a".
 */
export function toSlug(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    // Cualquier cosa que no sea letra o digito actua como separador.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length <= SLUG_MAX_LENGTH) return slug;

  // Recorta sin dejar un guion suelto al final.
  return slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, '');
}

export function isValidSlug(value: string): boolean {
  return value.length > 0 && value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}
