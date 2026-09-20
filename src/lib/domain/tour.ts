/**
 * Recorrido 360: operaciones puras sobre `tour_json`.
 *
 * Un panorama es un nodo y su identidad es `mediaId`; no hay ids propios ni
 * tablas. Todas las funciones devuelven un tour nuevo y `null` cuando no queda
 * ningún punto: un recorrido vacío no existe.
 */
import type { Tour, TourNode } from './content';

/** Precisión suficiente para el visor; más decimales no cambian nada en pantalla. */
export const roundAngle = (value: number) => Math.round(value * 10000) / 10000;

const hasNode = (tour: Tour, mediaId: number) => tour.nodes.some((n) => n.mediaId === mediaId);

/** Reconstruye el tour conservando el inicio si sigue existiendo. */
const withNodes = (tour: Tour, nodes: TourNode[]): Tour | null =>
  nodes.length === 0
    ? null
    : {
        startMediaId: nodes.some((n) => n.mediaId === tour.startMediaId)
          ? tour.startMediaId
          : nodes[0]!.mediaId,
        nodes,
      };

const mapNode = (tour: Tour, mediaId: number, change: (node: TourNode) => TourNode): Tour => ({
  ...tour,
  nodes: tour.nodes.map((node) => (node.mediaId === mediaId ? change(node) : node)),
});

/** El primer panorama añadido queda además como punto inicial. */
export function addTourNode(tour: Tour | null, mediaId: number): Tour {
  const node: TourNode = { mediaId, name_es: null, name_en: null, initialView: null, links: [] };
  if (tour === null) return { startMediaId: mediaId, nodes: [node] };
  return hasNode(tour, mediaId) ? tour : { ...tour, nodes: [...tour.nodes, node] };
}

/**
 * Quita el punto, los enlaces que salen de él y los que le apuntaban.
 *
 * Es también la limpieza que necesita borrar el panorama desde Multimedia: no
 * pueden quedar referencias colgantes.
 */
export function removeTourNode(tour: Tour | null, mediaId: number): Tour | null {
  if (tour === null) return null;
  return withNodes(
    tour,
    tour.nodes
      .filter((node) => node.mediaId !== mediaId)
      .map((node) => ({ ...node, links: node.links.filter((l) => l.toMediaId !== mediaId) })),
  );
}

/** Cierto si borrar ese panorama cambia el recorrido. */
export const tourUsesMedia = (tour: Tour | null, mediaId: number): boolean =>
  tour !== null &&
  tour.nodes.some(
    (node) => node.mediaId === mediaId || node.links.some((l) => l.toMediaId === mediaId),
  );

export const setTourStart = (tour: Tour, mediaId: number): Tour =>
  hasNode(tour, mediaId) ? { ...tour, startMediaId: mediaId } : tour;

export const renameTourNode = (
  tour: Tour,
  mediaId: number,
  names: { name_es: string | null; name_en: string | null },
): Tour => mapNode(tour, mediaId, (node) => ({ ...node, ...names }));

export const setTourInitialView = (
  tour: Tour,
  mediaId: number,
  view: { yaw: number; pitch: number; fov: number | null },
): Tour =>
  mapNode(tour, mediaId, (node) => ({
    ...node,
    initialView: {
      yaw: roundAngle(view.yaw),
      pitch: roundAngle(view.pitch),
      fov: view.fov === null ? null : roundAngle(view.fov),
    },
  }));

/**
 * Coloca el enlace hacia un destino.
 *
 * Como mucho hay un enlace por destino: repetirlo mueve el que ya existía, que
 * es justo lo que espera quien vuelve a hacer clic sobre la puerta.
 */
export function upsertTourLink(
  tour: Tour,
  fromMediaId: number,
  toMediaId: number,
  yaw: number,
  pitch: number,
): Tour {
  if (fromMediaId === toMediaId || !hasNode(tour, toMediaId) || !hasNode(tour, fromMediaId))
    return tour;
  const link = { toMediaId, yaw: roundAngle(yaw), pitch: roundAngle(pitch) };
  return mapNode(tour, fromMediaId, (node) => ({
    ...node,
    links: node.links.some((l) => l.toMediaId === toMediaId)
      ? node.links.map((l) => (l.toMediaId === toMediaId ? link : l))
      : [...node.links, link],
  }));
}

export const removeTourLink = (tour: Tour, fromMediaId: number, toMediaId: number): Tour =>
  mapNode(tour, fromMediaId, (node) => ({
    ...node,
    links: node.links.filter((l) => l.toMediaId !== toMediaId),
  }));

export const tourNode = (tour: Tour | null, mediaId: number | null): TourNode | null =>
  tour === null || mediaId === null
    ? null
    : (tour.nodes.find((node) => node.mediaId === mediaId) ?? null);
