/**
 * Tests de la reordenacion.
 *
 * Contra SQLite real, con las migraciones del proyecto: si el SQL generado no
 * fuera valido, o si el lote no fuera transaccional, estos tests fallarian.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { propertyFeatureGroups, propertyFeatures } from '../../../db/schema';
import { createPropertyDraft } from '../properties/create-property';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import { createFeatureGroup } from './feature-groups';
import { createFeature } from './features';
import { getPropertyFeatures } from './get-features';
import { reorderFeatureGroups, reorderFeatures } from './reorder';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

async function newProperty(): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');
  return created.data.id;
}

async function newGroup(propertyId: number, nameEs: string): Promise<number> {
  const created = await createFeatureGroup(db, propertyId, { nameEs });
  if (!created.ok) throw new Error('setup: grupo');
  return created.data.id;
}

async function newFeature(propertyId: number, groupId: number | null): Promise<number> {
  const created = await createFeature(db, propertyId, { groupId });
  if (!created.ok) throw new Error('setup: caracteristica');
  return created.data.id;
}

/** Orden real en la base, leido como lo lee la aplicacion. */
async function storedGroupOrder(propertyId: number): Promise<number[]> {
  const view = await getPropertyFeatures(db, propertyId);
  if (!view.ok) throw new Error('lectura');
  return view.data.groups.map((group) => group.id);
}

async function storedFeatureOrder(propertyId: number, groupId: number | null): Promise<number[]> {
  const view = await getPropertyFeatures(db, propertyId);
  if (!view.ok) throw new Error('lectura');

  const scope =
    groupId === null
      ? view.data.ungrouped
      : (view.data.groups.find((group) => group.id === groupId)?.features ?? []);

  return scope.map((feature) => feature.id);
}

function errorOf(result: { ok: boolean } & Record<string, unknown>): {
  code: string;
  message: string;
} {
  const error = (result as { error?: { code: string; message: string } }).error;
  if (error === undefined) throw new Error('se esperaba un error');
  return error;
}

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

