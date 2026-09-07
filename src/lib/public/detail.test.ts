/**
 * Tests de la ficha publica: recorrido 360, galeria y video.
 *
 * Lo que se puede decidir sin pantalla —por donde abre el recorrido, a donde
 * lleva un salto, que foto toca— se prueba como funcion pura. Lo que solo
 * existe como plantilla se comprueba sobre el fuente, como en el resto del
 * proyecto: sin navegador y sin dependencias nuevas.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stepIndex, SWIPE_THRESHOLD, swipeStep } from './gallery';
import type { PublicTour, PublicTourNode } from './read-model';
import { destinationsOf, nodeByKey, nodeLabel, parseTour, startNode } from './tour';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const DETAIL = 'src/components/public/PropertyDetail.astro';
const GALLERY = 'src/components/public/PropertyGallery.astro';
const TOUR = 'src/components/public/PropertyTour.astro';
const VIDEO = 'src/components/public/PropertyVideo.astro';
const PAGE_MODULE = 'src/lib/public/detail-page.ts';
const VIEWER = 'src/lib/viewer/panorama-viewer.ts';
const CSS = 'src/styles/global.css';
const DETAIL_ES = 'src/pages/es/propiedades/[slug].astro';
const DETAIL_EN = 'src/pages/en/propiedades/[slug].astro';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function node(overrides: Partial<PublicTourNode> = {}): PublicTourNode {
  return {
    key: '1',
    name: 'Entrada',
    url: '/media/1',
    initialView: null,
    links: [],
    ...overrides,
  };
}

const NAMING = { pointName: (position: number) => `Punto ${position}` };

/* -------------------------------------------------------------------------- */
/* Recorrido: por donde se empieza                                            */
/* -------------------------------------------------------------------------- */

