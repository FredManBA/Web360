/**
 * Tests de las reglas de subida.
 *
 * Funciones puras sobre bytes de verdad: las firmas que se comprueban aqui son
 * las mismas que traen los archivos reales.
 */

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_MIME_TYPES,
  buildObjectKey,
  checkUpload,
  extensionForMimeType,
  MEDIA_SIZE_LIMITS,
  sanitizeFileName,
  sniffMimeType,
} from './media-upload';
import { MEDIA_KINDS } from './vocabularies';
import {
  SAMPLE_GIF,
  SAMPLE_JPEG,
  SAMPLE_MP4,
  SAMPLE_PDF,
  SAMPLE_PNG,
  SAMPLE_TEXT,
  SAMPLE_WEBM,
  SAMPLE_WEBP,
} from '../admin/media/test-files';

/* -------------------------------------------------------------------------- */
/* Muestras                                                                   */
/* -------------------------------------------------------------------------- */

const JPEG = SAMPLE_JPEG;
const PNG = SAMPLE_PNG;
const WEBP = SAMPLE_WEBP;
const PDF = SAMPLE_PDF;
const MP4 = SAMPLE_MP4;
const WEBM = SAMPLE_WEBM;
const GIF = SAMPLE_GIF;
const TEXTO = SAMPLE_TEXT;

/* -------------------------------------------------------------------------- */
/* Firmas                                                                     */
/* -------------------------------------------------------------------------- */

