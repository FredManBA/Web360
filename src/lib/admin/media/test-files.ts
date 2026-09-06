/**
 * Archivos de muestra para los tests.
 *
 * Son bytes de verdad, con la cabecera real de cada formato, de modo que la
 * comprobacion de firma se ejerce de la misma forma que con un archivo
 * subido desde el navegador. Vive en `src` por el mismo motivo que
 * `test-database.ts`: lo usan varios tests y no añade dependencias.
 */

function bytesOf(...parts: (number[] | string)[]): Uint8Array {
  const flat: number[] = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      for (const char of part) flat.push(char.charCodeAt(0));
    } else {
      flat.push(...part);
    }
  }

  return new Uint8Array(flat);
}

/** Rellena hasta un tamano minimo, para que la muestra tenga cuerpo. */
function padded(head: Uint8Array, length = 64): Uint8Array {
  const out = new Uint8Array(Math.max(length, head.length));
  out.set(head);
  return out;
}

export const SAMPLE_JPEG = padded(bytesOf([0xff, 0xd8, 0xff, 0xe0], 'JFIF'));
export const SAMPLE_PNG = padded(bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
export const SAMPLE_WEBP = padded(bytesOf('RIFF', [0x24, 0x00, 0x00, 0x00], 'WEBP', 'VP8 '));
export const SAMPLE_PDF = padded(bytesOf('%PDF-1.7'));
export const SAMPLE_MP4 = padded(bytesOf([0x00, 0x00, 0x00, 0x20], 'ftyp', 'isom'));
export const SAMPLE_WEBM = padded(bytesOf([0x1a, 0x45, 0xdf, 0xa3]));

/** Formato reconocible por un humano, pero que el proyecto no admite. */
export const SAMPLE_GIF = padded(bytesOf('GIF89a'));

/** Contenido sin firma conocida. */
export const SAMPLE_TEXT = padded(bytesOf('esto no es una imagen'));

/** Copia como `ArrayBuffer`, que es lo que recibe la capa de subida. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