describe('punto inicial', () => {
  it('abre por el punto que marca el recorrido', () => {
    const tour: PublicTour = {
      start: '2',
      nodes: [node(), node({ key: '2', name: 'Mirador', url: '/media/2' })],
    };

    expect(startNode(tour)?.name).toBe('Mirador');
  });

  it('si la clave inicial no existe, abre por el primero', () => {
    const tour: PublicTour = { start: '9', nodes: [node(), node({ key: '2' })] };

    // Mejor abrir por algun sitio que no abrir.
    expect(startNode(tour)?.key).toBe('1');
  });

  it('un recorrido sin puntos no tiene por donde empezar', () => {
    expect(startNode({ start: '1', nodes: [] })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Recorrido: saltos                                                          */
/* -------------------------------------------------------------------------- */

describe('saltos entre puntos', () => {
  const tour: PublicTour = {
    start: '1',
    nodes: [
      node({ links: [{ to: '2', yaw: 1.5, pitch: -0.2 }] }),
      node({ key: '2', name: 'Mirador', url: '/media/2' }),
    ],
  };

  it('resuelve el destino con su nombre y su posicion', () => {
    expect(destinationsOf(tour, tour.nodes[0] as PublicTourNode, NAMING)).toEqual([
      { key: '2', label: 'Mirador', yaw: 1.5, pitch: -0.2 },
    ]);
  });

  it('un salto que no lleva a ningun punto se descarta', () => {
    const broken: PublicTour = {
      start: '1',
      nodes: [node({ links: [{ to: '7', yaw: 0, pitch: 0 }] })],
    };

    expect(destinationsOf(broken, broken.nodes[0] as PublicTourNode, NAMING)).toEqual([]);
  });

  it('se encuentra un punto por su clave, y solo por ella', () => {
    expect(nodeByKey(tour, '2')?.name).toBe('Mirador');
    expect(nodeByKey(tour, '3')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Recorrido: nombres                                                         */
/* -------------------------------------------------------------------------- */

describe('nombre de un punto', () => {
  it('usa el que escribio el editor', () => {
    const tour: PublicTour = { start: '1', nodes: [node({ name: 'Camino principal' })] };

    expect(nodeLabel(tour, tour.nodes[0] as PublicTourNode, NAMING)).toBe('Camino principal');
  });

  it('sin nombre en este idioma, usa su posicion', () => {
    const tour: PublicTour = {
      start: '1',
      nodes: [node(), node({ key: '2', name: null }), node({ key: '3', name: null })],
    };

    // Un hueco no dice nada; "Punto 2" si.
    expect(nodeLabel(tour, tour.nodes[1] as PublicTourNode, NAMING)).toBe('Punto 2');
    expect(nodeLabel(tour, tour.nodes[2] as PublicTourNode, NAMING)).toBe('Punto 3');
  });
});

/* -------------------------------------------------------------------------- */
/* Recorrido: lectura del HTML                                                */
/* -------------------------------------------------------------------------- */

describe('el recorrido incrustado en la pagina', () => {
  it('se lee tal cual lo publica el snapshot', () => {
    const raw = JSON.stringify({
      start: '1',
      nodes: [{ key: '1', name: 'Entrada', url: '/media/1', initialView: null, links: [] }],
    });

    expect(parseTour(raw)?.nodes[0]?.name).toBe('Entrada');
  });

  it('un JSON estropeado no rompe la ficha', () => {
    expect(parseTour('{ esto no es json')).toBeNull();
    expect(parseTour('')).toBeNull();
    expect(parseTour('null')).toBeNull();
    expect(parseTour('[]')).toBeNull();
  });

  it('lo que no tiene forma de recorrido se descarta', () => {
    expect(parseTour('{"nodes":[]}')).toBeNull();
    expect(parseTour('{"start":"1"}')).toBeNull();
    // Un punto sin url no se puede mostrar.
    expect(parseTour('{"start":"1","nodes":[{"key":"1","links":[]}]}')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Galeria                                                                    */
/* -------------------------------------------------------------------------- */

describe('navegacion por las fotos', () => {
  it('avanza y retrocede', () => {
    expect(stepIndex(0, 1, 4)).toBe(1);
    expect(stepIndex(2, -1, 4)).toBe(1);
  });

  it('da la vuelta en los extremos', () => {
    // Con pocas fotos, un boton muerto molesta mas que volver al principio.
    expect(stepIndex(3, 1, 4)).toBe(0);
    expect(stepIndex(0, -1, 4)).toBe(3);
  });

  it('con una sola foto se queda donde esta', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 1)).toBe(0);
  });

  it('sin fotos no hay indice que mover', () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe('gesto en movil', () => {
  it('arrastrar a la izquierda pasa a la siguiente', () => {
    expect(swipeStep(-(SWIPE_THRESHOLD + 10), 0)).toBe(1);
    expect(swipeStep(SWIPE_THRESHOLD + 10, 0)).toBe(-1);
  });

  it('un roce corto no cuenta', () => {
    expect(swipeStep(-(SWIPE_THRESHOLD - 1), 0)).toBe(0);
  });

  it('si el dedo baja mas de lo que se mueve de lado, es scroll', () => {
    // La galeria no le roba el gesto a quien esta bajando por la pagina.
    expect(swipeStep(-60, 120)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Estructura de la ficha                                                     */
/* -------------------------------------------------------------------------- */

describe('la ficha', () => {
  it('abre con la fotografia y luego cuenta lo que decide una visita', () => {
    const detail = read(DETAIL);

    expect(detail).toContain('<PropertyGallery');
    expect(detail).toContain('property-facts');
    expect(detail).toContain('labels.price');
    expect(detail).toContain('labels.area');
    expect(detail).toContain('labels.location');
  });

  it('el estado comercial solo aparece cuando dice algo', () => {
    // `publishedCommercialStatus` ya deja `null` en el caso normal.
    expect(read(DETAIL)).toContain('property.commercialStatus &&');
  });

  it('mapa y contacto son secciones de verdad, no huecos anunciados', () => {
    const detail = read(DETAIL);

    // El mapa dejo de ser un hueco en 4E; el contacto, en 4F.
    expect(detail).toContain('<PropertyMap');
    expect(detail).toContain('<PropertyContact');
    expect(detail).not.toContain('ComingSoon');
  });

  it('no sale nada del panel ni del bucket', () => {
    for (const file of [DETAIL, GALLERY, TOUR, VIDEO, PAGE_MODULE]) {
      expect(read(file)).not.toContain('/api/admin');
      expect(read(file)).not.toContain('objectKey');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Galeria: plantilla                                                         */
/* -------------------------------------------------------------------------- */

describe('la galeria', () => {
  it('trae todas las fotos en el HTML, y los controles ocultos', () => {
    const gallery = read(GALLERY);

    // Sin JavaScript se ven todas: la cuadricula es un resultado util.
    expect(gallery).toContain('images.map');
    expect(gallery).toContain('data-gallery-slide');
    expect(gallery).toContain('id="gallery-controls" hidden');
  });

  it('solo la primera foto se carga de inmediato', () => {
    expect(read(GALLERY)).toContain('priority={index === 0}');
    expect(read('src/components/public/PropertyImage.astro')).toContain(
      "loading={priority ? 'eager' : 'lazy'}",
    );
  });

  it('las flechas se explican y el contador se anuncia', () => {
    const gallery = read(GALLERY);

    expect(gallery).toContain('aria-label={labels.previousPhoto}');
    expect(gallery).toContain('aria-label={labels.nextPhoto}');
    expect(gallery).toContain('aria-live="polite"');
  });

  it('el teclado y el gesto mueven la galeria', () => {
    const page = read(PAGE_MODULE);

    expect(page).toContain("event.key === 'ArrowLeft'");
    expect(page).toContain("event.key === 'ArrowRight'");
    expect(page).toContain("'touchend'");
    expect(page).toContain('swipeStep');
  });

  it('el acceso al recorrido esta sobre la foto', () => {
    expect(read(GALLERY)).toContain('gallery-tour-badge');
    expect(read(DETAIL)).toContain("tourHref={tour === null ? null : '#recorrido'}");
  });
});

/* -------------------------------------------------------------------------- */
/* Recorrido: plantilla y peso                                                */
/* -------------------------------------------------------------------------- */

describe('el visor 360 publico', () => {
  it('no se carga hasta que alguien lo abre', () => {
    const page = read(PAGE_MODULE);
    const viewer = read(VIEWER);

    // El paquete pesado entra por `import()`, nunca de forma estatica.
    expect(viewer).toContain("import('@photo-sphere-viewer/core')");
    expect(viewer).not.toContain("from '@photo-sphere-viewer/core'");
    expect(page).toContain('createPanoramaViewer');
    expect(page).toContain("open.addEventListener('click'");
  });

  it('empieza por el punto inicial y con su camara', () => {
    const page = read(PAGE_MODULE);

    expect(page).toContain('startNode(tour)');
    expect(page).toContain('view: first.initialView');
  });

  it('la camara guardada llega al visor por el nombre que el visor entiende', () => {
    const viewer = read(VIEWER);

    /*
     * El constructor del visor NO acepta `position`: usa `defaultYaw` y
     * `defaultPitch`, y descarta en silencio lo que no reconoce. Con
     * `position` el recorrido abria siempre mirando al frente, ignorando la
     * camara ajustada en el editor, y no habia forma de notarlo salvo
     * mirandolo.
     */
    expect(viewer).toContain('defaultYaw: view.yaw');
    expect(viewer).toContain('defaultPitch: view.pitch');
    expect(viewer).toContain('...defaultViewOptions(options.view)');

    // Al cambiar de panorama, en cambio, el nombre bueno si es `position`.
    expect(viewer).toContain('position: { yaw: view.yaw, pitch: view.pitch }');
    expect(viewer).toContain('setPanorama(next, viewOptions(view))');
  });

  it('el campo de vision se traduce, no se pasa en crudo', () => {
    const viewer = read(VIEWER);

    // El visor razona en un nivel de 0 a 100, no en grados.
    expect(viewer).toContain('viewer.dataHelper.fovToZoomLevel(fov)');
    expect(viewer).not.toContain('zoom: view.fov');
  });

  it('los saltos son marcas en el panorama y tambien botones', () => {
    const page = read(PAGE_MODULE);

    // Una marca flotante no la alcanza el teclado; el boton si.
    expect(page).toContain('setHotspots');
    expect(page).toContain('data-tour-to');
    expect(page).toContain('onHotspot');
  });

  it('dice en que punto se esta', () => {
    expect(read(TOUR)).toContain('id="tour-current"');
    expect(read(TOUR)).toContain('aria-live="polite"');
    expect(read(PAGE_MODULE)).toContain('nodeLabel(tour, node, naming)');
  });

  it('sin JavaScript quedan los panoramas, y el marco no aparece', () => {
    const tour = read(TOUR);

    expect(tour).toContain('id="tour-frame" hidden');
    expect(tour).toContain('id="tour-points"');
    expect(tour).toContain('point.url');
  });

  it('si el visor no arranca, se dice y no se reintenta', () => {
    const page = read(PAGE_MODULE);
    const viewer = read(VIEWER);

    // `createPanoramaViewer` devuelve `null` en vez de tirar la pagina.
    expect(viewer).toContain('return null;');
    expect(page).toContain('created === null');
    expect(page).toContain('texts.unavailable');
    expect(page).not.toContain('setTimeout');
  });

  it('viaja el recorrido publicado, no una consulta al servidor', () => {
    const tour = read(TOUR);

    expect(tour).toContain('type="application/json" id="tour-data"');
    expect(read(PAGE_MODULE)).not.toContain('fetch(');
  });

  it('el JSON no puede cerrar la etiqueta que lo contiene', () => {
    expect(read(TOUR)).toContain("replace(/</g, '\\\\u003c')");
  });
});

/* -------------------------------------------------------------------------- */
/* Video                                                                      */
/* -------------------------------------------------------------------------- */

describe('el video', () => {
  it('lo de R2 se reproduce con el navegador, sin descargarlo entero', () => {
    const video = read(VIDEO);

    expect(video).toContain('<video');
    expect(video).toContain('preload="metadata"');
    expect(video).toContain('controls');
  });

  it('lo de YouTube es portada hasta que alguien pulsa', () => {
    const video = read(VIDEO);

    expect(video).not.toContain('<iframe');
    expect(video).toContain('data-video-facade');
    expect(video).toContain('loading="lazy"');
    // El dominio sin cookies mientras nadie reproduzca nada.
    expect(video).toContain('youtube-nocookie.com');
  });

  it('el reproductor se inserta al pulsar, y solo entonces', () => {
    const page = read(PAGE_MODULE);

    expect(page).toContain('data-video-play');
    expect(page).toContain('<iframe');
    expect(page).toContain('autoplay=1');
  });

  it('nada arranca solo al abrir la ficha', () => {
    const video = read(VIDEO);

    // Ningun elemento de la plantilla lleva el atributo: el `autoplay` del
    // iframe lo pone el navegador al pulsar, y el `<video>` no lo lleva nunca.
    expect(video).not.toContain('autoplay=');
    expect(video).not.toContain('<video autoplay');
    expect(video).not.toContain('<video ... autoplay');
  });
});

/* -------------------------------------------------------------------------- */
/* Accesibilidad y movil                                                      */
/* -------------------------------------------------------------------------- */

describe('accesibilidad y movil', () => {
  it('las paginas de ficha arrancan el modulo de la ficha', () => {
    for (const page of [DETAIL_ES, DETAIL_EN]) {
      expect(read(page)).toContain('initPropertyDetail()');
    }
  });

  it('lo que el script esconde se esconde de verdad', () => {
    /*
     * La regla del navegador para `[hidden]` es la mas debil que hay, y
     * cualquier `display` propio la anula sin avisar: la galeria mostraba las
     * cuatro fotos a la vez por esto.
     */
    expect(read(CSS)).toMatch(/\[hidden\]\s*\{\s*display: none !important;/);
  });

  it('el texto solo para lectores de pantalla tiene estilo propio', () => {
    expect(read(CSS)).toContain('.visually-hidden');
    expect(read(GALLERY)).toContain('visually-hidden');
  });

  it('el movil tiene sus propias medidas', () => {
    const css = read(CSS);

    expect(css).toContain('@media (max-width: 52rem)');
    // El 16/9 del visor se queda demasiado bajo en vertical.
    expect(css).toMatch(/\.tour-frame\s*\{\s*aspect-ratio: 4 \/ 3;/);
  });

  it('quien pide menos movimiento no recibe ninguno', () => {
    expect(read(CSS)).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
