/**
 * Tests del editor del recorrido 360.
 *
 * Estado y angulos como funciones puras, cliente con `fetch` inyectado y
 * comprobaciones estructurales sobre la pagina y el modulo de DOM. El visor no
 * se instancia: necesita WebGL, y lo que importa aqui es que la seccion siga
 * siendo usable sin el.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTourApi, panoramaUrl, TOUR_API_MESSAGES } from './tour-api';
import {
  addLink,
  addNode,
  applyStartNode,
  availablePanoramas,
  formatAngle,
  isEmpty,
  isLinkDirty,
  isNodeDirty,
  linkPatch,
  linkTargets,
  markLinkSaved,
  markNodeSaved,
  nodeById,
  nodeDisplayName,
  nodePatch,
  parseAngle,
  removeLink,
  removeNode,
  roundAngle,
  selectedNode,
  startNodeId,
  stateFromApi,
  type ApiTourLink,
  type ApiTourNode,
  type ApiTourView,
} from './tour-editor-state';
import { deleteLinkMessage, deleteNodeMessage, VIEWER_FALLBACK_TEXT } from './tour-editor';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const TOUR_SCRIPT = 'src/lib/admin/ui/tour-editor.ts';
const VIEWER_SCRIPT = 'src/lib/viewer/panorama-viewer.ts';
const EDITOR_SCRIPT = 'src/lib/admin/ui/editor-page.ts';
const EDITOR_PAGE = 'src/pages/admin/propiedades/[id].astro';
const ADMIN_CSS = 'src/styles/admin.css';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function apiLink(overrides: Partial<ApiTourLink> = {}): ApiTourLink {
  return { id: 1, fromNodeId: 1, toNodeId: 2, yaw: 0, pitch: 0, sortOrder: 0, ...overrides };
}

function apiNode(overrides: Partial<ApiTourNode> = {}): ApiTourNode {
  return {
    id: 1,
    sortOrder: 0,
    isStart: false,
    panorama: { id: 10, mediaKind: 'panorama' },
    names: {},
    links: [],
    ...overrides,
  };
}

function view(overrides: Partial<ApiTourView> = {}): ApiTourView {
  return { nodes: [], startNodeId: null, ...overrides };
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
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
      body: typeof init?.body === 'string' ? init.body : null,
    };

    calls.push(call);
    return await reply(call);
  };

  return { calls, fetch: impl as unknown as typeof fetch };
}

/* -------------------------------------------------------------------------- */
/* Carga                                                                      */
/* -------------------------------------------------------------------------- */

describe('carga del recorrido', () => {
  it('una propiedad sin recorrido queda vacia y sin seleccion', () => {
    const state = stateFromApi(view());

    expect(isEmpty(state)).toBe(true);
    expect(state.selectedNodeId).toBeNull();
    expect(startNodeId(state)).toBeNull();
  });

  it('al cargar se selecciona el primer punto', () => {
    const state = stateFromApi(view({ nodes: [apiNode({ id: 7 }), apiNode({ id: 3 })] }));

    expect(state.selectedNodeId).toBe(7);
    expect(selectedNode(state)?.id).toBe(7);
  });

  it('conserva la seleccion al recargar si el punto sigue estando', () => {
    const state = stateFromApi(view({ nodes: [apiNode({ id: 7 }), apiNode({ id: 3 })] }), 3);

    expect(state.selectedNodeId).toBe(3);
  });

  it('si el punto seleccionado ya no esta, cae al primero', () => {
    const state = stateFromApi(view({ nodes: [apiNode({ id: 7 })] }), 99);

    expect(state.selectedNodeId).toBe(7);
  });

  it('conserva el orden y trae panorama, nombres y saltos', () => {
    const state = stateFromApi(
      view({
        nodes: [
          apiNode({
            id: 1,
            names: { es: 'Entrada', en: 'Entrance' },
            links: [apiLink({ id: 5, toNodeId: 2, yaw: 1.5 })],
          }),
          apiNode({ id: 2, panorama: { id: 11, mediaKind: 'panorama' } }),
        ],
      }),
    );

    expect(state.nodes.map((node) => node.id)).toEqual([1, 2]);
    expect(state.nodes[0]?.draft.nameEs).toBe('Entrada');
    expect(state.nodes[0]?.panoramaId).toBe(10);
    expect(state.nodes[0]?.links[0]?.draft.yaw).toBe(1.5);
  });
});

