/**
 * Lectura del recorrido 360 de una propiedad.
 *
 * Devuelve la estructura ya lista para pintar: los nodos en orden, con su
 * panorama, sus nombres por idioma y los enlaces que SALEN de cada uno. Los
 * enlaces entrantes no se listan aparte: en el visor siempre se navega desde
 * el nodo en el que uno esta.
 *
 * El orden se fija SIEMPRE de forma explicita (`sort_order ASC, id ASC`); no
 * se confia en el orden natural de SQLite.
 */

import { asc, eq } from 'drizzle-orm';

import {
  properties,
  propertyMedia,
  propertyTourLinks,
  propertyTourNodeTranslations,
  propertyTourNodes,
} from '../../../db/schema';
import type { Locale, MediaKind, SourceProvider } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

/** El panorama en el que se apoya el nodo, con lo justo para reconocerlo. */
export interface TourPanoramaView {
  id: number;
  mediaKind: MediaKind;
  sourceProvider: SourceProvider;
  objectKey: string | null;
}

export interface TourLinkView {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  /** Posicion del hotspot dentro del panorama de origen. */
  yaw: number;
  pitch: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TourNodeView {
  id: number;
  sortOrder: number;
  isStart: boolean;

  /** Camara inicial del nodo. `null` mientras no se haya ajustado. */
  initialYaw: number | null;
  initialPitch: number | null;
  initialFov: number | null;

  panorama: TourPanoramaView | null;
  names: Partial<Record<Locale, string | null>>;
  /** Enlaces que parten de este nodo, en su orden. */
  links: TourLinkView[];

  createdAt: Date;
  updatedAt: Date;
}

export interface PropertyTourView {
  propertyId: number;
  nodes: TourNodeView[];
  /** Derivado de las banderas; `null` si todavia no se ha elegido. */
  startNodeId: number | null;
}

/** Orden estable: primero `sortOrder`, y el id desempata. */
function byOrder<T extends { sortOrder: number; id: number }>(a: T, b: T): number {
  return a.sortOrder === b.sortOrder ? a.id - b.id : a.sortOrder - b.sortOrder;
}

export async function getPropertyTour(
  db: AdminDatabase,
  propertyId: number,
): Promise<AdminResult<PropertyTourView>> {
  const owner = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  if (owner.length === 0) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const nodeRows = await db
    .select()
    .from(propertyTourNodes)
    .where(eq(propertyTourNodes.propertyId, propertyId))
    .orderBy(asc(propertyTourNodes.sortOrder), asc(propertyTourNodes.id));

  const nodeIds = new Set(nodeRows.map((row) => row.id));

  /*
   * Traducciones, panoramas y enlaces se traen enteros y se cruzan en memoria,
   * igual que en caracteristicas y multimedia: con el volumen previsto es mas
   * simple y legible que varios joins condicionales.
   */
  const names = await db
    .select({
      nodeId: propertyTourNodeTranslations.propertyTourNodeId,
      locale: propertyTourNodeTranslations.locale,
      name: propertyTourNodeTranslations.name,
    })
    .from(propertyTourNodeTranslations);

  const panoramas = await db
    .select({
      id: propertyMedia.id,
      mediaKind: propertyMedia.mediaKind,
      sourceProvider: propertyMedia.sourceProvider,
      objectKey: propertyMedia.objectKey,
    })
    .from(propertyMedia)
    .where(eq(propertyMedia.propertyId, propertyId));

  const linkRows = await db
    .select()
    .from(propertyTourLinks)
    .orderBy(asc(propertyTourLinks.sortOrder), asc(propertyTourLinks.id));

  const namesByNode = new Map<number, Partial<Record<Locale, string | null>>>();
  for (const row of names) {
    if (!nodeIds.has(row.nodeId)) continue;

    const entry = namesByNode.get(row.nodeId) ?? {};
    entry[row.locale] = row.name;
    namesByNode.set(row.nodeId, entry);
  }

  const panoramaById = new Map(panoramas.map((row) => [row.id, row]));

  const linksByNode = new Map<number, TourLinkView[]>();
  for (const row of linkRows) {
    // Solo los enlaces cuyo origen es un nodo de esta propiedad.
    if (!nodeIds.has(row.fromNodeId)) continue;

    const list = linksByNode.get(row.fromNodeId) ?? [];
    list.push({
      id: row.id,
      fromNodeId: row.fromNodeId,
      toNodeId: row.toNodeId,
      yaw: row.yaw,
      pitch: row.pitch,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    linksByNode.set(row.fromNodeId, list);
  }

  const nodes: TourNodeView[] = nodeRows
    .map((row) => ({
      id: row.id,
      sortOrder: row.sortOrder,
      isStart: row.isStart,

      initialYaw: row.initialYaw,
      initialPitch: row.initialPitch,
      initialFov: row.initialFov,

      panorama: panoramaById.get(row.propertyMediaId) ?? null,
      names: namesByNode.get(row.id) ?? {},
      links: (linksByNode.get(row.id) ?? []).sort(byOrder),

      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
    .sort(byOrder);

  return ok({
    propertyId,
    nodes,
    startNodeId: nodes.find((node) => node.isStart)?.id ?? null,
  });
}
