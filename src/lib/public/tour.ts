/**
 * Recorrido 360 publico: lo que se puede decidir sin tocar el DOM.
 *
 * Resolver por donde empieza el recorrido, que punto es cada clave y a donde
 * llevan los saltos son preguntas de datos, no de pantalla. Viven aqui para
 * poder probarlas de verdad, y para que el modulo de navegador se quede solo
 * con el visor.
 *
 * Se trabaja siempre sobre `PublicTour`, que ya viene depurado del read model:
 * aqui no hay ids de la base ni forma de llegar a ellos.
 */

import type { PublicTour, PublicTourNode } from './read-model';

/**
 * Lo unico que hace falta saber del idioma para nombrar un punto.
 *
 * Se pide asi, y no la tabla entera de textos, porque este modulo tambien se
 * ejecuta en el navegador: llevar hasta alli los textos de todo el sitio para
 * usar una frase seria pagar de mas.
 */
export interface TourNaming {
  pointName: (position: number) => string;
}

/** Un salto ya resuelto: con el nombre del destino, listo para pintar. */
export interface TourDestination {
  key: string;
  label: string;
  yaw: number;
  pitch: number;
}

export function nodeByKey(tour: PublicTour, key: string): PublicTourNode | null {
  return tour.nodes.find((node) => node.key === key) ?? null;
}

/**
 * Por donde abre el recorrido.
 *
 * Si la clave inicial no cuadra con ningun punto —datos raros, snapshot a
 * medias— se abre por el primero en vez de no abrir nada.
 */
export function startNode(tour: PublicTour): PublicTourNode | null {
  return nodeByKey(tour, tour.start) ?? tour.nodes[0] ?? null;
}

/**
 * Nombre visible de un punto.
 *
 * El editor puede dejar un punto sin nombre, y sobre todo puede dejarlo sin
 * nombre en UN idioma. En vez de mostrar un hueco se usa su posicion, que
 * siempre dice algo: "Punto 3".
 */
export function nodeLabel(tour: PublicTour, node: PublicTourNode, naming: TourNaming): string {
  if (node.name !== null) return node.name;

  const position = tour.nodes.indexOf(node);
  return naming.pointName(position < 0 ? Number(node.key) : position + 1);
}

/**
 * Los saltos que salen de un punto, con el nombre de su destino.
 *
 * Se descarta el salto cuyo destino no existe: el read model ya los limpia,
 * pero el visor no debe depender de eso para no llevar a ninguna parte.
 */
export function destinationsOf(
  tour: PublicTour,
  node: PublicTourNode,
  naming: TourNaming,
): TourDestination[] {
  return node.links.flatMap((link) => {
    const target = nodeByKey(tour, link.to);
    if (target === null) return [];

    return [
      { key: target.key, label: nodeLabel(tour, target, naming), yaw: link.yaw, pitch: link.pitch },
    ];
  });
}

/**
 * Lee el recorrido incrustado en la pagina.
 *
 * Viaja en un `<script type="application/json">` del propio HTML: no hay una
 * peticion mas, y lo que va ahi es exactamente lo que ya publica el snapshot.
 * Cualquier cosa que no case con la forma esperada se descarta; una ficha con
 * el JSON estropeado debe seguir viendose.
 */
export function parseTour(raw: string): PublicTour | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object') return null;

  const candidate = parsed as { start?: unknown; nodes?: unknown };
  if (typeof candidate.start !== 'string' || !Array.isArray(candidate.nodes)) return null;

  const nodes = candidate.nodes.filter(
    (node): node is PublicTourNode =>
      node !== null &&
      typeof node === 'object' &&
      typeof (node as PublicTourNode).key === 'string' &&
      typeof (node as PublicTourNode).url === 'string' &&
      Array.isArray((node as PublicTourNode).links),
  );

  return nodes.length === 0 ? null : { start: candidate.start, nodes };
}
