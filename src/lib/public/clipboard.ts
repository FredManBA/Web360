/**
 * Copiar al portapapeles, con respaldo.
 *
 * La API moderna necesita un contexto seguro y permiso; si no esta o falla,
 * se prueba el metodo antiguo seleccionando el texto de un elemento. Devuelve
 * si se copio, para que quien llama confirme solo cuando es verdad.
 */
export async function copyText(text: string, source: HTMLElement | null = null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sin permiso o contexto no seguro: se intenta el metodo antiguo.
  }

  if (source === null) return false;

  try {
    const selection = window.getSelection();
    if (selection === null) return false;
    if (source instanceof HTMLInputElement) {
      source.select();
    } else {
      const range = document.createRange();
      range.selectNodeContents(source);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

/** Tiempo que se muestra la confirmacion antes de volver al texto normal. */
export const CONFIRMATION_MS = 2000;

/**
 * Cambia el texto de un boton a su confirmacion (`data-copied`) un momento y
 * lo devuelve despues. El boton debe tener su texto normal ya puesto.
 */
export function confirmCopied(button: HTMLElement): void {
  const idle = button.dataset.idle ?? button.textContent?.trim() ?? '';
  button.dataset.idle = idle;
  button.textContent = button.dataset.copied ?? idle;
  window.clearTimeout(Number(button.dataset.resetTimer));
  button.dataset.resetTimer = String(
    window.setTimeout(() => {
      button.textContent = idle;
    }, CONFIRMATION_MS),
  );
}
