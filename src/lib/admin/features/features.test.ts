/**
 * Tests de la capa de aplicacion de caracteristicas.
 *
 * Contra SQLite real con las migraciones y el seed del proyecto, igual que en
 * las fases anteriores: sin mockear el acceso a datos.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { applySeed, createTestDatabase } from '../test-database';
import type { AdminDatabase } from '../types';
import { createPropertyDraft } from '../properties/create-property';
import { createFeatureGroup, deleteFeatureGroup, updateFeatureGroup } from './feature-groups';
import { createFeature, deleteFeature, updateFeature } from './features';
import { getPropertyFeatures } from './get-features';
import { nextSortOrder, normalizeText } from '../shared';

let db: AdminDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

async function newProperty(): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('no se pudo crear la propiedad');
  return created.data.id;
}

async function newGroup(propertyId: number, nameEs?: string): Promise<number> {
  const created = await createFeatureGroup(db, propertyId, nameEs === undefined ? {} : { nameEs });
  if (!created.ok) throw new Error('no se pudo crear el grupo');
  return created.data.id;
}

async function view(propertyId: number) {
  const result = await getPropertyFeatures(db, propertyId);
  if (!result.ok) throw new Error('no se pudo leer');
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Lectura                                                                    */
/* -------------------------------------------------------------------------- */

describe('getPropertyFeatures', () => {
  it('(1) propiedad inexistente devuelve not_found', async () => {
    const result = await getPropertyFeatures(db, 99_999);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });

  it('(2) una propiedad sin caracteristicas devuelve listas vacias', async () => {
    const data = await view(await newProperty());

    expect(data.groups).toEqual([]);
    expect(data.ungrouped).toEqual([]);
  });

  it('(23) incluye las caracteristicas sin grupo', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    await createFeature(db, propertyId, { groupId, labelEs: 'Vista al mar' });
    await createFeature(db, propertyId, { labelEs: 'Sin agrupar' });

    const data = await view(propertyId);

    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]?.features).toHaveLength(1);
    expect(data.ungrouped).toHaveLength(1);
    expect(data.ungrouped[0]?.translations.es?.label).toBe('Sin agrupar');
  });

  it('(22) el orden es sortOrder y luego id, no el natural de SQLite', async () => {
    const propertyId = await newProperty();

    // Se crean a proposito con posiciones desordenadas y empatadas.
    const c = await createFeature(db, propertyId, { sortOrder: 5, labelEs: 'C' });
    const a = await createFeature(db, propertyId, { sortOrder: 1, labelEs: 'A' });
    const b = await createFeature(db, propertyId, { sortOrder: 1, labelEs: 'B' });

    if (!a.ok || !b.ok || !c.ok) throw new Error('setup');

    const data = await view(propertyId);
    const labels = data.ungrouped.map((feature) => feature.translations.es?.label);

    // sortOrder 1 (A antes que B por id) y despues sortOrder 5.
    expect(labels).toEqual(['A', 'B', 'C']);
  });

  it('los grupos tambien se ordenan por sortOrder y luego id', async () => {
    const propertyId = await newProperty();

    await createFeatureGroup(db, propertyId, { nameEs: 'Segundo', sortOrder: 2 });
    await createFeatureGroup(db, propertyId, { nameEs: 'Primero', sortOrder: 1 });

    const data = await view(propertyId);
    expect(data.groups.map((group) => group.names.es)).toEqual(['Primero', 'Segundo']);
  });

  it('no mezcla caracteristicas de otras propiedades', async () => {
    const first = await newProperty();
    const second = await newProperty();

    await createFeature(db, first, { labelEs: 'De la primera' });
    await createFeature(db, second, { labelEs: 'De la segunda' });

    expect((await view(first)).ungrouped).toHaveLength(1);
    expect((await view(second)).ungrouped[0]?.translations.es?.label).toBe('De la segunda');
  });
});

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

