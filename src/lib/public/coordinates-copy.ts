/**
 * Boton "Copiar" de las coordenadas de una ficha.
 *
 * Mejora progresiva: la coordenada ya es texto seleccionable en el HTML y el
 * boton llega oculto. Aqui se muestra y se le da funcion. Si el portapapeles no
 * esta disponible, la pagina no se rompe: el texto sigue ahi para copiarlo a
 * mano.
 */

/** Tiempo que se muestra la confirmacion antes de volver al texto normal. */
const CONFIRMATION_MS = 2000;

/**
 * Copia el texto. Si la API moderna no esta o falla, se prueba el metodo
 * antiguo sobre el propio texto seleccionado.
 */
async function copyText(source: HTMLElement, text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sin permiso o contexto no seguro: se intenta el metodo antiguo.
  }

  try {
    const selection = window.getSelection();
    if (selection === null) return false;
    const range = document.createRange();
    range.selectNodeContents(source);
    selection.removeAllRanges();
    selection.addRange(range);
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

export function initCoordinatesCopy(): void {
  const value = document.getElementById('property-coordinates') as HTMLElement | null;
  const button = document.getElementById('property-coordinates-copy') as HTMLButtonElement | null;
  if (value === null || button === null) return;

  const idle = button.textContent?.trim() ?? '';
  const done = button.dataset.copied ?? idle;
  let reset: ReturnType<typeof setTimeout> | undefined;

  button.hidden = false;
  button.addEventListener('click', () => {
    void copyText(value, value.textContent?.trim() ?? '').then((copied) => {
      if (!copied) return;

      button.textContent = done;
      clearTimeout(reset);
      reset = setTimeout(() => {
        button.textContent = idle;
      }, CONFIRMATION_MS);
    });
  });
}
