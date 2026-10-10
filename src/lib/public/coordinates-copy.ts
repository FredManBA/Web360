/**
 * Boton "Copiar" de las coordenadas de una ficha.
 *
 * Mejora progresiva: la coordenada ya es texto seleccionable en el HTML y el
 * boton llega oculto. Aqui se muestra y se le da funcion. Si el portapapeles no
 * esta disponible, la pagina no se rompe: el texto sigue ahi para copiarlo a
 * mano.
 */

import { confirmCopied, copyText } from './clipboard';

export function initCoordinatesCopy(): void {
  const value = document.getElementById('property-coordinates') as HTMLElement | null;
  const button = document.getElementById('property-coordinates-copy') as HTMLButtonElement | null;
  if (value === null || button === null) return;

  button.hidden = false;
  button.addEventListener('click', () => {
    void copyText(value.textContent?.trim() ?? '', value).then((copied) => {
      if (copied) confirmCopied(button);
    });
  });
}