/* -------------------------------------------------------------------------- */
/* Puntos                                                                     */
/* -------------------------------------------------------------------------- */

describe('puntos del recorrido', () => {
  it('el nombre cae del espanol al ingles y avisa', () => {
    const state = stateFromApi(view({ nodes: [apiNode({ names: { en: 'Entrance' } })] }));

    expect(nodeDisplayName(state.nodes[0]!, 1)).toEqual({
      text: 'Entrance',
      missingSpanish: true,
    });
  });

  it('sin nombre, se identifica por su posicion', () => {
    const state = stateFromApi(view({ nodes: [apiNode()] }));

    expect(nodeDisplayName(state.nodes[0]!, 3).text).toBe('Punto 3');
  });

  it('escribir el nombre deja el punto sucio', () => {
    const state = stateFromApi(view({ nodes: [apiNode()] }));
    state.nodes[0]!.draft.nameEs = 'Entrada';

    expect(isNodeDirty(state.nodes[0]!)).toBe(true);
  });

  it('el parche del punto solo lleva los nombres', () => {
    const state = stateFromApi(view({ nodes: [apiNode()] }));

    expect(Object.keys(nodePatch(state.nodes[0]!))).toEqual(['nameEs', 'nameEn']);
  });

  it('lo escrito durante el guardado sigue pendiente', () => {
    const state = stateFromApi(view({ nodes: [apiNode()] }));
    const node = state.nodes[0]!;

    const snapshot = { ...node.draft, nameEs: 'Entrada' };
    node.draft.nameEs = 'Entrada principal';

    markNodeSaved(node, snapshot);

    expect(isNodeDirty(node)).toBe(true);
  });

  it('un punto nuevo se selecciona solo si era el primero', () => {
    const state = stateFromApi(view());

    addNode(state, apiNode({ id: 4 }));
    expect(state.selectedNodeId).toBe(4);

    addNode(state, apiNode({ id: 5 }));
    // El segundo no roba la seleccion.
    expect(state.selectedNodeId).toBe(4);
  });
});

/* -------------------------------------------------------------------------- */
/* Punto inicial                                                              */
/* -------------------------------------------------------------------------- */

