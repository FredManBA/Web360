/**
 * Tests de la UI de multimedia.
 *
 * Tres frentes: el estado y la cola de subidas como funciones puras, el
 * cliente con `fetch` inyectado, y comprobaciones estructurales sobre la
 * pagina y el modulo de DOM. Sin navegador y sin dependencias nuevas.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMediaApi, MEDIA_API_MESSAGES } from './media-api';
import {
  addMedia,
  applyCatalogCover,
  applyHero,
  catalogCoverId,
  clearFinishedUploads,
  createUploadItem,
  formatFileSize,
  groupDisplayName,
  hasActiveUploads,
  heroId,
  isEmpty,
  isGroupDirty,
  isMediaDirty,
  markMediaSaved,
  mediaDisplayName,
  mediaKindLabel,
  mediaOfGroup,
  mediaPatch,
  removeGroup,
  removeMedia,
  runUploadQueue,
  stateFromApi,
  summarizeUploads,
  ungroupedMedia,
  type ApiMedia,
  type ApiMediaView,
  type UploadAttempt,
  type UploadItem,
} from './media-editor-state';
import { deleteGroupMessage, deleteMediaMessage } from './media-editor';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const MEDIA_SCRIPT = 'src/lib/admin/ui/media-editor.ts';
const EDITOR_SCRIPT = 'src/lib/admin/ui/editor-page.ts';
const EDITOR_PAGE = 'src/pages/admin/propiedades/[id].astro';
const ADMIN_CSS = 'src/styles/admin.css';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function apiMedia(overrides: Partial<ApiMedia> = {}): ApiMedia {
  return {
    id: 1,
    groupId: null,
    sortOrder: 0,
    mediaKind: 'image',
    sourceProvider: 'r2',
    objectKey: 'propiedades/1/image/abc.jpg',
    youtubeVideoId: null,
    mimeType: 'image/jpeg',
    fileSizeBytes: 240_512,
    isHero: false,
    isCatalogCover: false,
    translations: {},
    ...overrides,
  };
}

function view(overrides: Partial<ApiMediaView> = {}): ApiMediaView {
  return { groups: [], ungrouped: [], heroId: null, catalogCoverId: null, ...overrides };
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchDouble(reply: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      headers[key.toLowerCase()] = String(value);
    }

    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ?? null,
    };

    calls.push(call);
    return await reply(call);
  };

  return { calls, fetch: impl as unknown as typeof fetch };
}

/* -------------------------------------------------------------------------- */
/* Carga y estado vacio                                                       */
/* -------------------------------------------------------------------------- */

describe('carga de la seccion', () => {
  it('una propiedad sin archivos queda vacia', () => {
    const state = stateFromApi(view());

    expect(isEmpty(state)).toBe(true);
    expect(heroId(state)).toBeNull();
    expect(catalogCoverId(state)).toBeNull();
  });

  it('conserva el orden de grupos y archivos que devuelve la API', () => {
    const state = stateFromApi(
      view({
        groups: [
          {
            id: 7,
            sortOrder: 0,
            names: { es: 'Galería' },
            media: [apiMedia({ id: 9, groupId: 7 })],
          },
          { id: 3, sortOrder: 1, names: { es: 'Planos' }, media: [] },
        ],
        ungrouped: [apiMedia({ id: 4 })],
      }),
    );

    expect(state.groups.map((group) => group.id)).toEqual([7, 3]);
    expect(mediaOfGroup(state, 7).map((item) => item.id)).toEqual([9]);
    expect(ungroupedMedia(state).map((item) => item.id)).toEqual([4]);
  });

  it('los textos ausentes llegan como cadena vacia, no como "null"', () => {
    const state = stateFromApi(
      view({
        ungrouped: [
          apiMedia({ translations: { es: { title: 'Fachada', altText: null, caption: null } } }),
        ],
      }),
    );

    expect(state.media[0]?.draft.titleEs).toBe('Fachada');
    expect(state.media[0]?.draft.altTextEs).toBe('');
    expect(state.media[0]?.draft.titleEn).toBe('');
  });

  it('recuerda los datos tecnicos que no se editan', () => {
    const state = stateFromApi(view({ ungrouped: [apiMedia({ mimeType: 'image/webp' })] }));

    expect(state.media[0]?.mimeType).toBe('image/webp');
    expect(state.media[0]?.sourceProvider).toBe('r2');
  });
});

