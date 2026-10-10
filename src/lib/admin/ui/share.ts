/**
 * "Compartir" en el editor de una propiedad: enlace y QR de su ficha publica.
 *
 * Se dibuja en el navegador y no en el servidor porque el slug y el estado
 * cambian sin recargar: al guardar o publicar, el editor avisa con el evento
 * `r2-property` y el enlace y el QR se rehacen solos.
 */

import { confirmCopied, copyText } from '../../public/clipboard';
import { propertyShareUrl } from '../../public/share';
import { qrMatrix, qrSvg, type QrMatrix } from '../share/qr';

type ShareLocale = 'es' | 'en';

interface ShareState {
  code: string;
  status: string;
  slugEs: string | null;
  slugEn: string | null;
}

/** Lado del PNG, en pixeles. Da de sobra para imprimir un rotulo de 20 cm. */
const PNG_SIZE = 1200;

function download(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // El navegador ya tiene el archivo; la URL temporal sobra.
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** El PNG se dibuja modulo a modulo: nitido a cualquier tamano, sin pasar por el SVG. */
function pngBlob(matrix: QrMatrix): Promise<Blob | null> {
  const scale = Math.max(1, Math.floor(PNG_SIZE / matrix.size));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = matrix.size * scale;
  const context = canvas.getContext('2d');
  if (context === null) return Promise.resolve(null);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#10291f';
  matrix.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) context.fillRect(x * scale, y * scale, scale, scale);
    }),
  );

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function initShare(): void {
  const root = document.getElementById('r2-share');
  const origin = root?.dataset.origin;
  if (root === null || origin === undefined) return;

  const state: ShareState = {
    code: root.dataset.code ?? 'propiedad',
    status: root.dataset.status ?? 'draft',
    slugEs: root.dataset.slugEs || null,
    slugEn: root.dataset.slugEn || null,
  };

  const draft = document.getElementById('r2-share-draft');
  const current = new Map<ShareLocale, { url: string; matrix: QrMatrix; svg: string }>();

  const render = (): void => {
    if (draft !== null) draft.hidden = state.status === 'published';

    for (const item of root.querySelectorAll<HTMLElement>('[data-share-locale]')) {
      const locale = item.dataset.shareLocale as ShareLocale;
      const slug = locale === 'es' ? state.slugEs : state.slugEn;
      const body = item.querySelector<HTMLElement>('[data-share-body]');
      const missing = item.querySelector<HTMLElement>('[data-share-missing]');

      if (body !== null) body.hidden = slug === null;
      if (missing !== null) missing.hidden = slug !== null;
      if (slug === null) {
        current.delete(locale);
        continue;
      }

      const url = propertyShareUrl(origin, locale, slug);
      if (current.get(locale)?.url === url) continue;

      const matrix = qrMatrix(url);
      const svg = qrSvg(matrix, { title: `QR ${state.code} (${locale.toUpperCase()})` });
      current.set(locale, { url, matrix, svg });

      const input = item.querySelector<HTMLInputElement>('[data-share-url]');
      if (input !== null) input.value = url;
      const open = item.querySelector<HTMLAnchorElement>('[data-share-action="open"]');
      if (open !== null) open.href = url;
      const preview = item.querySelector<HTMLElement>('[data-share-qr]');
      if (preview !== null) preview.innerHTML = svg;
    }
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      'button[data-share-action]',
    );
    const item = button?.closest<HTMLElement>('[data-share-locale]');
    if (!button || !item) return;

    const locale = item.dataset.shareLocale as ShareLocale;
    const share = current.get(locale);
    if (share === undefined) return;
    const filename = `${state.code}-${locale}-qr`;

    switch (button.dataset.shareAction) {
      case 'copy':
        void copyText(share.url, item.querySelector('[data-share-url]')).then((copied) => {
          if (copied) confirmCopied(button);
        });
        break;
      case 'svg':
        download(
          new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${share.svg}`], {
            type: 'image/svg+xml',
          }),
          `${filename}.svg`,
        );
        break;
      case 'png':
        void pngBlob(share.matrix).then((blob) => {
          if (blob !== null) download(blob, `${filename}.png`);
        });
        break;
    }
  });

  // El editor avisa al guardar, publicar o retirar: slug y estado pueden cambiar.
  document.addEventListener('r2-property', (event) => {
    const property = (event as CustomEvent<Partial<ShareState>>).detail;
    state.status = property.status ?? state.status;
    state.slugEs = property.slugEs ?? null;
    state.slugEn = property.slugEn ?? null;
    render();
  });

  render();
}
