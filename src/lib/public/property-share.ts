/**
 * Botones de compartir de la ficha, en el navegador.
 *
 * Mejora progresiva sobre `PropertyShare.astro`: WhatsApp ya funciona sin
 * script; aqui se activan "Copiar enlace" y, si el navegador lo tiene, el menu
 * nativo de compartir.
 */

import { confirmCopied, copyText } from './clipboard';

export function initPropertyShare(): void {
  const root = document.getElementById('property-share');
  const url = root?.dataset.shareUrl;
  if (root === null || url === undefined) return;

  const title = root.dataset.shareTitle ?? document.title;

  const copy = document.getElementById('property-share-copy') as HTMLButtonElement | null;
  if (copy !== null) {
    copy.hidden = false;
    copy.addEventListener('click', () => {
      void copyText(url).then((copied) => {
        if (copied) confirmCopied(copy);
      });
    });
  }

  const native = document.getElementById('property-share-native') as HTMLButtonElement | null;
  const data = { title, url };
  if (
    native !== null &&
    typeof navigator.share === 'function' &&
    navigator.canShare?.(data) !== false
  ) {
    native.hidden = false;
    native.addEventListener('click', () => {
      // Cancelar el menu tambien rechaza la promesa: no es un error.
      navigator.share(data).catch(() => undefined);
    });
  }
}
