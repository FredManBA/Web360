/**
 * Reordenacion de grupos y caracteristicas.
 *
 * Va aparte del CRUD porque tiene una exigencia que el resto no tiene: o se
 * aplica el orden entero o no se aplica nada. Un intercambio a medias dejaria
 * dos elementos en la misma posicion, y el cliente no podria repararlo.
 *
 * Por eso las escrituras salen en un solo `batch()`: D1 no ofrece
 * transacciones interactivas, pero envuelve cada lote en una transaccion
 * implicita. No se hacen varios PATCH sueltos desde el cliente.
 *
 * La lista recibida debe describir EXACTAMENTE el ambito actual. Si falta una
 * entidad, sobra otra o alguna dejo de estar donde se creia, no se escribe
 * nada y se devuelve `feature_order_conflict`: es preferible que la UI recargue
 * a persistir un orden calculado sobre datos viejos.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';

import { properties, propertyFeatureGroups, propertyFeatures } from '../../../db/schema';
import { fail, ok, type AdminBatchDatabase, type AdminBatchItem, type AdminResult } from '../types';
import { loadGroup } from './feature-groups';

export interface GroupOrderResult {
  groupIds: number[];
}

export interface FeatureOrderResult {
  groupId: number | null;
  featureIds: number[];
}

/** Ids repetidos: el cliente ha construido mal la lista. */
function hasDuplicates(ids: readonly number[]): boolean {
  return new Set(ids).size !== ids.length;
}

function orderConflict<T>(message: string): AdminResult<T> {
  return fail({ code: 'feature_order_conflict', message, field: 'order' });
}

/**
 * Comprueba que la lista describa el ambito completo, sin sobras ni ausencias.
 *
 * Se compara como conjunto: el orden es justamente lo que se quiere cambiar.
 */
function sameEntities(current: readonly number[], received: readonly number[]): boolean {
  if (current.length !== received.length) return false;

  const known = new Set(current);
  return received.every((id) => known.has(id));
}

async function propertyExists(db: AdminBatchDatabase, propertyId: number): Promise<boolean> {
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows.length > 0;
}

/**
 * Aplica el lote, si lo hay.
 *
 * `batch` exige al menos una sentencia, y un ambito vacio es legitimo (una
 * propiedad sin grupos), asi que ese caso se resuelve sin escribir.
 */
async function applyBatch(db: AdminBatchDatabase, statements: AdminBatchItem[]): Promise<void> {
  const [first, ...rest] = statements;
  if (first === undefined) return;

  await db.batch([first, ...rest]);
}

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

export async function reorderFeatureGroups(
  db: AdminBatchDatabase,
  propertyId: number,
  groupIds: readonly number[],
): Promise<AdminResult<GroupOrderResult>> {
  if (hasDuplicates(groupIds)) {
    return fail({
      code: 'validation_failed',
      message: 'La lista de grupos tiene identificadores repetidos.',
      field: 'groupIds',
    });
  }

  if (!(await propertyExists(db, propertyId))) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const current = await db
    .select({ id: propertyFeatureGroups.id })
    .from(propertyFeatureGroups)
    .where(eq(propertyFeatureGroups.propertyId, propertyId))
    .orderBy(asc(propertyFeatureGroups.sortOrder), asc(propertyFeatureGroups.id));

  const currentIds = current.map((row) => row.id);

  if (!sameEntities(currentIds, groupIds)) {
    return orderConflict('La lista de grupos no coincide con los grupos actuales de la propiedad.');
  }

  const now = new Date();

  /*
   * `propertyId` viaja tambien en el WHERE. Ya esta comprobado arriba, pero
   * asi ninguna sentencia del lote puede tocar filas de otra propiedad ni
   * siquiera si el estado cambiara entre la lectura y la escritura.
   */
  const statements = groupIds.map((id, index) =>
    db
      .update(propertyFeatureGroups)
      .set({ sortOrder: index, updatedAt: now })
      .where(
        and(eq(propertyFeatureGroups.id, id), eq(propertyFeatureGroups.propertyId, propertyId)),
      ),
  );

  await applyBatch(db, statements);

  return ok({ groupIds: [...groupIds] });
}

/* -------------------------------------------------------------------------- */
/* Caracteristicas                                                            */
/* -------------------------------------------------------------------------- */

/** Filtro del ambito: un grupo concreto, o las que no tienen grupo. */
function featureScope(propertyId: number, groupId: number | null) {
  return groupId === null
    ? and(
        eq(propertyFeatures.propertyId, propertyId),
        isNull(propertyFeatures.propertyFeatureGroupId),
      )
    : and(
        eq(propertyFeatures.propertyId, propertyId),
        eq(propertyFeatures.propertyFeatureGroupId, groupId),
      );
}

export async function reorderFeatures(
  db: AdminBatchDatabase,
  propertyId: number,
  groupId: number | null,
  featureIds: readonly number[],
): Promise<AdminResult<FeatureOrderResult>> {
  if (hasDuplicates(featureIds)) {
    return fail({
      code: 'validation_failed',
      message: 'La lista de características tiene identificadores repetidos.',
      field: 'featureIds',
    });
  }

  if (!(await propertyExists(db, propertyId))) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  // Un grupo concreto debe existir y ser de esta propiedad. `null` siempre vale.
  if (groupId !== null) {
    const group = await loadGroup(db, propertyId, groupId);
    if (!group.ok) return group;
  }

  const current = await db
    .select({ id: propertyFeatures.id })
    .from(propertyFeatures)
    .where(featureScope(propertyId, groupId))
    .orderBy(asc(propertyFeatures.sortOrder), asc(propertyFeatures.id));

  const currentIds = current.map((row) => row.id);

  /*
   * Aqui se cubren de una vez los tres casos: falta una, sobra una de otro
   * grupo y sobra una de otra propiedad. Ninguna llega al ambito consultado,
   * asi que la comparacion falla igualmente.
   */
  if (!sameEntities(currentIds, featureIds)) {
    return orderConflict(
      'La lista de características no coincide con las que hay ahora en ese grupo.',
    );
  }

  const now = new Date();

  // El ambito viaja tambien en cada WHERE, por el mismo motivo que en grupos.
  const statements = featureIds.map((id, index) =>
    db
      .update(propertyFeatures)
      .set({ sortOrder: index, updatedAt: now })
      .where(and(eq(propertyFeatures.id, id), featureScope(propertyId, groupId))),
  );

  await applyBatch(db, statements);

  return ok({ groupId, featureIds: [...featureIds] });
}
