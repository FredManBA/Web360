/**
 * Codigo humano de la propiedad (`CR360-001`).
 *
 * El siguiente numero se deriva del MAXIMO codigo con patron valido que ya
 * existe, nunca de `COUNT(*)`: contar filas reutilizaria el codigo de una
 * propiedad borrada y colisionaria con el UNIQUE.
 */

export const PROPERTY_CODE_PREFIX = 'CR360';
export const PROPERTY_CODE_MIN_DIGITS = 3;
export const PROPERTY_CODE_MAX_LENGTH = 64;

/**
 * Codigos generados automaticamente: CR360-001, CR360-1000...
 *
 * Se deriva del prefijo en vez de repetirlo escrito: la primera vez que el
 * prefijo cambio, tener el patron por separado habria dejado la secuencia
 * mirando codigos del nombre anterior sin que nada avisara.
 *
 * `String.raw` no es adorno: en un template literal normal `\d` se evalua
 * como `d`, y el patron casaria con `CR360-ddd` en vez de con digitos.
 */
const GENERATED_CODE_PATTERN = new RegExp(String.raw`^${PROPERTY_CODE_PREFIX}-(\d+)$`);

/**
 * Codigo editado a mano: no tiene por que seguir el patron CR360-###, pero si
 * ser seguro para URLs, nombres de archivo y busquedas.
 */
const SAFE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Siguiente codigo a partir de los ya existentes.
 *
 * Funcion pura: la consulta a base de datos vive en `create-property.ts`.
 * Ignora los codigos que no siguen el patron (los editados a mano), de modo
 * que renombrar una propiedad no rompe la secuencia.
 */
export function nextPropertyCode(existingCodes: readonly string[]): string {
  let highest = 0;

  for (const code of existingCodes) {
    const match = GENERATED_CODE_PATTERN.exec(code);
    if (match === null) continue;

    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value > highest) highest = value;
  }

  const next = highest + 1;
  return `${PROPERTY_CODE_PREFIX}-${String(next).padStart(PROPERTY_CODE_MIN_DIGITS, '0')}`;
}

export type CodeProblem = 'empty' | 'too_long' | 'unsafe_characters';

/**
 * Valida un codigo escrito por el admin. No exige el patron CR360-###: una vez
 * creado, el codigo es suyo.
 */
export function validatePropertyCode(rawCode: string): CodeProblem[] {
  const code = rawCode.trim();

  if (code.length === 0) return ['empty'];
  if (code.length > PROPERTY_CODE_MAX_LENGTH) return ['too_long'];
  if (!SAFE_CODE_PATTERN.test(code)) return ['unsafe_characters'];

  return [];
}

export function normalizePropertyCode(rawCode: string): string {
  return rawCode.trim();
}
