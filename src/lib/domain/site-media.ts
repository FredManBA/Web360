/**
 * La media global del sitio: logo, favicon, imagen social y portada.
 *
 * Son cuatro huecos fijos, no una biblioteca. Cada uno admite UNA imagen y se
 * identifica por su nombre, no por un id: no hay nada que listar, ordenar ni
 * relacionar. Por eso vive aqui y no en `property_media`, que es de cada
 * propiedad —con sus roles, su orden y su ciclo de vida— y arrastraria todo
 * eso a algo que no lo necesita.
 *
 * Que NO se admite, y por que:
 *
 * - SVG. Un SVG es un documento con scripts y referencias externas; validarlo
 *   de verdad es otro problema, y el sniffer de este proyecto no lo hace. Se
 *   queda fuera hasta que exista esa validacion;
 * - ICO. El detector de contenido no lo reconoce, y aceptar lo que no se sabe
 *   comprobar seria confiar en la extension. Un PNG vale como favicon en
 *   cualquier navegador actual;
 * - video, en cualquier hueco. La portada de la Home es una fotografia.
 */

import { sniffMimeType, type UploadProblem } from './media-upload';

const KB = 1024;
const MB = 1024 * KB;

/** Los cuatro huecos. El nombre es el identificador, y no hay mas. */
export const SITE_MEDIA_SLOTS = ['logo', 'favicon', 'social', 'hero'] as const;
export type SiteMediaSlot = (typeof SITE_MEDIA_SLOTS)[number];

export function isSiteMediaSlot(value: string): value is SiteMediaSlot {
  return (SITE_MEDIA_SLOTS as readonly string[]).includes(value);
}

export interface SiteMediaRule {
  /** Tipos que se aceptan, comprobados contra el contenido real. */
  mimeTypes: readonly string[];
  /** Tamano maximo en bytes. */
  maxBytes: number;
  /** Como se llama el hueco en el panel. */
  label: string;
}

/**
 * Que admite cada hueco.
 *
 * Los limites no son iguales porque los usos no lo son: un favicon de 8 MB no
 * tiene sentido, y una portada de 512 KB se veria mal en una pantalla grande.
 */
export const SITE_MEDIA_RULES: Record<SiteMediaSlot, SiteMediaRule> = {
  logo: {
    mimeTypes: ['image/png', 'image/webp', 'image/jpeg'],
    maxBytes: 2 * MB,
    label: 'Logo',
  },
  favicon: {
    mimeTypes: ['image/png', 'image/webp', 'image/jpeg'],
    // Un icono de pestana es diminuto; cualquier cosa mayor esta equivocada.
    maxBytes: 512 * KB,
    label: 'Favicon',
  },
  social: {
    mimeTypes: ['image/png', 'image/webp', 'image/jpeg'],
    // Lo que piden las redes ronda 1200x630: de sobra con esto.
    maxBytes: 5 * MB,
    label: 'Imagen social',
  },
  hero: {
    mimeTypes: ['image/jpeg', 'image/webp', 'image/png'],
    // Es una fotografia a pantalla completa: necesita margen.
    maxBytes: 8 * MB,
    label: 'Portada de la Home',
  },
};

export interface SiteUploadCandidate {
  slot: SiteMediaSlot;
  /** Tipo que declara el navegador. Se comprueba contra los bytes. */
  declaredMimeType: string;
  bytes: Uint8Array;
}

export interface SiteUploadCheck {
  problems: UploadProblem[];
  /** El tipo real, deducido del contenido. `null` si no se reconocio. */
  detectedMimeType: string | null;
}

/**
 * Comprueba una subida de media global.
 *
 * Mismo criterio que la multimedia de propiedades —y el mismo detector de
 * contenido—, pero con las reglas de cada hueco: lo que decide es lo que hay
 * DENTRO del archivo, no lo que diga el navegador ni la extension.
 */
export function checkSiteUpload(candidate: SiteUploadCandidate): SiteUploadCheck {
  const { slot, bytes } = candidate;
  const rule = SITE_MEDIA_RULES[slot];
  const declared = candidate.declaredMimeType.trim().toLowerCase();

  const problems: UploadProblem[] = [];

  if (bytes.length === 0) problems.push('empty_file');
  if (!rule.mimeTypes.includes(declared)) problems.push('mime_not_allowed');
  if (bytes.length > rule.maxBytes) problems.push('too_large');

  const detectedMimeType = sniffMimeType(bytes);

  if (detectedMimeType === null) {
    problems.push('content_unrecognized');
  } else if (!rule.mimeTypes.includes(detectedMimeType)) {
    // El contenido es reconocible, pero no es lo que este hueco admite.
    problems.push('content_mismatch');
  } else if (!problems.includes('mime_not_allowed') && detectedMimeType !== declared) {
    /*
     * El tipo declarado ya paso el filtro, asi que aqui solo queda el caso de
     * declarar uno admitido y subir otro distinto, que si es una
     * contradiccion.
     */
    problems.push('content_mismatch');
  }

  return { problems, detectedMimeType };
}

/**
 * La clave del objeto en R2.
 *
 * Bajo `sitio/`, separada de `propiedades/`: al mirar el bucket se ve de un
 * vistazo que es de quien, y ninguna de las dos puede pisar a la otra. Sale de
 * un UUID, nunca del nombre del archivo, que lo elige quien sube.
 */
export function buildSiteObjectKey(slot: SiteMediaSlot, extension: string, uuid: string): string {
  return `sitio/${slot}/${uuid}.${extension}`;
}