describe('grupos de caracteristicas', () => {
  it('(3) se crea sin traducciones', async () => {
    const propertyId = await newProperty();
    const created = await createFeatureGroup(db, propertyId);

    expect(created.ok).toBe(true);

    const data = await view(propertyId);
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]?.names).toEqual({});
  });

  it('(4) se crea con nombre en espanol', async () => {
    const propertyId = await newProperty();
    await createFeatureGroup(db, propertyId, { nameEs: 'Terreno' });

    expect((await view(propertyId)).groups[0]?.names.es).toBe('Terreno');
  });

  it('(5) se crea con ambos idiomas', async () => {
    const propertyId = await newProperty();
    await createFeatureGroup(db, propertyId, { nameEs: 'Servicios', nameEn: 'Utilities' });

    const names = (await view(propertyId)).groups[0]?.names;
    expect(names?.es).toBe('Servicios');
    expect(names?.en).toBe('Utilities');
  });

  it('un nombre en blanco se guarda como null', async () => {
    const propertyId = await newProperty();
    await createFeatureGroup(db, propertyId, { nameEs: '   ' });

    expect((await view(propertyId)).groups[0]?.names.es).toBeNull();
  });

  it('(6) el orden por defecto coloca al final', async () => {
    const propertyId = await newProperty();

    const first = await createFeatureGroup(db, propertyId, { nameEs: 'Uno' });
    const second = await createFeatureGroup(db, propertyId, { nameEs: 'Dos' });
    const third = await createFeatureGroup(db, propertyId, { nameEs: 'Tres' });

    if (!first.ok || !second.ok || !third.ok) throw new Error('setup');

    expect([first.data.sortOrder, second.data.sortOrder, third.data.sortOrder]).toEqual([0, 1, 2]);
  });

  it('el orden por defecto no reutiliza el hueco de un grupo borrado', async () => {
    const propertyId = await newProperty();
    await createFeatureGroup(db, propertyId);
    const second = await createFeatureGroup(db, propertyId);
    if (!second.ok) throw new Error('setup');

    await deleteFeatureGroup(db, propertyId, second.data.id);

    const third = await createFeatureGroup(db, propertyId);
    // Deriva del maximo restante (0), no de COUNT.
    if (third.ok) expect(third.data.sortOrder).toBe(1);
  });

  it('(7) se actualiza el nombre espanol', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    await updateFeatureGroup(db, propertyId, groupId, { nameEs: 'Terreno y accesos' });

    expect((await view(propertyId)).groups[0]?.names.es).toBe('Terreno y accesos');
  });

  it('(8) se anade el ingles sin tocar el espanol', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    await updateFeatureGroup(db, propertyId, groupId, { nameEn: 'Land' });

    const names = (await view(propertyId)).groups[0]?.names;
    expect(names?.es).toBe('Terreno');
    expect(names?.en).toBe('Land');
  });

  it('se puede cambiar el orden', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    const updated = await updateFeatureGroup(db, propertyId, groupId, { sortOrder: 7 });
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.data.sortOrder).toBe(7);
  });

  it('un grupo de otra propiedad se rechaza', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const groupId = await newGroup(first, 'Terreno');

    const updated = await updateFeatureGroup(db, second, groupId, { nameEs: 'Robado' });

    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error.code).toBe('feature_group_property_mismatch');
  });

  it('un grupo inexistente devuelve feature_group_not_found', async () => {
    const propertyId = await newProperty();
    const updated = await updateFeatureGroup(db, propertyId, 99_999, { nameEs: 'X' });

    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error.code).toBe('feature_group_not_found');
  });

  it('crear en una propiedad inexistente se rechaza', async () => {
    const created = await createFeatureGroup(db, 99_999, { nameEs: 'X' });

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe('not_found');
  });

  it('(9) se elimina el grupo y sus traducciones', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    const deleted = await deleteFeatureGroup(db, propertyId, groupId);
    expect(deleted.ok).toBe(true);

    expect((await view(propertyId)).groups).toHaveLength(0);

    const rows = sqlite
      .prepare(
        'SELECT COUNT(*) AS n FROM property_feature_group_translations WHERE property_feature_group_id = ?',
      )
      .get(groupId) as { n: number };
    expect(rows.n).toBe(0);
  });

  it('(10) al borrar el grupo, sus caracteristicas sobreviven sin grupo', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    await createFeature(db, propertyId, { groupId, labelEs: 'Vista al mar' });
    await createFeature(db, propertyId, { groupId, labelEs: 'Electricidad' });

    await deleteFeatureGroup(db, propertyId, groupId);

    const data = await view(propertyId);
    expect(data.groups).toHaveLength(0);
    expect(data.ungrouped).toHaveLength(2);
    for (const feature of data.ungrouped) expect(feature.groupId).toBeNull();

    // Las traducciones de las caracteristicas siguen intactas.
    expect(data.ungrouped[0]?.translations.es?.label).toBe('Vista al mar');
  });
});

/* -------------------------------------------------------------------------- */
/* Caracteristicas                                                            */
/* -------------------------------------------------------------------------- */

