/**
 * Reglas de coherencia entre entidades que SQLite no puede garantizar con
 * claves foraneas simples.
 *
 * Todas estas comprobaciones se documentaron en el esquema como validacion de
 * aplicacion; aqui estan implementadas. Ninguna toca la base de datos: reciben
 * las filas ya cargadas y devuelven los problemas encontrados.
 */

import { canBeCatalogCover, canBeHero } from './media';
import type { MediaKind } from './vocabularies';

/* -------------------------------------------------------------------------- */
/* Formas minimas de entrada                                                  */
/* -------------------------------------------------------------------------- */

export interface OwnedByProperty {
  propertyId: number;
}

export interface GroupedItem extends OwnedByProperty {
  groupId: number | null;
}

export interface MediaLike extends OwnedByProperty {
  id: number;
  mediaKind: MediaKind;
  isHero: boolean;
  isCatalogCover: boolean;
}

export interface TourNodeLike extends OwnedByProperty {
  id: number;
  propertyMediaId: number;
  isStart: boolean;
}

export interface TourLinkLike {
  fromNodeId: number;
  toNodeId: number;
}

export type ConsistencyProblem =
  | 'group_belongs_to_other_property'
  | 'media_belongs_to_other_property'
  | 'media_is_not_panorama'
  | 'link_crosses_properties'
  | 'link_node_not_found'
  | 'tour_has_no_start_node'
  | 'tour_has_multiple_start_nodes';

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Una caracteristica agrupada debe usar un grupo de SU MISMA propiedad.
 * Sin grupo (`groupId = null`) siempre es valido.
 */
export function validateFeatureGroup(
  feature: GroupedItem,
  group: OwnedByProperty | null,
): ConsistencyProblem[] {
  return validateGroupOwnership(feature, group);
}

/** Misma regla para el multimedia y su grupo. */
export function validateMediaGroup(
  media: GroupedItem,
  group: OwnedByProperty | null,
): ConsistencyProblem[] {
  return validateGroupOwnership(media, group);
}

function validateGroupOwnership(
  item: GroupedItem,
  group: OwnedByProperty | null,
): ConsistencyProblem[] {
  if (item.groupId === null) return [];
  if (group === null) return ['group_belongs_to_other_property'];
  return group.propertyId === item.propertyId ? [] : ['group_belongs_to_other_property'];
}

/* -------------------------------------------------------------------------- */
/* Tour                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Un nodo del recorrido debe apuntar a un panorama de su misma propiedad.
 */
export function validateTourNode(node: TourNodeLike, media: MediaLike): ConsistencyProblem[] {
  const problems: ConsistencyProblem[] = [];

  if (media.propertyId !== node.propertyId) problems.push('media_belongs_to_other_property');
  if (media.mediaKind !== 'panorama') problems.push('media_is_not_panorama');

  return problems;
}

/**
 * Un enlace debe unir dos nodos de la misma propiedad. La autorreferencia ya
 * la impide un CHECK del esquema.
 */
export function validateTourLink(link: TourLinkLike, nodes: TourNodeLike[]): ConsistencyProblem[] {
  const from = nodes.find((node) => node.id === link.fromNodeId);
  const to = nodes.find((node) => node.id === link.toNodeId);

  if (from === undefined || to === undefined) return ['link_node_not_found'];

  return from.propertyId === to.propertyId ? [] : ['link_crosses_properties'];
}

/**
 * Un recorrido publicable necesita exactamente un nodo inicial y que todos
 * sus panoramas sean validos.
 *
 * Una propiedad SIN tour es valida: se devuelve vacio cuando no hay nodos.
 */
export function validateTourForPublication(
  nodes: TourNodeLike[],
  mediaById: ReadonlyMap<number, MediaLike>,
): ConsistencyProblem[] {
  if (nodes.length === 0) return [];

  const problems: ConsistencyProblem[] = [];

  const startNodes = nodes.filter((node) => node.isStart);
  if (startNodes.length === 0) problems.push('tour_has_no_start_node');
  if (startNodes.length > 1) problems.push('tour_has_multiple_start_nodes');

  for (const node of nodes) {
    const media = mediaById.get(node.propertyMediaId);
    if (media === undefined) {
      problems.push('media_belongs_to_other_property');
      continue;
    }
    for (const problem of validateTourNode(node, media)) {
      if (!problems.includes(problem)) problems.push(problem);
    }
  }

  return problems;
}

/* -------------------------------------------------------------------------- */
/* Hero y portada                                                             */
/* -------------------------------------------------------------------------- */

export type MediaRoleProblem =
  | 'hero_not_found'
  | 'hero_belongs_to_other_property'
  | 'hero_invalid_kind'
  | 'catalog_cover_not_found'
  | 'catalog_cover_belongs_to_other_property'
  | 'catalog_cover_invalid_kind';

/**
 * Validacion de aplicacion que se suma a los CHECK e indices parciales ya
 * existentes en el esquema.
 *
 * Una misma imagen puede ser hero y portada a la vez: eso es intencionado y
 * no se considera un problema.
 */
export function validateMediaRoles(propertyId: number, media: MediaLike[]): MediaRoleProblem[] {
  const problems: MediaRoleProblem[] = [];

  const hero = media.find((item) => item.isHero);
  if (hero === undefined) {
    problems.push('hero_not_found');
  } else {
    if (hero.propertyId !== propertyId) problems.push('hero_belongs_to_other_property');
    // La regla de que tipos valen vive en `media.ts`, en un solo sitio.
    if (!canBeHero(hero.mediaKind)) problems.push('hero_invalid_kind');
  }

  const cover = media.find((item) => item.isCatalogCover);
  if (cover === undefined) {
    problems.push('catalog_cover_not_found');
  } else {
    if (cover.propertyId !== propertyId) problems.push('catalog_cover_belongs_to_other_property');
    if (!canBeCatalogCover(cover.mediaKind)) problems.push('catalog_cover_invalid_kind');
  }

  return problems;
}