/* -------------------------------------------------------------------------- */
/* Cambios pendientes                                                         */
/* -------------------------------------------------------------------------- */

describe('cambios pendientes', () => {
  const withMedia = () =>
    stateFromApi(
      view({
        groups: [
          {
            id: 1,
            sortOrder: 0,
            names: { es: 'Galería', en: 'Gallery' },
            media: [apiMedia({ id: 5, groupId: 1 })],
          },
        ],
      }),
    );

  it('lo recien cargado no tiene nada pendiente', () => {
    const state = withMedia();

    expect(isGroupDirty(state.groups[0]!)).toBe(false);
    expect(isMediaDirty(state.media[0]!)).toBe(false);
  });

  it('escribir un titulo deja el archivo sucio', () => {
    const state = withMedia();
    state.media[0]!.draft.titleEs = 'Fachada';

    expect(isMediaDirty(state.media[0]!)).toBe(true);
  });

  it('cambiar el grupo elegido tambien cuenta', () => {
    const state = withMedia();
    state.media[0]!.draft.groupId = null;

    expect(isMediaDirty(state.media[0]!)).toBe(true);
  });

  it('renombrar el grupo lo deja sucio', () => {
    const state = withMedia();
    state.groups[0]!.draft.nameEs = 'Fotos';

    expect(isGroupDirty(state.groups[0]!)).toBe(true);
  });

  it('el parche no incluye tipo, proveedor ni roles', () => {
    const state = withMedia();
    const patch = mediaPatch(state.media[0]!);

    expect(patch).not.toHaveProperty('mediaKind');
    expect(patch).not.toHaveProperty('sourceProvider');
    expect(patch).not.toHaveProperty('isHero');
    expect(patch).not.toHaveProperty('propertyId');
    expect(Object.keys(patch)).toContain('groupId');
  });
});

/* -------------------------------------------------------------------------- */
/* Mover entre grupos                                                         */
/* -------------------------------------------------------------------------- */