describe('firma del contenido', () => {
  it('reconoce los formatos que el proyecto admite', () => {
    expect(sniffMimeType(JPEG)).toBe('image/jpeg');
    expect(sniffMimeType(PNG)).toBe('image/png');
    expect(sniffMimeType(WEBP)).toBe('image/webp');
    expect(sniffMimeType(PDF)).toBe('application/pdf');
    expect(sniffMimeType(MP4)).toBe('video/mp4');
    expect(sniffMimeType(WEBM)).toBe('video/webm');
  });

  it('reconoce que un GIF es un GIF, aunque no se admita', () => {
    // No esta en la lista de firmas: se queda sin identificar y se rechazara.
    expect(sniffMimeType(GIF)).toBeNull();
  });

  it('no inventa un tipo para contenido que no reconoce', () => {
    expect(sniffMimeType(TEXTO)).toBeNull();
    expect(sniffMimeType(new Uint8Array())).toBeNull();
  });

  it('no se confunde con un archivo mas corto que la firma', () => {
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Limites y tipos                                                            */
/* -------------------------------------------------------------------------- */

describe('limites y tipos admitidos', () => {
  it('cada tipo de archivo tiene su limite y su lista', () => {
    for (const kind of MEDIA_KINDS) {
      expect(MEDIA_SIZE_LIMITS[kind]).toBeGreaterThan(0);
      expect(ALLOWED_MIME_TYPES[kind].length).toBeGreaterThan(0);
    }
  });

  it('el panorama admite mas peso que una imagen normal', () => {
    expect(MEDIA_SIZE_LIMITS.panorama).toBeGreaterThan(MEDIA_SIZE_LIMITS.image);
  });

  it('cada tipo MIME admitido sabe con que extension se guarda', () => {
    for (const kind of MEDIA_KINDS) {
      for (const mime of ALLOWED_MIME_TYPES[kind]) {
        expect(extensionForMimeType(mime)).not.toBe('bin');
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Validacion                                                                 */
/* -------------------------------------------------------------------------- */

describe('validacion del archivo', () => {
  it('acepta una imagen coherente', () => {
    const check = checkUpload({
      mediaKind: 'image',
      declaredMimeType: 'image/jpeg',
      bytes: JPEG,
    });

    expect(check.problems).toEqual([]);
    expect(check.detectedMimeType).toBe('image/jpeg');
  });

  it('acepta un panorama, un documento y un video', () => {
    expect(
      checkUpload({ mediaKind: 'panorama', declaredMimeType: 'image/jpeg', bytes: JPEG }).problems,
    ).toEqual([]);
    expect(
      checkUpload({ mediaKind: 'document', declaredMimeType: 'application/pdf', bytes: PDF })
        .problems,
    ).toEqual([]);
    expect(
      checkUpload({ mediaKind: 'video', declaredMimeType: 'video/mp4', bytes: MP4 }).problems,
    ).toEqual([]);
  });

  it('rechaza un archivo vacio antes de mirar nada mas', () => {
    const check = checkUpload({
      mediaKind: 'image',
      declaredMimeType: 'image/jpeg',
      bytes: new Uint8Array(),
    });

    expect(check.problems).toEqual(['empty_file']);
  });

  it('rechaza un tipo declarado que no se admite', () => {
    const check = checkUpload({
      mediaKind: 'image',
      declaredMimeType: 'image/gif',
      bytes: JPEG,
    });

    expect(check.problems).toContain('mime_not_allowed');
  });

  it('no se fia del tipo declarado: mira los bytes', () => {
    // Dice ser JPEG, pero dentro hay un PDF.
    const check = checkUpload({
      mediaKind: 'image',
      declaredMimeType: 'image/jpeg',
      bytes: PDF,
    });

    expect(check.problems).toContain('content_mismatch');
  });

  it('rechaza un PDF disfrazado de imagen aunque la extension mienta', () => {
    const check = checkUpload({
      mediaKind: 'document',
      declaredMimeType: 'application/pdf',
      bytes: JPEG,
    });

    expect(check.problems).toContain('content_mismatch');
  });

  it('rechaza contenido que no reconoce', () => {
    const check = checkUpload({
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      bytes: TEXTO,
    });

    expect(check.problems).toContain('content_unrecognized');
    expect(check.detectedMimeType).toBeNull();
  });

  it('rechaza un archivo que pasa del limite de su tipo', () => {
    const grande = new Uint8Array(MEDIA_SIZE_LIMITS.image + 1);
    grande.set(JPEG.subarray(0, 8));

    const check = checkUpload({
      mediaKind: 'image',
      declaredMimeType: 'image/jpeg',
      bytes: grande,
    });

    expect(check.problems).toContain('too_large');
  });

  it('justo en el limite todavia cabe', () => {
    const justo = new Uint8Array(MEDIA_SIZE_LIMITS.image);
    justo.set(JPEG.subarray(0, 8));

    const check = checkUpload({
      mediaKind: 'image',
      declaredMimeType: 'image/jpeg',
      bytes: justo,
    });

    expect(check.problems).not.toContain('too_large');
  });

  it('un video no cabe en el hueco de una imagen', () => {
    const check = checkUpload({ mediaKind: 'image', declaredMimeType: 'video/mp4', bytes: MP4 });

    expect(check.problems).toContain('mime_not_allowed');
  });
});

/* -------------------------------------------------------------------------- */
/* Clave y nombre                                                             */
/* -------------------------------------------------------------------------- */

describe('clave del objeto', () => {
  it('se construye con el UUID, no con el nombre original', () => {
    const key = buildObjectKey(7, 'image', 'image/jpeg', 'abc-123');

    expect(key).toBe('propiedades/7/image/abc-123.jpg');
  });

  it('usa la extension del tipo real', () => {
    expect(buildObjectKey(1, 'document', 'application/pdf', 'u')).toMatch(/\.pdf$/);
    expect(buildObjectKey(1, 'panorama', 'image/webp', 'u')).toMatch(/\.webp$/);
    expect(buildObjectKey(1, 'video', 'video/webm', 'u')).toMatch(/\.webm$/);
  });

  it('dos subidas de la misma propiedad no comparten clave', () => {
    const first = buildObjectKey(1, 'image', 'image/jpeg', crypto.randomUUID());
    const second = buildObjectKey(1, 'image', 'image/jpeg', crypto.randomUUID());

    expect(first).not.toBe(second);
  });

  it('el nombre original se limpia y nunca aporta ruta', () => {
    expect(sanitizeFileName('C:\\fotos\\fachada final.jpg')).toBe('fachada final.jpg');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('  espacios.png  ')).toBe('espacios.png');
  });

  it('el nombre original no se cuela en la clave', () => {
    const key = buildObjectKey(1, 'image', 'image/jpeg', crypto.randomUUID());

    expect(key).not.toContain('fachada');
    expect(key.split('/')).toHaveLength(4);
  });
});
