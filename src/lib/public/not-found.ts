/**
 * En que idioma contestar cuando la ruta no existe.
 *
 * Una funcion pura y sola en su archivo porque es lo unico de la pagina 404
 * que tiene una regla que probar: el resto es plantilla.
 *
 * La regla es la del proyecto desde el principio: a quien ya esta dentro de
 * `/es` o `/en` no se le mueve de idioma. Aunque la pagina no exista, el
 * prefijo dice en que idioma estaba navegando, y contestarle en el otro seria
 * gratuito.
 */

import type { Locale } from '../domain/vocabularies';

/**
 * El idioma que declara una ruta, o `null` si no declara ninguno.
 *
 * Se exige que el prefijo sea un segmento completo: `/espanol` no es `/es`, y
 * `/entrada` no es `/en`. Sin esa comprobacion, media web caeria en el idioma
 * equivocado por casualidad.
 */
export function localeFromPath(pathname: string): Locale | null {
  const match = /^\/(es|en)(?:\/|$)/.exec(pathname);

  return match === null ? null : (match[1] as Locale);
}