describe('reordenar grupos', () => {
  it('(24) aplica el orden recibido y renumera desde cero', async () => {
    const propertyId = await newProperty();
    const a = await newGroup(propertyId, 'A');
    const b = await newGroup(propertyId, 'B');
    const c = await newGroup(propertyId, 'C');

    const result = await reorderFeatureGroups(db, propertyId, [c, a, b]);

    expect(result.ok).toBe(true);
    expect(await storedGroupOrder(propertyId)).toEqual([c, a, b]);

    const rows = await db
      .select({ id: propertyFeatureGroups.id, sortOrder: propertyFeatureGroups.sortOrder })
      .from(propertyFeatureGroups);

    const byId = new Map(rows.map((row) => [row.id, row.sortOrder]));
    expect(byId.get(c)).toBe(0);
    expect(byId.get(a)).toBe(1);
    expect(byId.get(b)).toBe(2);
  });

  it('(33) el orden sigue ahi al volver a leer', async () => {
    const propertyId = await newProperty();
    const a = await newGroup(propertyId, 'A');
    const b = await newGroup(propertyId, 'B');

    await reorderFeatureGroups(db, propertyId, [b, a]);

    // Segunda lectura independiente: no hay estado en memoria que lo sostenga.
    expect(await storedGroupOrder(propertyId)).toEqual([b, a]);
  });

  it('(27) rechaza identificadores repetidos', async () => {
    const propertyId = await newProperty();
    const a = await newGroup(propertyId, 'A');
    await newGroup(propertyId, 'B');

    const result = await reorderFeatureGroups(db, propertyId, [a, a]);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('validation_failed');
  });

  it('(28) rechaza un grupo de otra propiedad', async () => {
    const first = await newProperty();
    const second = await newProperty();

    const mine = await newGroup(first, 'A');
    const other = await newGroup(second, 'Ajeno');

    const result = await reorderFeatureGroups(db, first, [mine, other]);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('feature_order_conflict');
    expect(await storedGroupOrder(first)).toEqual([mine]);
  });

  it('(30) rechaza una lista incompleta', async () => {
    const propertyId = await newProperty();
    const a = await newGroup(propertyId, 'A');
    const b = await newGroup(propertyId, 'B');

    const result = await reorderFeatureGroups(db, propertyId, [b]);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('feature_order_conflict');
    expect(await storedGroupOrder(propertyId)).toEqual([a, b]);
  });

  it('la propiedad debe existir', async () => {
    const result = await reorderFeatureGroups(db, 9999, []);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('not_found');
  });

  it('un ambito vacio se acepta sin escribir nada', async () => {
    const propertyId = await newProperty();
    const batch = vi.spyOn(db, 'batch');

    const result = await reorderFeatureGroups(db, propertyId, []);

    expect(result.ok).toBe(true);
    expect(batch).not.toHaveBeenCalled();
    batch.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */
/* Caracteristicas                                                            */
/* -------------------------------------------------------------------------- */

describe('reordenar caracteristicas', () => {
  it('(25) aplica el orden dentro de su grupo', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    const one = await newFeature(propertyId, groupId);
    const two = await newFeature(propertyId, groupId);
    const three = await newFeature(propertyId, groupId);

    const result = await reorderFeatures(db, propertyId, groupId, [three, one, two]);

    expect(result.ok).toBe(true);
    expect(await storedFeatureOrder(propertyId, groupId)).toEqual([three, one, two]);
  });

  it('(26) tambien ordena las que no tienen grupo', async () => {
    const propertyId = await newProperty();
    const one = await newFeature(propertyId, null);
    const two = await newFeature(propertyId, null);

    const result = await reorderFeatures(db, propertyId, null, [two, one]);

    expect(result.ok).toBe(true);
    expect(await storedFeatureOrder(propertyId, null)).toEqual([two, one]);
  });

  it('(26) ordenar "Sin grupo" no toca las agrupadas', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    const grouped = await newFeature(propertyId, groupId);
    const alsoGrouped = await newFeature(propertyId, groupId);
    const loose = await newFeature(propertyId, null);
    const alsoLoose = await newFeature(propertyId, null);

    await reorderFeatures(db, propertyId, null, [alsoLoose, loose]);

    expect(await storedFeatureOrder(propertyId, null)).toEqual([alsoLoose, loose]);
    expect(await storedFeatureOrder(propertyId, groupId)).toEqual([grouped, alsoGrouped]);
  });

  it('(29) rechaza una caracteristica de otro grupo', async () => {
    const propertyId = await newProperty();
    const first = await newGroup(propertyId, 'A');
    const second = await newGroup(propertyId, 'B');

    const mine = await newFeature(propertyId, first);
    const other = await newFeature(propertyId, second);

    const result = await reorderFeatures(db, propertyId, first, [mine, other]);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('feature_order_conflict');
    expect(await storedFeatureOrder(propertyId, first)).toEqual([mine]);
  });

  it('(28) rechaza una caracteristica de otra propiedad', async () => {
    const first = await newProperty();
    const second = await newProperty();

    const mine = await newFeature(first, null);
    const other = await newFeature(second, null);

    const result = await reorderFeatures(db, first, null, [mine, other]);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('feature_order_conflict');
  });

  it('(27) rechaza identificadores repetidos', async () => {
    const propertyId = await newProperty();
    const one = await newFeature(propertyId, null);
    await newFeature(propertyId, null);

    const result = await reorderFeatures(db, propertyId, null, [one, one]);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('validation_failed');
  });

  it('(30) rechaza una lista incompleta', async () => {
    const propertyId = await newProperty();
    const one = await newFeature(propertyId, null);
    const two = await newFeature(propertyId, null);

    const result = await reorderFeatures(db, propertyId, null, [two]);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('feature_order_conflict');
    expect(await storedFeatureOrder(propertyId, null)).toEqual([one, two]);
  });

  it('el grupo indicado debe existir', async () => {
    const propertyId = await newProperty();

    const result = await reorderFeatures(db, propertyId, 9999, []);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('feature_group_not_found');
  });

  it('el grupo indicado debe ser de esta propiedad', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const other = await newGroup(second, 'Ajeno');

    const result = await reorderFeatures(db, first, other, []);

    expect(result.ok).toBe(false);
    expect(errorOf(result).code).toBe('feature_group_property_mismatch');
  });

  it('(33) el orden sobrevive a una lectura posterior', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');
    const one = await newFeature(propertyId, groupId);
    const two = await newFeature(propertyId, groupId);

    await reorderFeatures(db, propertyId, groupId, [two, one]);

    expect(await storedFeatureOrder(propertyId, groupId)).toEqual([two, one]);
  });
});