describe('mover un archivo de grupo', () => {
  const state = () =>
    stateFromApi(
      view({
        groups: [
          { id: 1, sortOrder: 0, names: {}, media: [apiMedia({ id: 5, groupId: 1 })] },
          { id: 2, sortOrder: 1, names: {}, media: [] },
        ],
      }),
    );

  it('no se mueve visualmente hasta que el guardado sale bien', () => {
    const current = state();
    const entry = current.media[0]!;

    entry.draft.groupId = 2;

    // Sigue donde estaba.
    expect(mediaOfGroup(current, 1).map((item) => item.id)).toEqual([5]);
    expect(mediaOfGroup(current, 2)).toHaveLength(0);

    markMediaSaved(entry, { ...entry.draft }, 0);

    expect(mediaOfGroup(current, 1)).toHaveLength(0);
    expect(mediaOfGroup(current, 2).map((item) => item.id)).toEqual([5]);
  });

  it('se puede sacar del grupo y dejarlo suelto', () => {
    const current = state();
    const entry = current.media[0]!;

    entry.draft.groupId = null;
    markMediaSaved(entry, { ...entry.draft });

    expect(ungroupedMedia(current).map((item) => item.id)).toEqual([5]);
  });

  it('lo escrito durante el guardado sigue pendiente', () => {
    const current = state();
    const entry = current.media[0]!;

    const snapshot = { ...entry.draft, titleEs: 'Fachada' };
    // El usuario sigue escribiendo mientras viaja la peticion.
    entry.draft.titleEs = 'Fachada principal';

    markMediaSaved(entry, snapshot);

    expect(isMediaDirty(entry)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

describe('grupos de multimedia', () => {
  it('el nombre visible cae del espanol al ingles y avisa', () => {
    expect(groupDisplayName({ nameEs: 'Galería', nameEn: 'Gallery' })).toEqual({
      text: 'Galería',
      missingSpanish: false,
    });
    expect(groupDisplayName({ nameEs: '', nameEn: 'Gallery' })).toEqual({
      text: 'Gallery',
      missingSpanish: true,
    });
    expect(groupDisplayName({ nameEs: '  ', nameEn: '' }).text).toBe('Grupo sin nombre');
  });

  it('borrar el grupo NO borra sus archivos: pasan a sin grupo', () => {
    const state = stateFromApi(
      view({
        groups: [
          {
            id: 1,
            sortOrder: 0,
            names: {},
            media: [apiMedia({ id: 5, groupId: 1 }), apiMedia({ id: 6, groupId: 1 })],
          },
        ],
      }),
    );

    removeGroup(state, 1);

    expect(state.groups).toHaveLength(0);
    expect(ungroupedMedia(state).map((item) => item.id)).toEqual([5, 6]);
  });

  it('al borrar el grupo, sus archivos no quedan marcados como sucios', () => {
    const state = stateFromApi(
      view({
        groups: [{ id: 1, sortOrder: 0, names: {}, media: [apiMedia({ id: 5, groupId: 1 })] }],
      }),
    );

    removeGroup(state, 1);

    expect(isMediaDirty(state.media[0]!)).toBe(false);
  });

  it('borrar un archivo solo quita ese', () => {
    const state = stateFromApi(view({ ungrouped: [apiMedia({ id: 1 }), apiMedia({ id: 2 })] }));

    removeMedia(state, 1);

    expect(state.media.map((item) => item.id)).toEqual([2]);
  });
});

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

describe('portada de ficha y de catalogo', () => {
  const state = () =>
    stateFromApi(
      view({
        ungrouped: [apiMedia({ id: 1 }), apiMedia({ id: 2 }), apiMedia({ id: 3 })],
      }),
    );

  it('solo hay un hero a la vez', () => {
    const current = state();

    applyHero(current, 1, true);
    applyHero(current, 2, true);

    expect(heroId(current)).toBe(2);
    expect(current.media.filter((item) => item.isHero)).toHaveLength(1);
  });

  it('solo hay una portada de catalogo a la vez', () => {
    const current = state();

    applyCatalogCover(current, 1, true);
    applyCatalogCover(current, 3, true);

    expect(catalogCoverId(current)).toBe(3);
    expect(current.media.filter((item) => item.isCatalogCover)).toHaveLength(1);
  });

  it('un rol se puede retirar sin darselo a nadie', () => {
    const current = state();

    applyHero(current, 1, true);
    applyHero(current, 1, false);

    expect(heroId(current)).toBeNull();
  });

  it('los dos roles pueden recaer en la misma imagen', () => {
    const current = state();

    applyHero(current, 1, true);
    applyCatalogCover(current, 1, true);

    expect(heroId(current)).toBe(1);
    expect(catalogCoverId(current)).toBe(1);
  });

  it('la tarjeta solo ofrece el rol que su tipo admite', () => {
    const script = read(MEDIA_SCRIPT);

    // Hero: imagen o video. Portada de catalogo: solo imagen.
    expect(script).toContain("entry.mediaKind === 'image' || entry.mediaKind === 'video'");
    expect(script).toContain("entry.mediaKind === 'image'\n        ?");
  });
});

/* -------------------------------------------------------------------------- */
/* Cola de subidas                                                            */
/* -------------------------------------------------------------------------- */

describe('cola de subidas', () => {
  function queueOf(...names: string[]): { queue: UploadItem[]; files: Map<string, File> } {
    const queue: UploadItem[] = [];
    const files = new Map<string, File>();

    names.forEach((name, index) => {
      const key = `upload-${index + 1}`;
      queue.push(createUploadItem(key, { name, size: 1024 }));
      files.set(key, new File([new Uint8Array([1, 2, 3])], name));
    });

    return { queue, files };
  }

  function runner(send: (file: File) => Promise<UploadAttempt>) {
    const uploaded: ApiMedia[] = [];
    let progress = 0;

    return {
      uploaded,
      get progress() {
        return progress;
      },
      runner: {
        send,
        onUploaded: (media: ApiMedia) => uploaded.push(media),
        onProgress: () => {
          progress += 1;
        },
      },
    };
  }

  it('sube varios archivos, uno detras de otro', async () => {
    const { queue, files } = queueOf('a.jpg', 'b.jpg', 'c.jpg');
    let id = 0;

    const control = runner(() => {
      id += 1;
      return Promise.resolve({ ok: true, media: apiMedia({ id }) });
    });

    await runUploadQueue(queue, files, control.runner);

    expect(queue.map((item) => item.status)).toEqual(['done', 'done', 'done']);
    expect(control.uploaded).toHaveLength(3);
  });

  it('el fallo de uno no bloquea ni revierte a los demas', async () => {
    const { queue, files } = queueOf('buena.jpg', 'mala.jpg', 'otra.jpg');
    let id = 0;

    const control = runner((file) => {
      if (file.name === 'mala.jpg') {
        return Promise.resolve({ ok: false, message: 'El archivo está vacío.' });
      }

      id += 1;
      return Promise.resolve({ ok: true, media: apiMedia({ id }) });
    });

    await runUploadQueue(queue, files, control.runner);

    expect(queue.map((item) => item.status)).toEqual(['done', 'error', 'done']);
    // Las dos buenas se quedan subidas.
    expect(control.uploaded).toHaveLength(2);
  });

  it('cada error conserva su propio mensaje', async () => {
    const { queue, files } = queueOf('grande.jpg', 'rara.jpg');

    const control = runner((file) =>
      Promise.resolve({
        ok: false,
        message: file.name === 'grande.jpg' ? 'Supera el tamaño.' : 'No reconocemos el contenido.',
      }),
    );

    await runUploadQueue(queue, files, control.runner);

    expect(queue[0]?.error).toBe('Supera el tamaño.');
    expect(queue[1]?.error).toBe('No reconocemos el contenido.');
  });

  it('las subidas son secuenciales, nunca simultaneas', async () => {
    const { queue, files } = queueOf('a.jpg', 'b.jpg');
    let inFlight = 0;
    let maxInFlight = 0;

    const control = runner(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true, media: apiMedia() };
    });

    await runUploadQueue(queue, files, control.runner);

    expect(maxInFlight).toBe(1);
  });

  it('lo que ya termino no se vuelve a subir', async () => {
    const { queue, files } = queueOf('a.jpg', 'b.jpg');
    queue[0]!.status = 'done';

    let calls = 0;
    const control = runner(() => {
      calls += 1;
      return Promise.resolve({ ok: true, media: apiMedia() });
    });

    await runUploadQueue(queue, files, control.runner);

    expect(calls).toBe(1);
  });

  it('el resumen cuenta lo subido y lo fallido', () => {
    const { queue } = queueOf('a.jpg', 'b.jpg', 'c.jpg');
    queue[0]!.status = 'done';
    queue[1]!.status = 'error';

    expect(summarizeUploads(queue)).toEqual({ total: 3, done: 1, failed: 1 });
  });

  it('queda trabajo mientras haya algo en espera o subiendo', () => {
    const { queue } = queueOf('a.jpg');

    expect(hasActiveUploads(queue)).toBe(true);
    queue[0]!.status = 'done';
    expect(hasActiveUploads(queue)).toBe(false);
  });

  it('limpiar la lista deja los errores a la vista', () => {
    const { queue } = queueOf('a.jpg', 'b.jpg');
    queue[0]!.status = 'done';
    queue[1]!.status = 'error';

    const rest = clearFinishedUploads(queue);

    expect(rest.map((item) => item.fileName)).toEqual(['b.jpg']);
  });

  it('un archivo que ya no esta se anota como error, sin romper la cola', async () => {
    const { queue, files } = queueOf('a.jpg', 'b.jpg');
    files.delete('upload-1');

    const control = runner(() => Promise.resolve({ ok: true, media: apiMedia() }));

    await runUploadQueue(queue, files, control.runner);

    expect(queue[0]?.status).toBe('error');
    expect(queue[1]?.status).toBe('done');
  });
});

/* -------------------------------------------------------------------------- */
/* Cliente                                                                    */
/* -------------------------------------------------------------------------- */

describe('cliente de la API', () => {
  it('la subida va a su endpoint y viaja como formulario', async () => {
    const double = fetchDouble(() => jsonResponse({ data: apiMedia() }, 201));

    const file = new File([new Uint8Array([1])], 'fachada.jpg', { type: 'image/jpeg' });
    await createMediaApi(7, double.fetch).upload({ file, mediaKind: 'image', groupId: 3 });

    const call = double.calls[0];
    expect(call?.url).toBe('/api/admin/properties/7/media/upload');
    expect(call?.method).toBe('POST');
    expect(call?.body).toBeInstanceOf(FormData);

    // Sin `content-type` propio: lo pone el navegador con su boundary.
    expect(call?.headers['content-type']).toBeUndefined();

    const form = call?.body as FormData;
    expect(form.get('mediaKind')).toBe('image');
    expect(form.get('groupId')).toBe('3');
  });

  it('sin grupo, el formulario no manda el campo', async () => {
    const double = fetchDouble(() => jsonResponse({ data: apiMedia() }, 201));

    const file = new File([new Uint8Array([1])], 'fachada.jpg');
    await createMediaApi(1, double.fetch).upload({ file, mediaKind: 'image', groupId: null });

    expect((double.calls[0]?.body as FormData).has('groupId')).toBe(false);
  });

  it('el rechazo de una subida conserva el motivo que da el servidor', async () => {
    const double = fetchDouble(() =>
      jsonResponse(
        {
          error: {
            code: 'media_upload_rejected',
            message: 'El archivo supera el tamaño máximo permitido. El máximo es de 12 MB.',
          },
        },
        422,
      ),
    );

    const file = new File([new Uint8Array([1])], 'grande.jpg');
    const result = await createMediaApi(1, double.fetch).upload({
      file,
      mediaKind: 'image',
      groupId: null,
    });

    expect(result).toEqual({
      ok: false,
      message: 'El archivo supera el tamaño máximo permitido. El máximo es de 12 MB.',
    });
  });

  it('si el almacenamiento no responde, el mensaje lo dice sin tecnicismos', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'media_upload_failed' } }, 502));

    const file = new File([new Uint8Array([1])], 'fachada.jpg');
    const result = await createMediaApi(1, double.fetch).upload({
      file,
      mediaKind: 'image',
      groupId: null,
    });

    expect(result).toEqual({ ok: false, message: MEDIA_API_MESSAGES.storage });
  });

  it('YouTube va al endpoint JSON, sin tocar la subida', async () => {
    const double = fetchDouble(() => jsonResponse({ data: apiMedia() }, 201));

    await createMediaApi(2, double.fetch).createYoutube({
      youtubeVideoId: 'dQw4w9WgXcQ',
      groupId: null,
      titleEs: 'Recorrido',
    });

    const call = double.calls[0];
    expect(call?.url).toBe('/api/admin/properties/2/media');
    expect(call?.headers['content-type']).toBe('application/json');

    const body = JSON.parse(String(call?.body)) as Record<string, unknown>;
    expect(body.sourceProvider).toBe('youtube');
    expect(body.youtubeVideoId).toBe('dQw4w9WgXcQ');
    expect(body.titleEs).toBe('Recorrido');
    expect(body).not.toHaveProperty('propertyId');
  });

  it('dos clics seguidos en YouTube no crean dos videos', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const double = fetchDouble(async () => {
      await held;
      return jsonResponse({ data: apiMedia() }, 201);
    });

    const api = createMediaApi(1, double.fetch);
    const first = api.createYoutube({ youtubeVideoId: 'dQw4w9WgXcQ', groupId: null });
    const second = await api.createYoutube({ youtubeVideoId: 'dQw4w9WgXcQ', groupId: null });

    expect(second).toBeNull();

    release();
    await first;

    expect(double.calls).toHaveLength(1);
  });

  it('los roles se piden a la ruta atomica', async () => {
    const double = fetchDouble(() => jsonResponse({ data: {} }));

    await createMediaApi(1, double.fetch).setRoles(4, { isHero: true });

    expect(double.calls[0]?.url).toBe('/api/admin/properties/1/media/4/roles');
    expect(double.calls[0]?.method).toBe('PUT');
    expect(double.calls[0]?.body).toBe(JSON.stringify({ isHero: true }));
  });

  it('un tipo que no admite el rol se explica', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'media_role_conflict' } }, 422));

    const result = await createMediaApi(1, double.fetch).setRoles(4, { isCatalogCover: true });

    expect(result).toEqual({ ok: false, message: MEDIA_API_MESSAGES.roleConflict });
  });

  it('un panorama en uso por el recorrido se explica al borrar', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'media_in_use' } }, 409));

    const result = await createMediaApi(1, double.fetch).deleteMedia(4);

    expect(result).toEqual({ ok: false, message: MEDIA_API_MESSAGES.inUse });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('360');
  });

  it('borrar envia content-type por la proteccion CSRF de Astro', async () => {
    const double = fetchDouble(() => jsonResponse({ data: { id: 4 } }));

    await createMediaApi(1, double.fetch).deleteMedia(4);

    expect(double.calls[0]?.method).toBe('DELETE');
    expect(double.calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('sin acceso el mensaje es el mismo en cualquier accion', async () => {
    const double = fetchDouble(() => new Response('', { status: 403 }));
    const api = createMediaApi(1, double.fetch);

    expect(await api.updateGroup(1, {})).toEqual({
      ok: false,
      message: MEDIA_API_MESSAGES.forbidden,
    });
    expect(await api.deleteMedia(1)).toEqual({
      ok: false,
      message: MEDIA_API_MESSAGES.forbidden,
    });
  });

  it('ningun mensaje visible menciona SQL, R2 ni codigos internos', () => {
    for (const message of Object.values(MEDIA_API_MESSAGES)) {
      expect(message).not.toMatch(/SQL|SQLITE|property_media|bucket|R2Bucket|undefined/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Presentacion                                                               */
/* -------------------------------------------------------------------------- */

describe('como se presenta cada archivo', () => {
  it('se identifica por su titulo cuando lo tiene', () => {
    const state = stateFromApi(
      view({
        ungrouped: [
          apiMedia({ translations: { es: { title: 'Fachada', altText: null, caption: null } } }),
        ],
      }),
    );

    expect(mediaDisplayName(state.media[0]!)).toBe('Fachada');
  });

  it('sin titulo, se reconoce por el final de su clave', () => {
    const state = stateFromApi(
      view({ ungrouped: [apiMedia({ objectKey: 'propiedades/1/image/abc-123.jpg' })] }),
    );

    expect(mediaDisplayName(state.media[0]!)).toBe('abc-123.jpg');
  });

  it('un video de YouTube se reconoce por su identificador', () => {
    const state = stateFromApi(
      view({
        ungrouped: [
          apiMedia({
            mediaKind: 'video',
            sourceProvider: 'youtube',
            objectKey: null,
            youtubeVideoId: 'dQw4w9WgXcQ',
          }),
        ],
      }),
    );

    expect(mediaDisplayName(state.media[0]!)).toBe('YouTube dQw4w9WgXcQ');
  });

  it('cada tipo tiene su nombre en castellano', () => {
    expect(mediaKindLabel('image')).toBe('Imagen');
    expect(mediaKindLabel('panorama')).toBe('Panorama 360°');
    expect(mediaKindLabel('document')).toBe('Documento');
    expect(mediaKindLabel('video')).toBe('Vídeo');
  });

  it('el tamano se muestra en unidades legibles', () => {
    expect(formatFileSize(240_512)).toBe('235 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatFileSize(null)).toBeNull();
  });

  it('un archivo recien subido entra en el estado sin cambios pendientes', () => {
    const state = stateFromApi(view());
    const entry = addMedia(state, apiMedia({ id: 9 }));

    expect(entry.state).toBe('saved');
    expect(isMediaDirty(entry)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Cableado                                                                   */
/* -------------------------------------------------------------------------- */

describe('integracion de la seccion', () => {
  const script = read(MEDIA_SCRIPT);
  const editor = read(EDITOR_SCRIPT);
  const page = read(EDITOR_PAGE);

  it('la pagina declara la seccion despues de caracteristicas', () => {
    expect(page).toContain('<h2 id="media-heading">Multimedia</h2>');
    expect(page).toContain('id="admin-media"');
    expect(page.indexOf('features-heading')).toBeLessThan(page.indexOf('media-heading'));
  });

  it('la seccion vive fuera del formulario del nucleo', () => {
    expect(page.indexOf('</form>')).toBeLessThan(page.indexOf('id="editor-media"'));
  });

  it('se arranca con el MISMO coordinador, sin un segundo autosave', () => {
    expect(editor).toContain('initMediaEditor(propertyId, coordinator)');
    expect(editor).toContain('coordinator?.snapshot().hasPendingWork !== true) return');
    // Un unico `createSaveCoordinator` en todo el editor.
    expect(editor.match(/createSaveCoordinator\(/g)).toHaveLength(1);
  });

  it('los textos pendientes de un archivo cuentan para el aviso de salida', () => {
    // Sus puertos se registran en el coordinador, que es quien vigila la salida.
    expect(script).toContain('coordinator.register(mediaPortKey(mediaId)');
    expect(script).toContain('coordinator.register(mediaGroupPortKey(groupId)');
    expect(script).toContain('coordinator.notifyChange(mediaPortKey(entry.id))');
  });

  it('crear, subir, borrar y cambiar rol quedan fuera del debounce', () => {
    expect(script).toContain('await api.upload(');
    expect(script).toContain('await api.createYoutube(');
    expect(script).toContain('await api.setRoles(');
    expect(script).toContain('await api.deleteMedia(entry.id)');
  });

  it('eliminar pide confirmacion y avisa de lo que se pierde', () => {
    expect(script).toContain('window.confirm(deleteMediaMessage(');
    expect(script).toContain('window.confirm(deleteGroupMessage(');
    expect(deleteMediaMessage(true)).toContain('cambios sin guardar');
    expect(deleteGroupMessage(false)).toContain('pasarán a "Sin grupo"');
  });

  it('hay selector de archivos y ademas se pueden soltar encima', () => {
    expect(script).toContain('type="file"');
    expect(script).toContain('multiple');
    expect(script).toContain("addEventListener('drop'");
    expect(script).toContain('media-dropzone');
  });

  it('el boton de subir se bloquea mientras queda trabajo', () => {
    expect(script).toContain("hasActiveUploads(queue) ? ' disabled' : ''");
    expect(script).toContain('if (uploading) return;');
  });

  it('se edita con campos, nunca con una tabla', () => {
    expect(script).not.toContain('<table');
    expect(script).not.toContain('<td');
  });

  it('no se pinta ninguna miniatura todavia', () => {
    // No hay URL publica de R2: la tarjeta se identifica por tipo y titulo.
    expect(script).not.toContain('<img');
    expect(script).toContain('kindGlyph');
  });

  it('cada campo lleva su etiqueta y marca los errores', () => {
    expect(script).toContain('<label for="media-${id}-title-es">Título en español</label>');
    expect(script).toContain('<label for="media-${id}-group">Grupo</label>');
    expect(script).toContain('aria-invalid="${invalid}"');
  });

  it('los botones de rol dicen su estado a la tecnologia asistiva', () => {
    expect(script).toContain('aria-pressed="${entry.isHero}"');
    expect(script).toContain('aria-pressed="${entry.isCatalogCover}"');
  });

  it('el progreso de la cola se anuncia', () => {
    expect(script).toContain('aria-live="polite"');
    expect(script).toContain('role="status"');
  });

  it('los encabezados encajan: h2 la seccion, h3 los bloques', () => {
    expect(page).toContain('<h2 id="media-heading">');
    expect(script).toContain('<h3 class="media-group-title"');
    expect(script).toContain('id="media-upload-heading">Subir archivos</h3>');
  });

  it('la seccion se adapta a movil con una sola columna', () => {
    const css = read(ADMIN_CSS);
    expect(css).toContain('.media-grid');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('la seccion habla con la API, nunca con D1 ni con R2', () => {
    for (const source of [script, read('src/lib/admin/ui/media-api.ts')]) {
      expect(source).not.toContain('drizzle');
      expect(source).not.toContain('cloudflare:workers');
    }
  });

  it('no se han anadido dependencias', () => {
    const manifest = read('package.json');
    for (const forbidden of ['playwright', 'jsdom', 'happy-dom', 'dropzone', 'uppy', 'filepond']) {
      expect(manifest).not.toContain(forbidden);
    }
  });
});
