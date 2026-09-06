/**
 * Nodos del recorrido 360.
 *
 * Un nodo es un panorama desde el que se mira. Tres reglas que el esquema ya
 * expresa y que aqui se comprueban antes para poder explicarlas:
 *
 * - el archivo tiene que ser de tipo `panorama`;
 * - tiene que ser de la MISMA propiedad que el nodo;
 * - un panorama sostiene un unico nodo (`property_tour_nodes_media_unique`).
 *
 * El nodo inicial se cambia en lote: el indice parcial solo admite uno por
 * propiedad, asi que retirar el anterior y marcar el nuevo tiene que ir junto.
 */

import { and, eq, ne } from 'drizzle-orm';

import {
  properties,
  propertyMedia,
  propertyTourNodeTranslations,
  propertyTourNodes,
} from '../../../db/schema';
import { validateTourNode } from '../../domain/consistency';
import type { Locale } from '../../domain/vocabularies';
import { nextSortOrder, normalizeText } from '../shared';
import {
  fail,
  isUniqueViolation,
  ok,
  type AdminBatchDatabase,
  type AdminDatabase,
  type AdminResult,
} from '../types';

export interface TourNodeNames {
  nameEs?: string | null;
  nameEn?: string | null;
}

/** Camara inicial. Las unidades las fijara el visor; aqui solo se guardan. */
export interface TourNodeCamera {
  initialYaw?: number | null;
  initialPitch?: number | null;
  initialFov?: number | null;
}

export interface CreateTourNodeInput extends TourNodeNames, TourNodeCamera {
  propertyMediaId: number;
  sortOrder?: number;
}

/**
 * Campos editables.
 *
 * `propertyMediaId` no esta: cambiar el panorama de un nodo equivale a otro
 * nodo. Se crea uno nuevo y se borra este, y asi los enlaces que apuntaban al
 * anterior no quedan describiendo un sitio que ya no es.
 */
export interface UpdateTourNodeInput extends TourNodeNames, TourNodeCamera {
  sortOrder?: number;
}

export interface TourNodeRecord {
  id: number;
  propertyId: number;
  propertyMediaId: number;
  sortOrder: number;
  isStart: boolean;
}

function toRecord(row: typeof propertyTourNodes.$inferSelect): TourNodeRecord {
  return {
    id: row.id,
    propertyId: row.propertyId,
    propertyMediaId: row.propertyMediaId,
    sortOrder: row.sortOrder,
    isStart: row.isStart,
  };
}

/** El nodo debe existir Y ser de esta propiedad. */
export async function loadTourNode(
  db: AdminDatabase,
  propertyId: number,
  nodeId: number,
): Promise<AdminResult<typeof propertyTourNodes.$inferSelect>> {
  const rows = await db
    .select()
    .from(propertyTourNodes)
    .where(eq(propertyTourNodes.id, nodeId))
    .limit(1);

  const node = rows[0];
  if (node === undefined || node.propertyId !== propertyId) {
    return fail({ code: 'tour_node_not_found', message: 'El nodo no existe.', field: 'nodeId' });
  }

  return ok(node);
}

/**
 * Comprueba que el archivo pueda sostener un nodo.
 *
 * Reutiliza `validateTourNode` de la Fase 2A: la regla de "panorama de la
 * misma propiedad" vive alli y no se reescribe.
 */
async function checkPanorama<T>(
  db: AdminDatabase,
  propertyId: number,
  mediaId: number,
): Promise<AdminResult<T> | null> {
  const rows = await db
    .select({
      id: propertyMedia.id,
      propertyId: propertyMedia.propertyId,
      mediaKind: propertyMedia.mediaKind,
      isHero: propertyMedia.isHero,
      isCatalogCover: propertyMedia.isCatalogCover,
    })
    .from(propertyMedia)
    .where(eq(propertyMedia.id, mediaId))
    .limit(1);

  const media = rows[0];
  if (media === undefined) {
    return fail({
      code: 'tour_media_property_mismatch',
      message: 'El panorama no existe o no pertenece a esta propiedad.',
      field: 'propertyMediaId',
    });
  }

  const problems = validateTourNode(
    { id: 0, propertyId, propertyMediaId: mediaId, isStart: false },
    media,
  );

  if (problems.includes('media_belongs_to_other_property')) {
    return fail({
      code: 'tour_media_property_mismatch',
      message: 'El panorama pertenece a otra propiedad.',
      field: 'propertyMediaId',
    });
  }

  if (problems.includes('media_is_not_panorama')) {
    return fail({
      code: 'tour_media_not_panorama',
      message: 'Solo un panorama 360° puede ser un nodo del recorrido.',
      field: 'propertyMediaId',
    });
  }

  return null;
}

/** Escribe los nombres que vengan, normalizando el vacio a `null`. */
async function writeNodeNames(
  db: AdminDatabase,
  nodeId: number,
  input: TourNodeNames,
): Promise<void> {
  const byLocale: [Locale, string | null][] = [];
  if (input.nameEs !== undefined) byLocale.push(['es', normalizeText(input.nameEs)]);
  if (input.nameEn !== undefined) byLocale.push(['en', normalizeText(input.nameEn)]);

  for (const [locale, name] of byLocale) {
    const existing = await db
      .select({ id: propertyTourNodeTranslations.id })
      .from(propertyTourNodeTranslations)
      .where(
        and(
          eq(propertyTourNodeTranslations.propertyTourNodeId, nodeId),
          eq(propertyTourNodeTranslations.locale, locale),
        ),
      )
      .limit(1);

    const row = existing[0];

    if (row === undefined) {
      await db
        .insert(propertyTourNodeTranslations)
        .values({ propertyTourNodeId: nodeId, locale, name });
    } else {
      // `updatedAt` explicito, igual que en el resto de la capa.
      await db
        .update(propertyTourNodeTranslations)
        .set({ name, updatedAt: new Date() })
        .where(eq(propertyTourNodeTranslations.id, row.id));
    }
  }
}

