/**
 * Enlaces del recorrido 360.
 *
 * Un enlace es el punto por el que se salta de un panorama a otro. Sus `yaw` y
 * `pitch` son la posicion del hotspot dentro del panorama de ORIGEN.
 *
 * Reglas que el esquema ya expresa y que aqui se comprueban antes para poder
 * explicarlas en vez de devolver un error del driver:
 *
 * - ningun nodo enlaza consigo mismo (CHECK);
 * - no hay dos enlaces con el mismo origen y destino (UNIQUE);
 * - los dos extremos tienen que ser nodos de la MISMA propiedad, que es lo
 *   unico de esto que la base no puede garantizar sola.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { propertyTourLinks, propertyTourNodes } from '../../../db/schema';
import { validateTourLink } from '../../domain/consistency';
import { nextSortOrder } from '../shared';
import { fail, isUniqueViolation, ok, type AdminDatabase, type AdminResult } from '../types';

export interface CreateTourLinkInput {
  fromNodeId: number;
  toNodeId: number;
  yaw?: number;
  pitch?: number;
  sortOrder?: number;
}

/** Los extremos no se editan: mover un enlace es borrarlo y crear otro. */
export interface UpdateTourLinkInput {
  yaw?: number;
  pitch?: number;
  sortOrder?: number;
}

export interface TourLinkRecord {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  yaw: number;
  pitch: number;
  sortOrder: number;
}

function toRecord(row: typeof propertyTourLinks.$inferSelect): TourLinkRecord {
  return {
    id: row.id,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    yaw: row.yaw,
    pitch: row.pitch,
    sortOrder: row.sortOrder,
  };
}

/**
 * Comprueba que los dos extremos sean nodos de esta propiedad.
 *
 * Reutiliza `validateTourLink` de la Fase 2A, que es donde vive la regla.
 */
async function checkEndpoints<T>(
  db: AdminDatabase,
  propertyId: number,
  fromNodeId: number,
  toNodeId: number,
): Promise<AdminResult<T> | null> {
  if (fromNodeId === toNodeId) {
    return fail({
      code: 'tour_link_invalid',
      message: 'Un nodo no puede enlazar consigo mismo.',
      field: 'toNodeId',
    });
  }

  const rows = await db
    .select({
      id: propertyTourNodes.id,
      propertyId: propertyTourNodes.propertyId,
      propertyMediaId: propertyTourNodes.propertyMediaId,
      isStart: propertyTourNodes.isStart,
    })
    .from(propertyTourNodes)
    .where(inArray(propertyTourNodes.id, [fromNodeId, toNodeId]));

  const problems = validateTourLink({ fromNodeId, toNodeId }, rows);

  if (problems.includes('link_node_not_found')) {
    return fail({
      code: 'tour_node_not_found',
      message: 'Alguno de los nodos del enlace no existe.',
      field: 'toNodeId',
    });
  }

  if (problems.includes('link_crosses_properties')) {
    return fail({
      code: 'tour_link_invalid',
      message: 'Los dos extremos del enlace deben ser nodos de la misma propiedad.',
      field: 'toNodeId',
    });
  }

  // Los dos son de la misma propiedad; falta que sea ESTA propiedad.
  if (rows.some((row) => row.propertyId !== propertyId)) {
    return fail({
      code: 'tour_node_not_found',
      message: 'Alguno de los nodos del enlace no existe.',
      field: 'toNodeId',
    });
  }

  return null;
}

/** El enlace debe existir Y salir de un nodo de esta propiedad. */
export async function loadTourLink(
  db: AdminDatabase,
  propertyId: number,
  linkId: number,
): Promise<AdminResult<typeof propertyTourLinks.$inferSelect>> {
  const rows = await db
    .select()
    .from(propertyTourLinks)
    .where(eq(propertyTourLinks.id, linkId))
    .limit(1);

  const link = rows[0];

  if (link !== undefined) {
    const owner = await db
      .select({ id: propertyTourNodes.id })
      .from(propertyTourNodes)
      .where(
        and(
          eq(propertyTourNodes.id, link.fromNodeId),
          eq(propertyTourNodes.propertyId, propertyId),
        ),
      )
      .limit(1);

    if (owner.length > 0) return ok(link);
  }

  return fail({ code: 'tour_link_not_found', message: 'El enlace no existe.', field: 'linkId' });
}

export async function createTourLink(
  db: AdminDatabase,
  propertyId: number,
  input: CreateTourLinkInput,
): Promise<AdminResult<TourLinkRecord>> {
  const invalid = await checkEndpoints<TourLinkRecord>(
    db,
    propertyId,
    input.fromNodeId,
    input.toNodeId,
  );
  if (invalid !== null) return invalid;

  let sortOrder = input.sortOrder;

  if (sortOrder === undefined) {
    // Al final de los enlaces que ya salen de ese nodo.
    const siblings = await db
      .select({ sortOrder: propertyTourLinks.sortOrder })
      .from(propertyTourLinks)
      .where(eq(propertyTourLinks.fromNodeId, input.fromNodeId));

    sortOrder = nextSortOrder(siblings.map((row) => row.sortOrder));
  }

  let inserted: (typeof propertyTourLinks.$inferSelect)[];

  try {
    inserted = await db
      .insert(propertyTourLinks)
      .values({
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        ...(input.yaw === undefined ? {} : { yaw: input.yaw }),
        ...(input.pitch === undefined ? {} : { pitch: input.pitch }),
        sortOrder,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({
        code: 'tour_link_duplicate',
        message: 'Ya existe un enlace entre esos dos nodos.',
        field: 'toNodeId',
      });
    }
    throw error;
  }

  const link = inserted[0];
  if (link === undefined) {
    return fail({ code: 'validation_failed', message: 'No se pudo crear el enlace.' });
  }

  return ok(toRecord(link));
}

export async function updateTourLink(
  db: AdminDatabase,
  propertyId: number,
  linkId: number,
  input: UpdateTourLinkInput,
): Promise<AdminResult<TourLinkRecord>> {
  const found = await loadTourLink(db, propertyId, linkId);
  if (!found.ok) return found;

  const patch: Record<string, unknown> = {};
  if (input.yaw !== undefined) patch.yaw = input.yaw;
  if (input.pitch !== undefined) patch.pitch = input.pitch;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  if (Object.keys(patch).length > 0) {
    await db
      .update(propertyTourLinks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(propertyTourLinks.id, linkId));
  }

  const refreshed = await loadTourLink(db, propertyId, linkId);
  if (!refreshed.ok) return refreshed;

  return ok(toRecord(refreshed.data));
}

export async function deleteTourLink(
  db: AdminDatabase,
  propertyId: number,
  linkId: number,
): Promise<AdminResult<{ id: number }>> {
  const found = await loadTourLink(db, propertyId, linkId);
  if (!found.ok) return found;

  await db.delete(propertyTourLinks).where(eq(propertyTourLinks.id, linkId));

  return ok({ id: linkId });
}