/* -------------------------------------------------------------------------- */
/* Atomicidad                                                                 */
/* -------------------------------------------------------------------------- */

describe('atomicidad', () => {
  it('(31) todo el orden viaja en un solo lote, no en varios UPDATE sueltos', async () => {
    const propertyId = await newProperty();
    const a = await newGroup(propertyId, 'A');
    const b = await newGroup(propertyId, 'B');
    const c = await newGroup(propertyId, 'C');

    const batch = vi.spyOn(db, 'batch');

    await reorderFeatureGroups(db, propertyId, [c, b, a]);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(3);

    batch.mockRestore();
  });

  it('(31) las caracteristicas tambien se reordenan en un solo lote', async () => {
    const propertyId = await newProperty();
    const one = await newFeature(propertyId, null);
    const two = await newFeature(propertyId, null);

    const batch = vi.spyOn(db, 'batch');

    await reorderFeatures(db, propertyId, null, [two, one]);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);

    batch.mockRestore();
  });

  it('(31)(32) si una sentencia del lote falla, no se aplica ninguna', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');
    const one = await newFeature(propertyId, groupId);
    const two = await newFeature(propertyId, groupId);

    const before = await storedFeatureOrder(propertyId, groupId);

    /*
     * Primera sentencia valida y segunda imposible: el grupo 999999 no existe
     * y la clave foranea la rechaza. Si el lote no fuese transaccional, la
     * primera quedaria escrita.
     */
    await expect(
      db.batch([
        db.update(propertyFeatures).set({ sortOrder: 99 }).where(eq(propertyFeatures.id, one)),
        db
          .update(propertyFeatures)
          .set({ propertyFeatureGroupId: 999999 })
          .where(eq(propertyFeatures.id, two)),
      ]),
    ).rejects.toThrow();

    const rows = await db
      .select({ id: propertyFeatures.id, sortOrder: propertyFeatures.sortOrder })
      .from(propertyFeatures);

    expect(rows.find((row) => row.id === one)?.sortOrder).not.toBe(99);
    expect(await storedFeatureOrder(propertyId, groupId)).toEqual(before);
  });

  it('(32) un fallo del lote deja el orden anterior intacto', async () => {
    const propertyId = await newProperty();
    const a = await newGroup(propertyId, 'A');
    const b = await newGroup(propertyId, 'B');

    const batch = vi.spyOn(db, 'batch').mockRejectedValue(new Error('D1_ERROR: batch failed'));

    await expect(reorderFeatureGroups(db, propertyId, [b, a])).rejects.toThrow();

    batch.mockRestore();

    expect(await storedGroupOrder(propertyId)).toEqual([a, b]);
  });
});

/* -------------------------------------------------------------------------- */
/* Mensajes                                                                   */
/* -------------------------------------------------------------------------- */

describe('mensajes de error', () => {
  it('(36) no mencionan SQL, tablas ni stack traces', async () => {
    const propertyId = await newProperty();
    await newGroup(propertyId, 'A');

    const conflict = await reorderFeatureGroups(db, propertyId, []);
    const duplicated = await reorderFeatures(db, propertyId, null, [1, 1]);

    for (const result of [conflict, duplicated]) {
      const { message } = errorOf(result);
      expect(message).not.toMatch(/SQL|SQLITE|property_feature|UPDATE|node:sqlite/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});
