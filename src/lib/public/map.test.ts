/**
 * Tests del mapa publico.
 *
 * Lo que se puede decidir sin pintar —que propiedad entra, por donde se
 * encuadra, con cuanto zoom— se prueba como funcion pura. Lo que solo existe
 * como plantilla se comprueba sobre el fuente, como en el resto del proyecto:
 * sin navegador y sin dependencias nuevas.
 *
 * Hay un bloque entero dedicado a que ninguna coordenada privada pueda llegar
 * al mapa, que es la regla que mas importa de esta fase.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { labelsFor } from './labels';
import {
  boundsOf,
  mapPointsOf,
  MAX_ZOOM,
  parseMapPoints,
  SINGLE_ZOOM,
  viewportFor,
  type MapPoint,
} from './map';
import { mapHref, navigationFor } from './navigation';
import type { PublicPropertyCard } from './read-model';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const EXPLORER = 'src/components/public/MapExplorer.astro';
const PROPERTY_MAP = 'src/components/public/PropertyMap.astro';
const MAP_ES = 'src/pages/es/mapa.astro';
const MAP_EN = 'src/pages/en/map.astro';
const PAGE_MODULE = 'src/lib/public/map-page.ts';
const MAPBOX = 'src/lib/public/mapbox.ts';
const MAP_MODULE = 'src/lib/public/map.ts';
const DETAIL = 'src/components/public/PropertyDetail.astro';
const CSS = 'src/styles/global.css';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function card(overrides: Partial<PublicPropertyCard> = {}): PublicPropertyCard {
  return {
    code: 'LOBA-001',
    slug: 'lote',
    title: 'Lote con vista al mar',
    propertyType: 'Lote',
    price: { mode: 'exact', amountMinor: 18_500_000, currencyCode: 'USD', text: '185.000 US$' },
    area: { squareMeters: 5200, text: '5200 m²' },
    location: {
      province: 'Guanacaste',
      canton: 'Nicoya',
      district: 'Nosara',
      locality: null,
      coordinates: { latitude: 9.95, longitude: -85.65 },
      precision: 'exact',
    },
    commercialStatus: null,
    isFeatured: false,
    media: {
      counts: { image: 0, video: 0, document: 0, panorama: 0 },
      hasTour: false,
      cover: null,
      hero: null,
      items: [],
    },
    href: '/es/propiedades/lote',
    ...overrides,
  };
}

function point(overrides: Partial<MapPoint> = {}): MapPoint {
  return {
    slug: 'lote',
    title: 'Lote',
    href: '/es/propiedades/lote',
    latitude: 9.95,
    longitude: -85.65,
    precision: 'exact',
    place: null,
    priceText: '185.000 US$',
    areaText: null,
    imageUrl: null,
    imageAlt: null,
    ...overrides,
  };
}

const NO_PLACE = () => null;

/* -------------------------------------------------------------------------- */
/* Que entra en el mapa                                                       */
/* -------------------------------------------------------------------------- */

