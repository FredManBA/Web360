/**
 * Preferencia de idioma.
 *
 * Se guarda cuando alguien pulsa el selector, y solo se actua sobre ella en la
 * portada: llevar a un visitante a otra URL mientras lee una ficha seria
 * hostil, y ademas romperia los enlaces compartidos.
 *
 * Si el almacenamiento no esta disponible —navegacion privada, permisos— no
 * pasa nada: el sitio sigue funcionando en el idioma de la URL.
 */

/**
 * Clave del almacenamiento.
 *
 * Se define AQUI y no en `navigation.ts` a proposito: este modulo viaja al
 * navegador, y `navigation` arrastra el read model, que a su vez arrastra
 * Drizzle y el esquema entero. Importarlo metia 37 kB de codigo de servidor en
 * una pagina publica.
 */
export const LANGUAGE_STORAGE_KEY = 'codeloba:locale';

const LOCALES = ['es', 'en'] as const;
type StoredLocale = (typeof LOCALES)[number];

function isLocale(value: string | null): value is StoredLocale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

export function readLanguagePreference(): StoredLocale | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function storeLanguagePreference(locale: string): void {
  if (!isLocale(locale)) return;

  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // Sin almacenamiento no se recuerda nada; el sitio no se entera.
  }
}

/**
 * Recuerda la eleccion cuando se pulsa el selector.
 *
 * Se engancha al enlace, asi que la preferencia solo se guarda cuando alguien
 * cambia de idioma a proposito. Visitar una URL no cuenta como elegir.
 */
export function initLanguagePreference(): void {
  const link = document.querySelector('[data-locale]');
  if (link === null) return;

  link.addEventListener('click', () => {
    const chosen = (link as HTMLElement).dataset.locale;
    if (chosen !== undefined) storeLanguagePreference(chosen);
  });
}