describe('punto inicial', () => {
  const state = () =>
    stateFromApi(view({ nodes: [apiNode({ id: 1 }), apiNode({ id: 2 }), apiNode({ id: 3 })] }));

  it('solo hay uno a la vez', () => {
    const current = state();

    applyStartNode(current, 1, true);
    applyStartNode(current, 2, true);

    expect(startNodeId(current)).toBe(2);
    expect(current.nodes.filter((node) => node.isStart)).toHaveLength(1);
  });

  it('se puede dejar el recorrido sin punto inicial', () => {
    const current = state();

    applyStartNode(current, 1, true);
    applyStartNode(current, 1, false);

    expect(startNodeId(current)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Saltos                                                                     */
/* -------------------------------------------------------------------------- */

describe('saltos entre puntos', () => {
  const state = () =>
    stateFromApi(
      view({
        nodes: [
          apiNode({ id: 1, links: [apiLink({ id: 9, fromNodeId: 1, toNodeId: 2 })] }),
          apiNode({ id: 2 }),
          apiNode({ id: 3 }),
        ],
      }),
    );

  it('los destinos posibles excluyen el propio punto', () => {
    expect(linkTargets(state(), 1).map((node) => node.id)).not.toContain(1);
  });

  it('los destinos posibles excluyen los ya enlazados', () => {
    // Ya hay un salto de 1 a 2: solo queda el 3.
    expect(linkTargets(state(), 1).map((node) => node.id)).toEqual([3]);
  });

  it('desde un punto sin saltos se puede ir a todos los demas', () => {
    expect(linkTargets(state(), 3).map((node) => node.id)).toEqual([1, 2]);
  });

  it('mover el hotspot deja el salto sucio', () => {
    const current = state();
    const link = current.nodes[0]!.links[0]!;

    link.draft.yaw = 1.2;

    expect(isLinkDirty(link)).toBe(true);
    expect(linkPatch(link)).toEqual({ yaw: 1.2, pitch: 0 });
  });

  it('guardar consolida la posicion enviada, no la ultima tecleada', () => {
    const current = state();
    const link = current.nodes[0]!.links[0]!;

    const snapshot = { yaw: 1, pitch: 0 };
    link.draft.yaw = 2;

    markLinkSaved(link, snapshot);

    expect(isLinkDirty(link)).toBe(true);
  });

  it('un salto nuevo se cuelga de su punto de origen', () => {
    const current = state();

    const entry = addLink(current, apiLink({ id: 20, fromNodeId: 3, toNodeId: 1 }));

    expect(entry).not.toBeNull();
    expect(nodeById(current, 3)?.links.map((link) => link.id)).toEqual([20]);
  });

  it('un salto desde un punto que no existe no se anade', () => {
    expect(addLink(state(), apiLink({ fromNodeId: 99 }))).toBeNull();
  });

  it('borrar un salto solo quita ese', () => {
    const current = state();

    removeLink(current, 9);

    expect(current.nodes[0]?.links).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Borrado de puntos                                                          */
/* -------------------------------------------------------------------------- */

describe('borrar un punto', () => {
  it('se lleva los saltos que salian y los que le apuntaban', () => {
    const state = stateFromApi(
      view({
        nodes: [
          apiNode({ id: 1, links: [apiLink({ id: 9, fromNodeId: 1, toNodeId: 2 })] }),
          apiNode({ id: 2, links: [apiLink({ id: 10, fromNodeId: 2, toNodeId: 3 })] }),
          apiNode({ id: 3, links: [apiLink({ id: 11, fromNodeId: 3, toNodeId: 2 })] }),
        ],
      }),
    );

    removeNode(state, 2);

    expect(state.nodes.map((node) => node.id)).toEqual([1, 3]);
    // El salto de 1 a 2 y el de 3 a 2 desaparecen, como hace el CASCADE.
    expect(state.nodes.flatMap((node) => node.links)).toHaveLength(0);
  });

  it('si se borra el punto que se estaba mirando, se pasa al primero', () => {
    const state = stateFromApi(view({ nodes: [apiNode({ id: 1 }), apiNode({ id: 2 })] }));
    state.selectedNodeId = 2;

    removeNode(state, 2);

    expect(state.selectedNodeId).toBe(1);
  });

  it('borrar el ultimo punto deja la seleccion vacia', () => {
    const state = stateFromApi(view({ nodes: [apiNode({ id: 1 })] }));

    removeNode(state, 1);

    expect(state.selectedNodeId).toBeNull();
    expect(isEmpty(state)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Panoramas disponibles                                                      */
/* -------------------------------------------------------------------------- */

describe('panoramas disponibles', () => {
  it('no se ofrece un panorama que ya es un punto', () => {
    const state = stateFromApi(
      view({ nodes: [apiNode({ id: 1, panorama: { id: 10, mediaKind: 'panorama' } })] }),
    );

    const free = availablePanoramas(state, [
      { id: 10, label: 'usado.jpg' },
      { id: 11, label: 'libre.jpg' },
    ]);

    expect(free.map((panorama) => panorama.id)).toEqual([11]);
  });

  it('sin panoramas, la lista queda vacia', () => {
    expect(availablePanoramas(stateFromApi(view()), [])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Angulos                                                                    */
/* -------------------------------------------------------------------------- */

describe('giro e inclinacion', () => {
  it('acepta lo que se teclea, con punto o con coma', () => {
    expect(parseAngle('1.25')).toBe(1.25);
    expect(parseAngle('1,25')).toBe(1.25);
    expect(parseAngle('-0.5')).toBe(-0.5);
    expect(parseAngle(' 2 ')).toBe(2);
  });

  it('rechaza lo que no es un numero', () => {
    expect(parseAngle('')).toBeNull();
    expect(parseAngle('hola')).toBeNull();
    expect(parseAngle('1.2.3')).toBeNull();
  });

  it('redondea para que pinchar en el visor no genere ruido', () => {
    expect(roundAngle(1.234_567_89)).toBe(1.2346);
    expect(formatAngle(1.234_567_89)).toBe('1.2346');
    expect(formatAngle(0)).toBe('0');
  });
});

/* -------------------------------------------------------------------------- */
/* Cliente                                                                    */
/* -------------------------------------------------------------------------- */

describe('cliente de la API', () => {
  it('el panorama se pide al endpoint protegido del panel', () => {
    expect(panoramaUrl(7, 12)).toBe('/api/admin/properties/7/media/12/file');
  });

  it('crear un punto manda el panorama elegido', async () => {
    const double = fetchDouble(() => jsonResponse({ data: apiNode() }, 201));

    await createTourApi(7, double.fetch).createNode(10);

    expect(double.calls[0]?.url).toBe('/api/admin/properties/7/tour/nodes');
    expect(double.calls[0]?.body).toBe(JSON.stringify({ propertyMediaId: 10 }));
  });

  it('un archivo que no es panorama se explica', async () => {
    const double = fetchDouble(() =>
      jsonResponse({ error: { code: 'tour_media_not_panorama' } }, 422),
    );

    const result = await createTourApi(1, double.fetch).createNode(10);

    expect(result).toEqual({ ok: false, message: TOUR_API_MESSAGES.notPanorama });
  });

  it('un panorama de otra propiedad se explica', async () => {
    const double = fetchDouble(() =>
      jsonResponse({ error: { code: 'tour_media_property_mismatch' } }, 422),
    );

    const result = await createTourApi(1, double.fetch).createNode(10);

    expect(result).toEqual({ ok: false, message: TOUR_API_MESSAGES.otherProperty });
  });

  it('un panorama ya usado se explica', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'tour_media_in_use' } }, 409));

    const result = await createTourApi(1, double.fetch).createNode(10);

    expect(result).toEqual({ ok: false, message: TOUR_API_MESSAGES.panoramaUsed });
  });

  it('dos clics seguidos no crean dos puntos', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const double = fetchDouble(async () => {
      await held;
      return jsonResponse({ data: apiNode() }, 201);
    });

    const api = createTourApi(1, double.fetch);
    const first = api.createNode(10);
    const second = await api.createNode(10);

    expect(second).toBeNull();

    release();
    await first;

    expect(double.calls).toHaveLength(1);
  });

  it('el punto inicial usa la ruta atomica', async () => {
    const double = fetchDouble(() => jsonResponse({ data: {} }));

    await createTourApi(1, double.fetch).setStart(4, true);

    expect(double.calls[0]?.url).toBe('/api/admin/properties/1/tour/nodes/4/start');
    expect(double.calls[0]?.method).toBe('PUT');
    expect(double.calls[0]?.body).toBe(JSON.stringify({ isStart: true }));
  });

  it('crear un salto manda origen, destino y posicion', async () => {
    const double = fetchDouble(() => jsonResponse({ data: apiLink() }, 201));

    await createTourApi(2, double.fetch).createLink({
      fromNodeId: 1,
      toNodeId: 2,
      yaw: 1.5,
      pitch: -0.3,
    });

    expect(double.calls[0]?.url).toBe('/api/admin/properties/2/tour/links');
    expect(double.calls[0]?.body).toBe(
      JSON.stringify({ fromNodeId: 1, toNodeId: 2, yaw: 1.5, pitch: -0.3 }),
    );
  });

  it('un autoenlace se explica sin tecnicismos', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'tour_link_invalid' } }, 422));

    const result = await createTourApi(1, double.fetch).createLink({
      fromNodeId: 1,
      toNodeId: 1,
      yaw: 0,
      pitch: 0,
    });

    expect(result).toEqual({ ok: false, message: TOUR_API_MESSAGES.linkInvalid });
  });

  it('un salto repetido se explica', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'tour_link_duplicate' } }, 409));

    const result = await createTourApi(1, double.fetch).createLink({
      fromNodeId: 1,
      toNodeId: 2,
      yaw: 0,
      pitch: 0,
    });

    expect(result).toEqual({ ok: false, message: TOUR_API_MESSAGES.linkDuplicate });
  });

  it('borrar envia content-type por la proteccion CSRF de Astro', async () => {
    const double = fetchDouble(() => jsonResponse({ data: { id: 1 } }));
    const api = createTourApi(1, double.fetch);

    await api.deleteNode(1);
    await api.deleteLink(2);

    expect(double.calls[0]?.headers['content-type']).toBe('application/json');
    expect(double.calls[1]?.headers['content-type']).toBe('application/json');
  });

  it('sin acceso el mensaje es el mismo en cualquier accion', async () => {
    const double = fetchDouble(() => new Response('', { status: 403 }));
    const api = createTourApi(1, double.fetch);

    expect(await api.load()).toEqual({ ok: false, message: TOUR_API_MESSAGES.forbidden });
    expect(await api.deleteNode(1)).toEqual({ ok: false, message: TOUR_API_MESSAGES.forbidden });
  });

  it('los panoramas se leen del listado de multimedia, sin endpoint aparte', async () => {
    const double = fetchDouble(() =>
      jsonResponse({ data: { groups: [], ungrouped: [], heroId: null, catalogCoverId: null } }),
    );

    await createTourApi(3, double.fetch).loadPanoramas();

    expect(double.calls[0]?.url).toBe('/api/admin/properties/3/media');
  });

  it('ningun mensaje visible menciona SQL, tablas ni codigos internos', () => {
    for (const message of Object.values(TOUR_API_MESSAGES)) {
      expect(message).not.toMatch(/SQL|SQLITE|property_tour|CASCADE|undefined/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Cableado                                                                   */
/* -------------------------------------------------------------------------- */

describe('integracion de la seccion', () => {
  const script = read(TOUR_SCRIPT);
  const viewerScript = read(VIEWER_SCRIPT);
  const editor = read(EDITOR_SCRIPT);
  const page = read(EDITOR_PAGE);

  it('la pagina declara la seccion despues de multimedia', () => {
    expect(page).toContain('<h2 id="tour-heading">Recorrido 360°</h2>');
    expect(page).toContain('id="admin-tour"');
    expect(page.indexOf('media-heading')).toBeLessThan(page.indexOf('tour-heading'));
  });

  it('la seccion vive fuera del formulario del nucleo', () => {
    expect(page.indexOf('</form>')).toBeLessThan(page.indexOf('id="editor-tour"'));
  });

  it('se arranca con el MISMO coordinador, sin un segundo autosave', () => {
    expect(editor).toContain('initTourEditor(propertyId, coordinator)');
    expect(editor.match(/createSaveCoordinator\(/g)).toHaveLength(1);
  });

  it('los puntos y los saltos son puertos del coordinador', () => {
    expect(script).toContain('coordinator.register(tourNodePortKey(nodeId)');
    expect(script).toContain('coordinator.register(tourLinkPortKey(linkId)');
    expect(script).toContain('coordinator.notifyChange(tourNodePortKey(entry.id))');
    expect(script).toContain('coordinator.notifyChange(tourLinkPortKey(entry.id))');
  });

  it('crear, borrar y marcar el inicio quedan fuera del debounce', () => {
    expect(script).toContain('await api.createNode(');
    expect(script).toContain('await api.setStart(');
    expect(script).toContain('await api.deleteNode(node.id)');
    expect(script).toContain('await api.createLink(');
  });

  it('borrar un punto avisa de que se lleva sus saltos', () => {
    expect(deleteNodeMessage(false)).toContain('saltos que entran o salen');
    expect(deleteNodeMessage(false)).toContain('El panorama no se borra');
    expect(deleteNodeMessage(true)).toContain('cambios sin guardar');
    expect(script).toContain('window.confirm(deleteNodeMessage(');
    expect(script).toContain('window.confirm(deleteLinkMessage(');
    expect(deleteLinkMessage(false)).toContain('no se puede deshacer');
  });

  it('al borrar un punto se dan de baja tambien los puertos de sus saltos', () => {
    expect(script).toContain('coordinator.unregister(tourLinkPortKey(link.id))');
    expect(script).toContain('if (link.toNodeId === node.id)');
  });

  it('el visor se carga solo cuando hace falta', () => {
    expect(viewerScript).toContain("import('@photo-sphere-viewer/core')");
    expect(viewerScript).toContain("import('@photo-sphere-viewer/markers-plugin')");
    // Nada de importaciones estaticas del visor en el modulo de la seccion.
    expect(script).not.toContain("from '@photo-sphere-viewer");
  });

  it('si el visor no carga, la seccion sigue siendo usable', () => {
    expect(viewerScript).toContain('return null;');
    expect(script).toContain('viewerUnavailable = true');
    expect(VIEWER_FALLBACK_TEXT).toContain('a mano');
  });

  it('pinchar en el panorama y teclear llevan al mismo sitio', () => {
    // El gesto rellena los mismos campos numericos que se pueden escribir.
    expect(script).toContain('onPick: (position)');
    expect(script).toContain("byId<HTMLInputElement>('tour-new-link-yaw')");
    expect(script).toContain('parseAngle(');
  });

  it('los controles numericos llevan etiqueta, paso y descripcion', () => {
    expect(script).toContain('<label for="tour-link-${id}-yaw">Giro (yaw)</label>');
    expect(script).toContain('<label for="tour-link-${id}-pitch">Inclinación (pitch)</label>');
    expect(script).toContain('type="number" step="0.01"');
    expect(script).toContain('aria-describedby="tour-pick-help"');
  });

  it('la lista de puntos es navegable y dice cual esta activo', () => {
    expect(script).toContain('aria-current="${selected}"');
    expect(script).toContain('data-action="select-node"');
    expect(script).toContain('aria-label="Puntos del recorrido"');
  });

  it('el boton de inicio dice su estado a la tecnologia asistiva', () => {
    expect(script).toContain('aria-pressed="${node.isStart}"');
  });

  it('sin panoramas se explica que hacer', () => {
    expect(script).toContain('id="tour-no-panoramas"');
    expect(script).toContain('Súbelos en la sección Multimedia');
  });

  it('el progreso y los estados se anuncian', () => {
    expect(script).toContain('role="status"');
    expect(script).toContain('role="alert"');
  });

  it('escritorio con lista al lado, movil en una columna', () => {
    const css = read(ADMIN_CSS);
    expect(css).toContain('.tour-layout');
    expect(css).toContain('grid-template-columns: minmax(14rem, 20rem) minmax(0, 1fr)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('la seccion habla con la API, nunca con D1 ni con R2', () => {
    for (const source of [script, read('src/lib/admin/ui/tour-api.ts')]) {
      expect(source).not.toContain('drizzle');
      expect(source).not.toContain('cloudflare:workers');
    }
  });

  it('no se han anadido dependencias de UI ni de test', () => {
    const manifest = read('package.json');
    for (const forbidden of ['playwright', 'jsdom', 'happy-dom', 'react', 'vue']) {
      expect(manifest).not.toContain(`"${forbidden}"`);
    }
    // El visor aprobado si esta, y anclado a una version estable.
    expect(manifest).toContain('@photo-sphere-viewer/core');
  });
});
