/**
 * Mapa publico: lo que se decide sin pintar nada.
 *
 * Que propiedades pueden salir en un mapa, por donde encuadrarlo y con cuanto
 * zoom son preguntas de datos. Viven aqui para poder probarlas de verdad y
 * para que el modulo de navegador se quede solo con Mapbox.
 *
 * Sobre la privacidad, que es lo que importa en este archivo: se parte de
 * `PublicPropertyCard`, que ya viene del read model sin coordenadas privadas.
 * `location.coordinates` es la publica y la unica que existe a este lado, asi
 * que no hay forma de que una privada llegue al mapa: no esta en el tipo.
 *
 * Tampoco se calcula ninguna aproximacion. Cuando la precision es
 * `approximate`, la coordenada desplazada la escribio una persona en el panel;
 * aqui solo se representa distinto.
 */

import type { LocationPrecision } from '../domain/vocabularies';
import type { PublicPropertyCard } from './read-model';

/** Una propiedad situable, con lo justo para su marcador y su ficha. */
export interface MapPoint {
  slug: string;
  title: string;
  href: string;

  latitude: number;
  longitude: number;
  precision: LocationPrecision;

  /** Ubicacion en texto; siempre disponible, tambien sin mapa. */
  place: string | null;
  priceText: string;
  areaText: string | null;

  imageUrl: string | null;
  imageAlt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Que entra en el mapa                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Convierte propiedades publicadas en puntos.
 *
 * Solo entran las que tienen coordenada publica utilizable. Una propiedad sin
 * ella no se coloca "cerca": desaparece del mapa y sigue estando en el
 * catalogo, que es lo honesto.
 *
 * Que la propiedad sea publicable ya lo decidio `isPubliclyVisible` al
 * construir el snapshot; aqui no se vuelve a decidir para no tener dos reglas.
 */
export function mapPointsOf(
  properties: readonly PublicPropertyCard[],
  placeOf: (property: PublicPropertyCard) => string | null,
): MapPoint[] {
  return properties.flatMap((property) => {
    const coordinates = property.location.coordinates;
    if (coordinates === null) return [];

    const cover = property.media.cover ?? property.media.hero;
    const image = cover?.kind === 'image' ? cover : null;

    return [
      {
        slug: property.slug,
        title: property.title,
        href: property.href,

        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        precision: property.location.precision,

        place: placeOf(property),
        priceText: property.price.text,
        areaText: property.area?.text ?? null,

        imageUrl: image?.url ?? null,
        imageAlt: image?.altText ?? null,
      },
    ];
  });
}

/* -------------------------------------------------------------------------- */
/* Encuadre                                                                   */
/* -------------------------------------------------------------------------- */

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function boundsOf(points: readonly MapPoint[]): MapBounds | null {
  const first = points[0];
  if (first === undefined) return null;

  let west = first.longitude;
  let east = first.longitude;
  let south = first.latitude;
  let north = first.latitude;

  for (const point of points) {
    if (point.longitude < west) west = point.longitude;
    if (point.longitude > east) east = point.longitude;
    if (point.latitude < south) south = point.latitude;
    if (point.latitude > north) north = point.latitude;
  }

  return { west, south, east, north };
}

/**
 * Zoom de una propiedad sola.
 *
 * Encuadrar un solo punto por sus limites da una caja de tamano cero y el
 * mapa se va al maximo, que ademas de feo insinua una precision que no hay.
 * Se fija un zoom a mano, y mas abierto cuando la ubicacion es aproximada.
 */
export const SINGLE_ZOOM: Record<LocationPrecision, number> = {
  exact: 14,
  approximate: 11,
};

/**
 * Hasta donde se deja acercar.
 *
 * En una ubicacion aproximada, poder llegar al tejado invita a leer la
 * coordenada como si fuera la buena. Se corta antes.
 */
export const MAX_ZOOM: Record<LocationPrecision, number> = {
  exact: 16,
  approximate: 12,
};

export type MapViewport =
  | { kind: 'empty' }
  | { kind: 'single'; longitude: number; latitude: number; zoom: number }
  | { kind: 'bounds'; bounds: MapBounds };

/**
 * Como abrir el mapa segun lo que haya que ensenar.
 *
 * Varios puntos que caen en el mismo sitio —dos lotes del mismo condominio,
 * por ejemplo— darian tambien una caja de tamano cero, asi que se tratan como
 * uno solo.
 */
export function viewportFor(points: readonly MapPoint[]): MapViewport {
  const bounds = boundsOf(points);
  const first = points[0];
  if (bounds === null || first === undefined) return { kind: 'empty' };

  const flat = bounds.west === bounds.east && bounds.south === bounds.north;

  if (points.length === 1 || flat) {
    return {
      kind: 'single',
      longitude: first.longitude,
      latitude: first.latitude,
      zoom: SINGLE_ZOOM[first.precision],
    };
  }

  return { kind: 'bounds', bounds };
}

/* -------------------------------------------------------------------------- */
/* Lectura del HTML                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Lee los puntos incrustados en la pagina.
 *
 * Viajan en un `<script type="application/json">`, como el recorrido: ni una
 * peticion mas, y lo que va ahi es exactamente lo que ya publica el snapshot.
 * Lo que no tenga forma de punto se descarta; un mapa con el JSON estropeado
 * debe caer al listado, no romper la pagina.
 */
export function parseMapPoints(raw: string): MapPoint[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter((point): point is MapPoint => {
    if (point === null || typeof point !== 'object') return false;

    const candidate = point as MapPoint;
    return (
      typeof candidate.slug === 'string' &&
      typeof candidate.href === 'string' &&
      Number.isFinite(candidate.latitude) &&
      Number.isFinite(candidate.longitude)
    );
  });
}
