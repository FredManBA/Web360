/**
 * Tests de las reglas de multimedia.
 *
 * Funciones puras: las mismas condiciones que los CHECK del esquema, pero
 * evaluadas antes de llegar a la base para poder explicar el problema.
 */

import { describe, expect, it } from 'vitest';

import { canBeCatalogCover, canBeHero, isValidYoutubeVideoId, validateMediaSource } from './media';
import { MEDIA_KINDS } from './vocabularies';

describe('roles admitidos por tipo', () => {
  it('encabeza la ficha una imagen o un vídeo', () => {
    expect(canBeHero('image')).toBe(true);
    expect(canBeHero('video')).toBe(true);
  });

  it('no encabezan la ficha ni un documento ni un panorama', () => {
    expect(canBeHero('document')).toBe(false);
    expect(canBeHero('panorama')).toBe(false);
  });

  it('la portada del catálogo solo admite imágenes', () => {
    const covers = MEDIA_KINDS.filter(canBeCatalogCover);

    expect(covers).toEqual(['image']);
  });
});

describe('identificador de YouTube', () => {
  it('acepta los once caracteres del formato real', () => {
    expect(isValidYoutubeVideoId('dQw4w9WgXcQ')).toBe(true);
    expect(isValidYoutubeVideoId('_-aBcDeF012')).toBe(true);
  });

  it('rechaza una URL completa, un id corto o uno con caracteres raros', () => {
    expect(isValidYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe(false);
    expect(isValidYoutubeVideoId('dQw4w9WgX')).toBe(false);
    expect(isValidYoutubeVideoId('dQw4w9WgXc!')).toBe(false);
    expect(isValidYoutubeVideoId('')).toBe(false);
  });
});

describe('coherencia de la fuente', () => {
  it('R2 necesita clave de objeto y nada de YouTube', () => {
    expect(
      validateMediaSource({
        mediaKind: 'image',
        sourceProvider: 'r2',
        objectKey: 'fotos/uno.jpg',
        youtubeVideoId: null,
      }),
    ).toEqual([]);
  });

  it('R2 sin clave se detecta', () => {
    expect(
      validateMediaSource({
        mediaKind: 'image',
        sourceProvider: 'r2',
        objectKey: null,
        youtubeVideoId: null,
      }),
    ).toEqual(['object_key_required']);
  });

  it('R2 con identificador de YouTube se detecta', () => {
    expect(
      validateMediaSource({
        mediaKind: 'video',
        sourceProvider: 'r2',
        objectKey: 'videos/uno.mp4',
        youtubeVideoId: 'dQw4w9WgXcQ',
      }),
    ).toEqual(['youtube_id_not_allowed']);
  });

  it('YouTube vale para vídeo con su identificador', () => {
    expect(
      validateMediaSource({
        mediaKind: 'video',
        sourceProvider: 'youtube',
        objectKey: null,
        youtubeVideoId: 'dQw4w9WgXcQ',
      }),
    ).toEqual([]);
  });

  it('YouTube no vale para ningún otro tipo', () => {
    for (const mediaKind of ['image', 'document', 'panorama'] as const) {
      expect(
        validateMediaSource({
          mediaKind,
          sourceProvider: 'youtube',
          objectKey: null,
          youtubeVideoId: 'dQw4w9WgXcQ',
        }),
      ).toContain('youtube_only_video');
    }
  });

  it('YouTube sin identificador, o con uno mal formado, se detecta', () => {
    expect(
      validateMediaSource({
        mediaKind: 'video',
        sourceProvider: 'youtube',
        objectKey: null,
        youtubeVideoId: null,
      }),
    ).toEqual(['youtube_id_required']);

    expect(
      validateMediaSource({
        mediaKind: 'video',
        sourceProvider: 'youtube',
        objectKey: null,
        youtubeVideoId: 'ID con espacios',
      }),
    ).toEqual(['youtube_id_invalid']);
  });

  it('YouTube con clave de R2 se detecta', () => {
    expect(
      validateMediaSource({
        mediaKind: 'video',
        sourceProvider: 'youtube',
        objectKey: 'videos/uno.mp4',
        youtubeVideoId: 'dQw4w9WgXcQ',
      }),
    ).toEqual(['object_key_not_allowed']);
  });
});