/** Solo se escriben los campos de camara que vengan en la peticion. */
function cameraPatch(input: TourNodeCamera): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (input.initialYaw !== undefined) patch.initialYaw = input.initialYaw;
  if (input.initialPitch !== undefined) patch.initialPitch = input.initialPitch;
  if (input.initialFov !== undefined) patch.initialFov = input.initialFov;

  return patch;
}

export async function createTourNode(
  db: AdminDatabase,
  propertyId: number,
  input: CreateTourNodeInput,
): Promise<AdminResult<TourNodeRecord>> {
  const owner = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  if (owner.length === 0) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const invalid = await checkPanorama<TourNodeRecord>(db, propertyId, input.propertyMediaId);
  if (invalid !== null) return invalid;

  let sortOrder = input.sortOrder;

  if (sortOrder === undefined) {
    const siblings = await db
      .select({ sortOrder: propertyTourNodes.sortOrder })
      .from(propertyTourNodes)
      .where(eq(propertyTourNodes.propertyId, propertyId));

    sortOrder = nextSortOrder(siblings.map((row) => row.sortOrder));
  }

  /*
   * El nodo NO nace como inicial: marcarlo exige retirar el anterior en el
   * mismo lote, y para eso la fila tiene que existir. Se pide con
   * `setStartNode`.
   */
  let inserted: (typeof propertyTourNodes.$inferSelect)[];

  try {
    inserted = await db
      .insert(propertyTourNodes)
      .values({
        propertyId,
        propertyMediaId: input.propertyMediaId,
        sortOrder,
        ...cameraPatch(input),
      })
      .returning();
  } catch (error) {
    // Un panorama sostiene un unico nodo.
    if (isUniqueViolation(error, 'property_media_id')) {
      return fail({
        code: 'tour_media_in_use',
        message: 'Ese panorama ya es un nodo del recorrido.',
        field: 'propertyMediaId',
      });
    }
    throw error;
  }

  const node = inserted[0];
  if (node === undefined) {
    return fail({ code: 'validation_failed', message: 'No se pudo crear el nodo.' });
  }

  await writeNodeNames(db, node.id, input);

  return ok(toRecord(node));
}

export async function updateTourNode(
  db: AdminDatabase,
  propertyId: number,
  nodeId: number,
  input: UpdateTourNodeInput,
): Promise<AdminResult<TourNodeRecord>> {
  const found = await loadTourNode(db, propertyId, nodeId);
  if (!found.ok) return found;

  const patch = cameraPatch(input);
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  if (Object.keys(patch).length > 0) {
    await db
      .update(propertyTourNodes)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(propertyTourNodes.id, nodeId));
  }

  await writeNodeNames(db, nodeId, input);

  const refreshed = await loadTourNode(db, propertyId, nodeId);
  if (!refreshed.ok) return refreshed;

  return ok(toRecord(refreshed.data));
}

/**
 * Marca (o desmarca) el nodo inicial.
 *
 * Retira el rol a quien lo tuviera y se lo da al nuevo en el MISMO lote, que
 * D1 envuelve en una transaccion. En orden inverso chocaria con el indice
 * parcial, que solo admite un inicial por propiedad.
 */
export async function setStartNode(
  db: AdminBatchDatabase,
  propertyId: number,
  nodeId: number,
  isStart: boolean,
): Promise<AdminResult<TourNodeRecord>> {
  const found = await loadTourNode(db, propertyId, nodeId);
  if (!found.ok) return found;

  const now = new Date();

  const markThis = db
    .update(propertyTourNodes)
    .set({ isStart, updatedAt: now })
    .where(and(eq(propertyTourNodes.id, nodeId), eq(propertyTourNodes.propertyId, propertyId)));

  if (isStart) {
    await db.batch([
      db
        .update(propertyTourNodes)
        .set({ isStart: false, updatedAt: now })
        .where(
          and(
            eq(propertyTourNodes.propertyId, propertyId),
            eq(propertyTourNodes.isStart, true),
            ne(propertyTourNodes.id, nodeId),
          ),
        ),
      markThis,
    ]);
  } else {
    await db.batch([markThis]);
  }

  const refreshed = await loadTourNode(db, propertyId, nodeId);
  if (!refreshed.ok) return refreshed;

  return ok(toRecord(refreshed.data));
}

/**
 * Borra el nodo.
 *
 * Sus traducciones y sus enlaces —entrantes y salientes— caen por CASCADE. El
 * panorama NO se toca: sigue siendo un archivo de la propiedad, ahora libre
 * para sostener otro nodo.
 */
export async function deleteTourNode(
  db: AdminDatabase,
  propertyId: number,
  nodeId: number,
): Promise<AdminResult<{ id: number }>> {
  const found = await loadTourNode(db, propertyId, nodeId);
  if (!found.ok) return found;

  await db
    .delete(propertyTourNodes)
    .where(and(eq(propertyTourNodes.id, nodeId), eq(propertyTourNodes.propertyId, propertyId)));

  return ok({ id: nodeId });
}
