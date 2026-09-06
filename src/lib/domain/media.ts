/**
 * Reglas de multimedia.
 *
 * Son las mismas que el esquema de la Fase 1C ya expresa como CHECK. Aqui se
 * repiten en TypeScript por una razon concreta: para poder devolver un error
 * de dominio comprensible en vez de dejar que la peticion muera con una
 * violacion de constraint del driver. El esquema sigue siendo la ultima
 * defensa, no la unica.
 *
 * Sin acceso a base de datos: funciones puras sobre valores ya cargados.
 */

import type { MediaKind, SourceProvider } from './vocabularies';

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Que puede encabezar la ficha.
 *
 * Corresponde a `property_media_hero_kind_check`: un documento o un panorama
 * no son portada de nada.
 */
export function canBeHero(kind: MediaKind): boolean {
  return kind === 'image' || kind === 'video';
}

/**
 * Que puede ilustrar la tarjeta del catalogo.
 *
 * Corresponde a `property_media_catalog_cover_kind_check`: solo imagenes. Un
 * video no sirve porque la tarjeta se pinta como imagen estatica.
 */
export function canBeCatalogCover(kind: MediaKind): boolean {
  return kind === 'image';
}

/* -------------------------------------------------------------------------- */
/* Fuente                                                                     */
/* -------------------------------------------------------------------------- */

export type MediaSourceProblem =
  | 'object_key_required'
  | 'object_key_not_allowed'
  | 'youtube_id_required'
  | 'youtube_id_not_allowed'
  | 'youtube_id_invalid'
  | 'youtube_only_video';

export interface MediaSource {
  mediaKind: MediaKind;
  sourceProvider: SourceProvider;
  objectKey: string | null;
  youtubeVideoId: string | null;
}

/**
 * Un identificador de video de YouTube.
 *
 * Son once caracteres del alfabeto base64url. Se comprueba la forma, nada
 * mas: no se consulta la red ni se descarga nada, asi que un id con la forma
 * correcta pero inexistente se acepta y fallara al reproducirse.
 */
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isValidYoutubeVideoId(raw: string): boolean {
  return YOUTUBE_VIDEO_ID.test(raw);
}

/**
 * Coherencia entre proveedor y tipo.
 *
 * Corresponde a `property_media_source_consistency_check`:
 *
 * - r2      -> hace falta `objectKey` y no puede haber `youtubeVideoId`;
 * - youtube -> solo video, hace falta el id y no puede haber `objectKey`.
 *
 * De ahi que no existan ni un panorama de YouTube ni un documento de YouTube.
 */
export function validateMediaSource(source: MediaSource): MediaSourceProblem[] {
  const problems: MediaSourceProblem[] = [];

  if (source.sourceProvider === 'r2') {
    if (source.objectKey === null || source.objectKey.length === 0) {
      problems.push('object_key_required');
    }
    if (source.youtubeVideoId !== null) problems.push('youtube_id_not_allowed');

    return problems;
  }

  if (source.mediaKind !== 'video') problems.push('youtube_only_video');

  if (source.youtubeVideoId === null || source.youtubeVideoId.length === 0) {
    problems.push('youtube_id_required');
  } else if (!isValidYoutubeVideoId(source.youtubeVideoId)) {
    problems.push('youtube_id_invalid');
  }

  if (source.objectKey !== null) problems.push('object_key_not_allowed');

  return problems;
}