describe('que propiedades se situan', () => {
  it('una con coordenada publica entra, con lo que hace falta para su tarjeta', () => {
    const points = mapPointsOf([card()], () => 'Nosara, Nicoya, Guanacaste');

    expect(points).toHaveLength(1);
    expect(points[0]?.latitude).toBe(9.95);
    expect(points[0]?.longitude).toBe(-85.65);
    expect(points[0]?.place).toBe('Nosara, Nicoya, Guanacaste');
    expect(points[0]?.priceText).toBe('185.000 US$');
    expect(points[0]?.areaText).toBe('5200 m²');
    expect(points[0]?.href).toBe('/es/propiedades/lote');
  });

  it('una sin coordenada publica no se situa en ninguna parte', () => {
    const without = card({
      location: { ...card().location, coordinates: null },
    });

    // No se coloca "cerca": desaparece del mapa y sigue en el catalogo.
    expect(mapPointsOf([without], NO_PLACE)).toEqual([]);
  });

  it('conserva la precision de cada una', () => {
    const approximate = card({
      slug: 'finca',
      location: { ...card().location, precision: 'approximate' },
    });

    const points = mapPointsOf([card(), approximate], NO_PLACE);

    expect(points.map((item) => item.precision)).toEqual(['exact', 'approximate']);
  });

  it('usa la portada del catalogo, y si no la hay la principal de la ficha', () => {
    const image = {
      kind: 'image' as const,
      url: '/media/7',
      youtubeVideoId: null,
      title: null,
      altText: 'Vista de la bahia',
      caption: null,
      group: null,
      isHero: true,
      isCatalogCover: false,
    };

    const onlyHero = card({ media: { ...card().media, hero: image } });
    expect(mapPointsOf([onlyHero], NO_PLACE)[0]?.imageUrl).toBe('/media/7');
    expect(mapPointsOf([onlyHero], NO_PLACE)[0]?.imageAlt).toBe('Vista de la bahia');

    const cover = { ...image, url: '/media/9', isCatalogCover: true, isHero: false };
    const both = card({ media: { ...card().media, cover, hero: image } });
    expect(mapPointsOf([both], NO_PLACE)[0]?.imageUrl).toBe('/media/9');
  });

  it('si lo que encabeza es un video, no se usa como imagen', () => {
    const video = {
      kind: 'video' as const,
      url: null,
      youtubeVideoId: 'dQw4w9WgXcQ',
      title: null,
      altText: null,
      caption: null,
      group: null,
      isHero: true,
      isCatalogCover: false,
    };

    const withVideo = card({ media: { ...card().media, hero: video } });

    expect(mapPointsOf([withVideo], NO_PLACE)[0]?.imageUrl).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Encuadre                                                                   */
/* -------------------------------------------------------------------------- */

describe('encuadre', () => {
  it('sin propiedades no hay nada que encuadrar', () => {
    expect(boundsOf([])).toBeNull();
    expect(viewportFor([])).toEqual({ kind: 'empty' });
  });

  it('con una sola se centra en ella y con un zoom razonable', () => {
    const view = viewportFor([point()]);

    // Encuadrar un punto por sus limites daria una caja de tamano cero.
    expect(view).toEqual({
      kind: 'single',
      longitude: -85.65,
      latitude: 9.95,
      zoom: SINGLE_ZOOM.exact,
    });
  });

  it('una sola aproximada abre mas lejos', () => {
    const view = viewportFor([point({ precision: 'approximate' })]);

    expect(view).toEqual({
      kind: 'single',
      longitude: -85.65,
      latitude: 9.95,
      zoom: SINGLE_ZOOM.approximate,
    });
    expect(SINGLE_ZOOM.approximate).toBeLessThan(SINGLE_ZOOM.exact);
  });

  it('con varias se encuadran todas', () => {
    const points = [
      point({ slug: 'a', latitude: 9.9, longitude: -85.7 }),
      point({ slug: 'b', latitude: 10.2, longitude: -85.1 }),
      point({ slug: 'c', latitude: 9.5, longitude: -85.4 }),
    ];

    expect(boundsOf(points)).toEqual({ west: -85.7, south: 9.5, east: -85.1, north: 10.2 });
    expect(viewportFor(points)).toEqual({
      kind: 'bounds',
      bounds: { west: -85.7, south: 9.5, east: -85.1, north: 10.2 },
    });
  });

  it('varias en el mismo punto se tratan como una', () => {
    // Dos lotes del mismo condominio darian tambien una caja de tamano cero.
    const points = [point({ slug: 'a' }), point({ slug: 'b' })];

    expect(viewportFor(points)).toMatchObject({ kind: 'single', zoom: SINGLE_ZOOM.exact });
  });

  it('no se deja acercar tanto sobre una ubicacion aproximada', () => {
    // Llegar al tejado invitaria a leer la coordenada como si fuera la buena.
    expect(MAX_ZOOM.approximate).toBeLessThan(MAX_ZOOM.exact);
  });
});

/* -------------------------------------------------------------------------- */
/* Lectura del HTML                                                           */
/* -------------------------------------------------------------------------- */

describe('los puntos incrustados en la pagina', () => {
  it('se leen tal cual los publica el snapshot', () => {
    expect(parseMapPoints(JSON.stringify([point()]))[0]?.slug).toBe('lote');
  });

  it('un JSON estropeado deja la pagina en su listado', () => {
    expect(parseMapPoints('{ esto no es json')).toEqual([]);
    expect(parseMapPoints('')).toEqual([]);
    expect(parseMapPoints('null')).toEqual([]);
    expect(parseMapPoints('{"slug":"lote"}')).toEqual([]);
  });

  it('lo que no tiene coordenada utilizable se descarta', () => {
    const broken = JSON.stringify([
      { slug: 'a', href: '/a', latitude: 'norte', longitude: -85 },
      { slug: 'b', href: '/b', latitude: 9.9, longitude: -85.6 },
    ]);

    expect(parseMapPoints(broken).map((item) => item.slug)).toEqual(['b']);
  });
});

/* -------------------------------------------------------------------------- */
/* Privacidad                                                                 */
/* -------------------------------------------------------------------------- */

describe('la coordenada privada no puede llegar al mapa', () => {
  it('el punto del mapa solo tiene las claves previstas', () => {
    expect(Object.keys(mapPointsOf([card()], NO_PLACE)[0] ?? {}).sort()).toEqual(
      [
        'areaText',
        'href',
        'imageAlt',
        'imageUrl',
        'latitude',
        'longitude',
        'place',
        'precision',
        'priceText',
        'slug',
        'title',
      ].sort(),
    );
  });

  it('ningun modulo del mapa nombra siquiera la coordenada privada', () => {
    for (const file of [MAP_MODULE, MAPBOX, PAGE_MODULE, EXPLORER, PROPERTY_MAP, MAP_ES, MAP_EN]) {
      const source = read(file);

      expect(source).not.toContain('privateLatitude');
      expect(source).not.toContain('privateLongitude');
    }
  });

  it('el mapa parte del read model, que ya viene sin ellas', () => {
    // `MapPoint` se construye desde `location.coordinates`, la publica.
    expect(read(MAP_MODULE)).toContain('property.location.coordinates');
    expect(read(MAP_MODULE)).not.toContain('publicLatitude');
  });

  it('no se calcula ninguna aproximacion en el navegador', () => {
    for (const file of [MAP_MODULE, MAPBOX, PAGE_MODULE]) {
      const source = read(file);

      // Desplazar una coordenada es cosa del panel, no del sitio publico.
      expect(source).not.toContain('Math.random');
      expect(source).not.toContain('offset(');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Token                                                                      */
/* -------------------------------------------------------------------------- */

describe('el token de Mapbox', () => {
  it('sale del entorno del build, nunca del codigo', () => {
    for (const file of [EXPLORER, PROPERTY_MAP]) {
      expect(read(file)).toContain('import.meta.env.PUBLIC_MAPBOX_TOKEN');
    }
  });

  it('no hay ningun token escrito en el repositorio', () => {
    for (const file of [EXPLORER, PROPERTY_MAP, MAPBOX, PAGE_MODULE, MAP_ES, MAP_EN]) {
      // Un token publico de Mapbox empieza por `pk.`; uno secreto, por `sk.`.
      expect(read(file)).not.toMatch(/\b[ps]k\.[A-Za-z0-9]/);
    }
  });

  it('sin token no se crea nada, y el build sigue siendo posible', () => {
    expect(read(MAPBOX)).toContain('if (options.token.length === 0) return null;');
    expect(read(PAGE_MODULE)).toContain('if (token.length === 0)');
    // El contenedor solo se pinta cuando hay token.
    expect(read(EXPLORER)).toContain("import.meta.env.PUBLIC_MAPBOX_TOKEN ?? ''");
  });

  it('esta documentado donde va, y `.env` no se versiona', () => {
    expect(read('.env.example')).toContain('PUBLIC_MAPBOX_TOKEN=');
    expect(read('.gitignore')).toContain('.env');
    expect(read('.gitignore')).toContain('!.env.example');
  });
});

/* -------------------------------------------------------------------------- */
/* Carga diferida                                                             */
/* -------------------------------------------------------------------------- */

describe('Mapbox no lastra al resto del sitio', () => {
  it('se carga solo con `import()`, nunca de forma estatica', () => {
    const mapbox = read(MAPBOX);

    expect(mapbox).toContain("import('mapbox-gl')");
    expect(mapbox).not.toContain("from 'mapbox-gl'");
  });

  it('sus estilos viajan dentro del trozo diferido', () => {
    // Enlazarlos normalmente los pondria en el `<head>` de cada ficha.
    expect(read(MAPBOX)).toContain("import('mapbox-gl/dist/mapbox-gl.css?inline')");
  });

  it('una ficha sin ubicacion no llega a pedir el mapa', () => {
    expect(read(PAGE_MODULE)).toContain("byId<HTMLElement>('property-map')");
    expect(read(PAGE_MODULE)).toContain('if (canvas === null) return;');
  });
});

/* -------------------------------------------------------------------------- */
/* Estructura y accesibilidad                                                 */
/* -------------------------------------------------------------------------- */

describe('la pagina de mapa', () => {
  it('existe en los dos idiomas, con su arbol y su alternate', () => {
    expect(mapHref('es')).toBe('/es/mapa');
    expect(mapHref('en')).toBe('/en/map');

    expect(read(MAP_ES)).toContain("const locale = 'es' as const");
    expect(read(MAP_ES)).toContain("mapHref('en')");
    expect(read(MAP_EN)).toContain("const locale = 'en' as const");
    expect(read(MAP_EN)).toContain("mapHref('es')");
  });

  it('el menu ya lleva al mapa, y Contacto sigue pendiente', () => {
    const items = navigationFor('es');

    expect(items[1]?.available).toBe(true);
    expect(items[1]?.href).toBe('/es/mapa');
    expect(items[2]?.available).toBe(false);
  });

  it('sigue siendo estatica: el snapshot del build, no una consulta', () => {
    for (const page of [MAP_ES, MAP_EN]) {
      expect(read(page)).toContain('loadPublicSnapshot');
      expect(read(page)).not.toContain('prerender = false');
    }
  });

  it('el listado esta en el HTML y enlaza a cada ficha', () => {
    const explorer = read(EXPLORER);

    expect(explorer).toContain('properties.map');
    expect(explorer).toContain('href={property.href}');
    expect(explorer).toContain('data-map-item');
    expect(explorer).toContain('data-slug={property.slug}');
  });

  it('el mapa y sus botones llegan ocultos', () => {
    const explorer = read(EXPLORER);

    // Sin JavaScript no harian nada; un boton muerto es peor que ninguno.
    expect(explorer).toContain('id="map-canvas"');
    expect(explorer).toContain('data-map-focus');
    expect(explorer).toMatch(/aria-pressed="false"\s*\n\s*hidden/);
  });

  it('sin mapa, el listado ocupa la pagina entera', () => {
    // Si no, queda media pantalla en blanco donde deberia ir el mapa.
    expect(read(CSS)).toContain('.map-explorer.has-map {');
    expect(read(PAGE_MODULE)).toContain("classList.remove('has-map')");
  });

  it('el ancho definitivo se fija ANTES de crear el mapa', () => {
    const page = read(PAGE_MODULE);

    /*
     * Mapbox mide su caja al nacer y no vuelve a mirarla: si el ancho cambia
     * despues, el encuadre se queda con las medidas viejas y los marcadores
     * acaban fuera de la vista.
     */
    const revelado = page.indexOf("explorer?.classList.add('has-map')");
    const creacion = page.indexOf('await createPublicMap');

    expect(revelado).toBeGreaterThan(-1);
    expect(revelado).toBeLessThan(creacion);
  });

  it('sin propiedades situadas hay un estado vacio util', () => {
    const explorer = read(EXPLORER);

    expect(explorer).toContain('points.length === 0');
    expect(explorer).toContain('labels.mapEmpty');
    expect(explorer).toContain('labels.mapEmptyHint');
  });

  it('marcador y listado se senalan mutuamente', () => {
    const page = read(PAGE_MODULE);

    expect(page).toContain('onSelect');
    expect(page).toContain("classList.toggle('is-current'");
    expect(page).toContain('map.select(slug)');
  });

  it('solo hay una ficha flotante abierta a la vez', () => {
    const mapbox = read(MAPBOX);

    /*
     * Mapbox cierra la suya al pinchar en el mapa, pero no al elegir otra
     * propiedad: quedaban dos abiertas y se solapaban.
     */
    expect(mapbox).toContain('closeOthers');
    expect(mapbox).toContain('if (slug !== keep && popup.isOpen()) popup.remove();');
  });

  it('un marcador es un boton, alcanzable con el tabulador', () => {
    const mapbox = read(MAPBOX);

    expect(mapbox).toContain("document.createElement('button')");
    expect(mapbox).toContain("element.setAttribute('aria-label'");
  });

  it('quien pide menos movimiento no recibe vuelos de camara', () => {
    expect(read(MAPBOX)).toContain('prefersReducedMotion() ? 0 : 700');
  });

  it('los controles de Mapbox hablan el idioma de la pagina', () => {
    expect(read(MAPBOX)).toContain('translateControls');
    expect(labelsFor('es').zoomIn).toBe('Acercar');
    expect(labelsFor('en').zoomIn).toBe('Zoom in');
  });
});

describe('el mapa de la ficha', () => {
  it('sustituye al hueco que habia antes', () => {
    const detail = read(DETAIL);

    expect(detail).toContain('<PropertyMap');
    expect(detail).not.toContain('mapComingSoon');
    // El de contacto sigue anunciado, que esa fase no ha llegado.
    expect(detail).toContain('contactComingSoon');
  });

  it('la ubicacion en texto va siempre, con mapa o sin el', () => {
    const map = read(PROPERTY_MAP);

    expect(map).toContain('property-location-line');
    expect(map).toContain("place ?? '—'");
  });

  it('una ubicacion aproximada se dice, no solo se dibuja', () => {
    const map = read(PROPERTY_MAP);

    expect(map).toContain("property.location.precision === 'approximate'");
    expect(map).toContain('labels.approximateLocation');
    expect(map).toContain('labels.approximateLocationNote');
  });

  it('sin coordenada se explica en vez de dejar un hueco', () => {
    expect(read(PROPERTY_MAP)).toContain('labels.noMapLocation');
  });

  it('se dibuja distinta de una exacta', () => {
    const css = read(CSS);

    // Anillo abierto y a rayas, sin punto central que senale un sitio.
    expect(css).toContain('.map-pin--approximate .map-pin-mark');
    expect(css).toContain('border: 2px dashed var(--sand-deep)');
  });

  it('en movil el mapa tiene sus propias medidas', () => {
    const css = read(CSS);

    expect(css).toMatch(/\.map-explorer\.has-map\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.property-map\s*\{\s*aspect-ratio: 4 \/ 3;/);
  });
});