describe('caracteristicas', () => {
  it('(11) se crea sin grupo', async () => {
    const propertyId = await newProperty();
    const created = await createFeature(db, propertyId, { labelEs: 'Vista al mar' });

    expect(created.ok).toBe(true);
    if (created.ok) expect(created.data.groupId).toBeNull();
  });

  it('(12) se crea dentro de un grupo', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    const created = await createFeature(db, propertyId, { groupId, labelEs: 'Frente de calle' });

    expect(created.ok).toBe(true);
    if (created.ok) expect(created.data.groupId).toBe(groupId);
  });

  it('(13) un grupo de otra propiedad se rechaza al crear', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const foreignGroup = await newGroup(first, 'Terreno');

    const created = await createFeature(db, second, { groupId: foreignGroup });

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe('feature_group_property_mismatch');

    // Y no se creo nada.
    expect((await view(second)).ungrouped).toHaveLength(0);
  });

  it('(14) guarda label y value en espanol', async () => {
    const propertyId = await newProperty();
    await createFeature(db, propertyId, { labelEs: 'Frente de calle', valueEs: '80 m' });

    const es = (await view(propertyId)).ungrouped[0]?.translations.es;
    expect(es?.label).toBe('Frente de calle');
    expect(es?.value).toBe('80 m');
  });

  it('(15) guarda ambos idiomas', async () => {
    const propertyId = await newProperty();
    await createFeature(db, propertyId, {
      labelEs: 'Frente de calle',
      valueEs: '80 m',
      labelEn: 'Road frontage',
      valueEn: '80 m',
    });

    const translations = (await view(propertyId)).ungrouped[0]?.translations;
    expect(translations?.es?.label).toBe('Frente de calle');
    expect(translations?.en?.label).toBe('Road frontage');
  });

  it('el ingles no es obligatorio', async () => {
    const propertyId = await newProperty();
    await createFeature(db, propertyId, { labelEs: 'Vista al mar' });

    const translations = (await view(propertyId)).ungrouped[0]?.translations;
    expect(translations?.es).toBeDefined();
    expect(translations?.en).toBeUndefined();
  });

  it('una caracteristica puede crearse sin ningun texto', async () => {
    const propertyId = await newProperty();
    const created = await createFeature(db, propertyId);

    expect(created.ok).toBe(true);
    expect((await view(propertyId)).ungrouped[0]?.translations).toEqual({});
  });

  it('el orden por defecto es por grupo', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    const inGroup1 = await createFeature(db, propertyId, { groupId });
    const inGroup2 = await createFeature(db, propertyId, { groupId });
    const loose1 = await createFeature(db, propertyId);

    if (!inGroup1.ok || !inGroup2.ok || !loose1.ok) throw new Error('setup');

    expect(inGroup1.data.sortOrder).toBe(0);
    expect(inGroup2.data.sortOrder).toBe(1);
    // El conjunto sin grupo lleva su propia numeracion.
    expect(loose1.data.sortOrder).toBe(0);
  });

  it('(16) se actualizan label y value', async () => {
    const propertyId = await newProperty();
    const created = await createFeature(db, propertyId, { labelEs: 'Frente', valueEs: '70 m' });
    if (!created.ok) throw new Error('setup');

    await updateFeature(db, propertyId, created.data.id, { valueEs: '80 m' });

    const es = (await view(propertyId)).ungrouped[0]?.translations.es;
    expect(es?.label).toBe('Frente');
    expect(es?.value).toBe('80 m');
  });

  it('un texto en blanco se limpia a null', async () => {
    const propertyId = await newProperty();
    const created = await createFeature(db, propertyId, { labelEs: 'Frente', valueEs: '70 m' });
    if (!created.ok) throw new Error('setup');

    await updateFeature(db, propertyId, created.data.id, { valueEs: '  ' });

    expect((await view(propertyId)).ungrouped[0]?.translations.es?.value).toBeNull();
  });

  it('(17) se mueve a otro grupo de la misma propiedad', async () => {
    const propertyId = await newProperty();
    const first = await newGroup(propertyId, 'Terreno');
    const second = await newGroup(propertyId, 'Servicios');

    const created = await createFeature(db, propertyId, { groupId: first });
    if (!created.ok) throw new Error('setup');

    const moved = await updateFeature(db, propertyId, created.data.id, { groupId: second });

    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.data.groupId).toBe(second);
  });

  it('(18) mover a un grupo de otra propiedad se rechaza', async () => {
    const propertyId = await newProperty();
    const other = await newProperty();
    const foreignGroup = await newGroup(other, 'Ajeno');

    const created = await createFeature(db, propertyId);
    if (!created.ok) throw new Error('setup');

    const moved = await updateFeature(db, propertyId, created.data.id, { groupId: foreignGroup });

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.code).toBe('feature_group_property_mismatch');

    // Sigue donde estaba.
    expect((await view(propertyId)).ungrouped[0]?.groupId).toBeNull();
  });

  it('(19) se puede sacar del grupo pasando null', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    const created = await createFeature(db, propertyId, { groupId });
    if (!created.ok) throw new Error('setup');

    const moved = await updateFeature(db, propertyId, created.data.id, { groupId: null });

    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.data.groupId).toBeNull();
    expect((await view(propertyId)).ungrouped).toHaveLength(1);
  });

  it('una caracteristica de otra propiedad no se puede tocar', async () => {
    const first = await newProperty();
    const second = await newProperty();

    const created = await createFeature(db, first);
    if (!created.ok) throw new Error('setup');

    const updated = await updateFeature(db, second, created.data.id, { sortOrder: 3 });

    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error.code).toBe('feature_not_found');
  });

  it('(20)(21) al eliminar, sus traducciones caen por CASCADE', async () => {
    const propertyId = await newProperty();
    const created = await createFeature(db, propertyId, {
      labelEs: 'Vista al mar',
      labelEn: 'Sea view',
    });
    if (!created.ok) throw new Error('setup');

    const deleted = await deleteFeature(db, propertyId, created.data.id);
    expect(deleted.ok).toBe(true);

    expect((await view(propertyId)).ungrouped).toHaveLength(0);

    const rows = sqlite
      .prepare(
        'SELECT COUNT(*) AS n FROM property_feature_translations WHERE property_feature_id = ?',
      )
      .get(created.data.id) as { n: number };
    expect(rows.n).toBe(0);
  });

  it('eliminar una caracteristica inexistente devuelve feature_not_found', async () => {
    const propertyId = await newProperty();
    const deleted = await deleteFeature(db, propertyId, 99_999);

    expect(deleted.ok).toBe(false);
    if (!deleted.ok) expect(deleted.error.code).toBe('feature_not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Fechas                                                                     */
/* -------------------------------------------------------------------------- */

describe('updatedAt', () => {
  it('(24) avanza al modificar un grupo', async () => {
    const propertyId = await newProperty();
    const groupId = await newGroup(propertyId, 'Terreno');

    // Se retrasa la marca para que el cambio sea observable dentro del mismo
    // segundo (los timestamps se guardan en segundos).
    sqlite
      .prepare('UPDATE property_feature_groups SET updated_at = ? WHERE id = ?')
      .run(1_000_000, groupId);

    const before = (await view(propertyId)).groups[0]?.updatedAt.getTime() ?? 0;

    await updateFeatureGroup(db, propertyId, groupId, { sortOrder: 3 });

    const after = (await view(propertyId)).groups[0]?.updatedAt.getTime() ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  it('(24) avanza al modificar una caracteristica', async () => {
    const propertyId = await newProperty();
    const created = await createFeature(db, propertyId, { labelEs: 'Frente' });
    if (!created.ok) throw new Error('setup');

    sqlite
      .prepare('UPDATE property_features SET updated_at = ? WHERE id = ?')
      .run(1_000_000, created.data.id);

    const before = (await view(propertyId)).ungrouped[0]?.updatedAt.getTime() ?? 0;

    await updateFeature(db, propertyId, created.data.id, { sortOrder: 4 });

    const after = (await view(propertyId)).ungrouped[0]?.updatedAt.getTime() ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  it('(24) avanza al modificar una traduccion', async () => {
    const propertyId = await newProperty();
    const created = await createFeature(db, propertyId, { labelEs: 'Frente' });
    if (!created.ok) throw new Error('setup');

    sqlite
      .prepare(
        'UPDATE property_feature_translations SET updated_at = ? WHERE property_feature_id = ?',
      )
      .run(1_000_000, created.data.id);

    await updateFeature(db, propertyId, created.data.id, { labelEs: 'Frente de calle' });

    const row = sqlite
      .prepare(
        'SELECT updated_at AS t FROM property_feature_translations WHERE property_feature_id = ?',
      )
      .get(created.data.id) as { t: number };

    expect(row.t).toBeGreaterThan(1_000_000);
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

describe('helpers', () => {
  it('normalizeText limpia y anula lo vacio', () => {
    expect(normalizeText('  Terreno  ')).toBe('Terreno');
    expect(normalizeText('   ')).toBeNull();
    expect(normalizeText('')).toBeNull();
    expect(normalizeText(null)).toBeNull();
    expect(normalizeText(undefined)).toBeNull();
  });

  it('nextSortOrder deriva del maximo, no del recuento', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([0])).toBe(1);
    // Con un hueco, contar daria 2 y colisionaria con el 5.
    expect(nextSortOrder([0, 5])).toBe(6);
  });
});
