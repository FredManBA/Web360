/**
 * Reglas de subida de archivos.
 *
 * Funciones puras: limites, tipos admitidos y comprobacion del contenido real.
 * No tocan R2 ni la base de datos.
 *
 * Por que se miran los bytes y no la extension: tanto el nombre del archivo
 * como el `type` que declara el navegador los controla quien sube. Un `.jpg`
 * puede ser cualquier cosa. Se comprueba la firma de los primeros bytes, que
 * es barata, no necesita dependencias y descarta lo evidente.
 *
 * Esto NO es un antivirus: reconocer la firma solo demuestra que el archivo
 * empieza como dice, no que su contenido sea inofensivo.
 */

import type { MediaKind } from './vocabularies';

/* -------------------------------------------------------------------------- */
/* Limites                                                                    */
/* -------------------------------------------------------------------------- */

const MB = 1024 * 1024;

/**
 * Tamano maximo por tipo, en bytes.
 *
 * El Worker carga el archivo entero en memoria para comprobar su firma y su
 * tamano antes de escribir nada en R2, asi que los limites se quedan
 * holgadamente por debajo del presupuesto de memoria del isolate. Para video
 * largo la via es YouTube, que no pasa por aqui.
 */
export const MEDIA_SIZE_LIMITS: Record<MediaKind, number> = {
  image: 12 * MB,
  // Las equirectangulares de 360 son bastante mas pesadas que una foto normal.
  panorama: 30 * MB,
  document: 20 * MB,
  video: 50 * MB,
};

/** Tipos MIME admitidos por cada tipo de archivo. */
export const ALLOWED_MIME_TYPES: Record<MediaKind, readonly string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  panorama: ['image/jpeg', 'image/png', 'image/webp'],
  document: ['application/pdf'],
  video: ['video/mp4', 'video/webm'],
};

/** Extension con la que se guarda cada tipo MIME en R2. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export function extensionForMimeType(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? 'bin';
}

/* -------------------------------------------------------------------------- */
/* Firma del contenido                                                        */
/* -------------------------------------------------------------------------- */

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;

  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Compara una porcion con texto ASCII, para firmas como "RIFF" o "ftyp". */
function hasAscii(bytes: Uint8Array, text: string, offset: number): boolean {
  if (bytes.length < offset + text.length) return false;

  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }

  return true;
}

/**
 * Deduce el tipo real a partir de los primeros bytes.
 *
 * Devuelve `null` cuando la firma no se reconoce; el que llama decide si eso
 * es motivo suficiente para rechazar el archivo.
 */
export function sniffMimeType(bytes: Uint8Array): string | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG: 89 "PNG" CR LF 1A LF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // WebP: contenedor RIFF con la marca "WEBP" en el byte 8.
  if (hasAscii(bytes, 'RIFF', 0) && hasAscii(bytes, 'WEBP', 8)) return 'image/webp';

  // PDF: "%PDF-"
  if (hasAscii(bytes, '%PDF-', 0)) return 'application/pdf';

  // MP4 y familia: caja "ftyp" en el byte 4.
  if (hasAscii(bytes, 'ftyp', 4)) return 'video/mp4';

  /*
   * WebM: cabecera EBML. Matroska comparte esta firma, asi que un .mkv
   * renombrado pasaria; se acepta como coste razonable de no analizar el
   * contenedor entero.
   */
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';

  return null;
}

/* -------------------------------------------------------------------------- */
/* Validacion                                                                 */
/* -------------------------------------------------------------------------- */

export type UploadProblem =
  'empty_file' | 'mime_not_allowed' | 'content_unrecognized' | 'content_mismatch' | 'too_large';

export interface UploadCandidate {
  mediaKind: MediaKind;
  /** Lo que declara el navegador. Se comprueba, no se cree. */
  declaredMimeType: string;
  bytes: Uint8Array;
}

export interface UploadCheck {
  problems: UploadProblem[];
  /** Tipo deducido de los bytes; es el que se guarda si todo cuadra. */
  detectedMimeType: string | null;
}

/**
 * Comprueba que el archivo pueda subirse.
 *
 * El orden importa: primero lo barato (vacio, tipo declarado, tamano) y
 * despues la firma. Se devuelven todos los problemas encontrados para poder
 * explicar el mas relevante.
 */
export function checkUpload(candidate: UploadCandidate): UploadCheck {
  const { mediaKind, declaredMimeType, bytes } = candidate;
  const problems: UploadProblem[] = [];

  if (bytes.length === 0) {
    return { problems: ['empty_file'], detectedMimeType: null };
  }

  const allowed = ALLOWED_MIME_TYPES[mediaKind];
  const declared = declaredMimeType.trim().toLowerCase();

  if (!allowed.includes(declared)) problems.push('mime_not_allowed');
  if (bytes.length > MEDIA_SIZE_LIMITS[mediaKind]) problems.push('too_large');

  const detectedMimeType = sniffMimeType(bytes);

  if (detectedMimeType === null) {
    problems.push('content_unrecognized');
  } else if (!allowed.includes(detectedMimeType)) {
    // El contenido es reconocible, pero no es lo que este tipo admite.
    problems.push('content_mismatch');
  } else if (problems.includes('mime_not_allowed')) {
    // Ya se ha senalado el tipo declarado; no hace falta repetirlo.
  } else if (detectedMimeType !== declared) {
    /*
     * JPEG se declara a veces como `image/jpg`, y algunos navegadores mandan
     * `application/octet-stream`. Como el tipo declarado ya paso el filtro de
     * admitidos, aqui solo queda el caso de declarar un tipo admitido y subir
     * otro distinto, que si es una contradiccion.
     */
    problems.push('content_mismatch');
  }

  return { problems, detectedMimeType };
}

/* -------------------------------------------------------------------------- */
/* Clave del objeto                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Ruta del objeto en R2.
 *
 * NO se deriva del nombre original: ese nombre lo elige quien sube y podria
 * traer rutas, caracteres raros o colisiones. Se usa un UUID, y la propiedad y
 * el tipo van en el prefijo solo para que el bucket sea navegable.
 */
export function buildObjectKey(
  propertyId: number,
  mediaKind: MediaKind,
  mimeType: string,
  uuid: string,
): string {
  return `propiedades/${propertyId}/${mediaKind}/${uuid}.${extensionForMimeType(mimeType)}`;
}

/**
 * Nombre original, recortado y sin rutas.
 *
 * Solo viaja como metadato del objeto en R2, para poder reconocerlo desde el
 * panel de Cloudflare. Nunca forma parte de la clave.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';

  /*
   * Se filtran los caracteres de control uno a uno en vez de con una expresion
   * regular: escribirlos dentro de un patron es justo la clase de literal que
   * se cuela mal en un fichero fuente.
   */
  const printable = [...base].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });

  return printable.join('').trim().slice(0, 120);
}
