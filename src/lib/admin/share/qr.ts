/**
 * Codigo QR de una ficha publica, para rotulos y folletos.
 *
 * `uqr` solo calcula la matriz; el dibujo es propio para controlar lo que
 * importa al imprimir:
 *
 * - correccion de errores `Q` (25 %): un rotulo al sol o con barro sigue
 *   leyendose;
 * - margen de cuatro modulos, el que pide la norma para que el lector separe
 *   el codigo de lo que lo rodea;
 * - un solo `path` con los modulos oscuros de cada fila agrupados: el SVG es
 *   pequeno, escala sin perder nitidez y se edita bien en un programa de
 *   diseno.
 *
 * Solo lo usa el panel; el sitio publico no carga esta libreria.
 */

import { encode } from 'uqr';

export interface QrMatrix {
  /** Modulos por lado, margen incluido. */
  size: number;
  /** `true` es un modulo oscuro. */
  data: boolean[][];
}

/** Modulos de margen alrededor del codigo (zona de silencio). */
export const QR_QUIET_ZONE = 4;

export function qrMatrix(text: string): QrMatrix {
  const result = encode(text, { ecc: 'Q', border: QR_QUIET_ZONE });
  return { size: result.size, data: result.data };
}

export interface QrSvgOptions {
  /** Color de los modulos oscuros. Debe contrastar mucho con `light`. */
  dark?: string;
  light?: string;
  /** Texto accesible del SVG. */
  title?: string;
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Trazo de los modulos oscuros: un rectangulo por cada tramo seguido de una fila. */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  matrix.data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  });
  return parts.join('');
}

/** SVG autonomo, con fondo propio: se ve igual pegado sobre cualquier color. */
export function qrSvg(matrix: QrMatrix, options: QrSvgOptions = {}): string {
  const { dark = '#10291f', light = '#ffffff', title } = options;
  const size = matrix.size;
  const label = title === undefined ? '' : `<title>${escapeXml(title)}</title>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `shape-rendering="crispEdges" role="img">${label}` +
    `<rect width="${size}" height="${size}" fill="${escapeXml(light)}"/>` +
    `<path d="${qrPath(matrix)}" fill="${escapeXml(dark)}"/></svg>`
  );
}
