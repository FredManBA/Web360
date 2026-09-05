/**
 * Tests de integracion del CRUD administrativo.
 *
 * Corren contra SQLite real con las migraciones y el seed del proyecto
 * aplicados: nada de acceso a datos mockeado.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { applySeed, createTestDatabase } from '../test-database';
import type { AdminDatabase } from '../types';
import {
  createCustomPropertyType,
  listActivePropertyTypes,
} from '../property-types/property-types';
import { archiveProperty } from './archive-property';
import { createPropertyDraft } from './create-property';
import { getPropertyForEdit } from './get-property';
import { listProperties } from './list-properties';
import { updateProperty } from './update-property';
import { upsertPropertyTranslation } from './update-property-translation';
import { updatePropertyStatus } from './update-property-status';

let db: AdminDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

/** Id de un tipo del seed, para las pruebas que necesitan uno real. */
function seedTypeId(systemKey = 'lot'): number {
  const row = sqlite
    .prepare('SELECT id FROM property_types WHERE system_key = ?')
    .get(systemKey) as { id: number };
  return row.id;
}

async function createDraft(): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('no se pudo crear el borrador');
  return created.data.id;
}

/* -------------------------------------------------------------------------- */
/* Creacion y codigos                                                         */
/* -------------------------------------------------------------------------- */

describe('createPropertyDraft', () => {
  it('(1) el primer borrador recibe LOBA-001', async () => {
    const created = await createPropertyDraft(db);
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.data.code).toBe('LOBA-001');
  });

  it('(2) el segundo recibe LOBA-002', async () => {
    await createPropertyDraft(db);
    const second = await createPropertyDraft(db);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.code).toBe('LOBA-002');
  });

  it('nace como borrador disponible, con los defaults del esquema', async () => {
    const id = await createDraft();
    const found = await getPropertyForEdit(db, id);

    expect(found.ok).toBe(true);
    if (!found.ok) return;

    expect(found.data.property.publicationStatus).toBe('draft');
    expect(found.data.property.commercialStatus).toBe('available');
    expect(found.data.property.priceMode).toBe('contact');
    expect(found.data.property.locationPrecision).toBe('approximate');
    expect(found.data.property.isFeatured).toBe(false);
    expect(found.data.property.publishedAt).toBeNull();
  });

  it('no reutiliza el hueco de un codigo intermedio eliminado', async () => {
    await createPropertyDraft(db); // LOBA-001
    const second = await createPropertyDraft(db); // LOBA-002
    await createPropertyDraft(db); // LOBA-003
    if (!second.ok) throw new Error('setup');

    sqlite.prepare('DELETE FROM properties WHERE id = ?').run(second.data.id);

    const fourth = await createPropertyDraft(db);
    expect(fourth.ok).toBe(true);
    if (fourth.ok) expect(fourth.data.code).toBe('LOBA-004');
  });

  it('documenta el limite: borrar el codigo MAS ALTO si lo libera', async () => {
    /*
     * Derivar del maximo existente no puede saber que hubo un LOBA-002 si su
     * fila desaparecio. Evitarlo exigiria una secuencia persistida, es decir
     * una columna o tabla nueva, y esta fase no debe tocar el esquema.
     *
     * En la practica no ocurre: el producto no elimina propiedades, solo las
     * archiva, y una propiedad archivada conserva su fila y su codigo.
     */
    await createPropertyDraft(db); // LOBA-001
    const second = await createPropertyDraft(db); // LOBA-002
    if (!second.ok) throw new Error('setup');

    sqlite.prepare('DELETE FROM properties WHERE id = ?').run(second.data.id);

    const third = await createPropertyDraft(db);
    if (third.ok) expect(third.data.code).toBe('LOBA-002');
  });

  it('archivar NO libera el codigo', async () => {
    const first = await createPropertyDraft(db);
    if (!first.ok) throw new Error('setup');
    await archiveProperty(db, first.data.id);

    const second = await createPropertyDraft(db);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.code).toBe('LOBA-002');
  });

  it('admite tipo y titulo iniciales, y genera el slug', async () => {
    const created = await createPropertyDraft(db, {
      propertyTypeId: seedTypeId(),
      locale: 'es',
      title: 'Lote Vista al Mar',
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await getPropertyForEdit(db, created.data.id);
    if (!found.ok) throw new Error('no encontrada');

    expect(found.data.property.propertyTypeId).toBe(seedTypeId());
    expect(found.data.translations[0]?.title).toBe('Lote Vista al Mar');
    expect(found.data.translations[0]?.slug).toBe('lote-vista-al-mar');
  });

  it('(10) rechaza un tipo inexistente', async () => {
    const created = await createPropertyDraft(db, { propertyTypeId: 99_999 });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe('property_type_not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Codigo manual                                                              */
/* -------------------------------------------------------------------------- */

describe('codigo editado a mano', () => {
  it('(3) acepta un codigo manual unico', async () => {
    const id = await createDraft();
    const updated = await updateProperty(db, id, { code: 'FINCA-SUR' });

    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.data.code).toBe('FINCA-SUR');
  });

  it('(4) rechaza un codigo duplicado', async () => {
    const first = await createPropertyDraft(db);
    const second = await createPropertyDraft(db);
    if (!first.ok || !second.ok) throw new Error('setup');

    const updated = await updateProperty(db, second.data.id, { code: first.data.code });

    expect(updated.ok).toBe(false);
    if (!updated.ok) {
      expect(updated.error.code).toBe('code_taken');
      expect(updated.error.field).toBe('code');
    }
  });

  it('rechaza codigos vacios o con caracteres inseguros', async () => {
    const id = await createDraft();

    for (const code of ['', '   ', 'lote 1', 'lote#1']) {
      const updated = await updateProperty(db, id, { code });
      expect(updated.ok).toBe(false);
      if (!updated.ok) expect(updated.error.field).toBe('code');
    }
  });

  it('un codigo manual no rompe la secuencia automatica', async () => {
    const first = await createPropertyDraft(db);
    if (!first.ok) throw new Error('setup');
    await updateProperty(db, first.data.id, { code: 'FINCA-SUR' });

    const second = await createPropertyDraft(db);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.code).toBe('LOBA-001');
  });
});

/* -------------------------------------------------------------------------- */
/* Listado y lectura                                                          */
/* -------------------------------------------------------------------------- */

describe('listProperties', () => {
  it('(5) lista las propiedades con sus datos de panel', async () => {
    const id = await createDraft();
    await upsertPropertyTranslation(db, id, { locale: 'es', title: 'Lote uno' });
    await upsertPropertyTranslation(db, id, { locale: 'en', title: 'Lot one' });

    const list = await listProperties(db);

    expect(list).toHaveLength(1);
    expect(list[0]?.code).toBe('LOBA-001');
    expect(list[0]?.titleEs).toBe('Lote uno');
    expect(list[0]?.titleEn).toBe('Lot one');
    expect(list[0]?.publicationStatus).toBe('draft');
    expect(list[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('devuelve titulos nulos cuando no hay traduccion', async () => {
    await createDraft();
    const list = await listProperties(db);
    expect(list[0]?.titleEs).toBeNull();
    expect(list[0]?.titleEn).toBeNull();
  });

  it('(6) filtra por estado de publicacion', async () => {
    const a = await createDraft();
    await createDraft();
    await updatePropertyStatus(db, a, 'in_review');

    const enRevision = await listProperties(db, { publicationStatus: 'in_review' });
    const borradores = await listProperties(db, { publicationStatus: 'draft' });

    expect(enRevision).toHaveLength(1);
    expect(enRevision[0]?.id).toBe(a);
    expect(borradores).toHaveLength(1);
  });

  it('filtra por estado comercial y por tipo', async () => {
    const id = await createDraft();
    await updateProperty(db, id, {
      commercialStatus: 'reserved',
      propertyTypeId: seedTypeId('house'),
    });
    await createDraft();

    expect(await listProperties(db, { commercialStatus: 'reserved' })).toHaveLength(1);
    expect(await listProperties(db, { propertyTypeId: seedTypeId('house') })).toHaveLength(1);
    expect(await listProperties(db, { propertyTypeId: seedTypeId('farm') })).toHaveLength(0);
  });

  it('devuelve lista vacia sin propiedades', async () => {
    expect(await listProperties(db)).toEqual([]);
  });
});

describe('getPropertyForEdit', () => {
  it('(7) devuelve nucleo, tipo con traducciones y traducciones propias', async () => {
    const id = await createDraft();
    await updateProperty(db, id, { propertyTypeId: seedTypeId() });
    await upsertPropertyTranslation(db, id, { locale: 'es', title: 'Lote uno' });

    const found = await getPropertyForEdit(db, id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;

    expect(found.data.property.code).toBe('LOBA-001');
    expect(found.data.propertyType?.systemKey).toBe('lot');
    expect(found.data.propertyType?.names.es).toBe('Lote');
    expect(found.data.propertyType?.names.en).toBe('Lot');
    expect(found.data.translations).toHaveLength(1);
  });

  it('(8) devuelve not_found si no existe, sin lanzar excepcion', async () => {
    const found = await getPropertyForEdit(db, 99_999);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.error.code).toBe('not_found');
  });

  it('funciona con una propiedad sin tipo asignado', async () => {
    const id = await createDraft();
    const found = await getPropertyForEdit(db, id);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.data.propertyType).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Actualizacion del nucleo                                                   */
/* -------------------------------------------------------------------------- */

describe('updateProperty', () => {
  it('(9) actualiza parcialmente sin tocar el resto', async () => {
    const id = await createDraft();
    await updateProperty(db, id, { locality: 'Jaco', isFeatured: true });

    const updated = await updateProperty(db, id, { isFeatured: false });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.data.isFeatured).toBe(false);
    expect(updated.data.locality).toBe('Jaco');
    expect(updated.data.code).toBe('LOBA-001');
  });

  it('limpia un texto cuando se envia null', async () => {
    const id = await createDraft();
    await updateProperty(db, id, { locality: 'Jaco' });

    const cleared = await updateProperty(db, id, { locality: null });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.data.locality).toBeNull();
  });

  it('(11) acepta un precio exact coherente', async () => {
    const id = await createDraft();
    const updated = await updateProperty(db, id, {
      priceMode: 'exact',
      priceAmountMinor: 12_500_000,
      currencyCode: 'USD',
    });

    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.data.priceAmountMinor).toBe(12_500_000);
      expect(updated.data.currencyCode).toBe('USD');
    }
  });

  it('(12) rechaza un precio incoherente', async () => {
    const id = await createDraft();
    const updated = await updateProperty(db, id, { priceMode: 'exact' });

    expect(updated.ok).toBe(false);
    if (!updated.ok) {
      expect(updated.error.code).toBe('validation_failed');
      expect(updated.error.issues?.some((i) => i.path === 'priceAmountMinor')).toBe(true);
    }
  });

  it('valida el precio RESULTANTE, no solo lo que llega', async () => {
    const id = await createDraft();
    await updateProperty(db, id, {
      priceMode: 'exact',
      priceAmountMinor: 100,
      currencyCode: 'USD',
    });

    // Quitar el importe deja la fila incoherente aunque el modo no cambie.
    const updated = await updateProperty(db, id, { priceAmountMinor: null });
    expect(updated.ok).toBe(false);
  });

  it('acepta priceMode contact sin importe', async () => {
    const id = await createDraft();
    const updated = await updateProperty(db, id, {
      priceMode: 'contact',
      priceAmountMinor: null,
      currencyCode: null,
    });
    expect(updated.ok).toBe(true);
  });

  it('(13) rechaza coordenadas incompletas', async () => {
    const id = await createDraft();

    const soloLatitud = await updateProperty(db, id, { publicLatitude: 9.75 });
    expect(soloLatitud.ok).toBe(false);
    if (!soloLatitud.ok) expect(soloLatitud.error.field).toBe('publicLatitude');

    const soloLongitudPrivada = await updateProperty(db, id, { privateLongitude: -83.75 });
    expect(soloLongitudPrivada.ok).toBe(false);
  });

  it('acepta el par completo de coordenadas', async () => {
    const id = await createDraft();
    const updated = await updateProperty(db, id, {
      publicLatitude: 9.75,
      publicLongitude: -83.75,
      privateLatitude: 9.7489,
      privateLongitude: -83.7534,
      locationPrecision: 'exact',
    });

    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.data.publicLatitude).toBe(9.75);
      expect(updated.data.privateLatitude).toBe(9.7489);
    }
  });

  it('rechaza coordenadas fuera de rango', async () => {
    const id = await createDraft();
    const updated = await updateProperty(db, id, { publicLatitude: 95, publicLongitude: 0 });
    expect(updated.ok).toBe(false);
  });

  it('(10) rechaza un tipo inexistente', async () => {
    const id = await createDraft();
    const updated = await updateProperty(db, id, { propertyTypeId: 99_999 });

    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error.code).toBe('property_type_not_found');
  });

  it('NO permite cambiar el estado editorial desde aqui', async () => {
    const id = await createDraft();
    const updated = await updateProperty(db, id, {
      publicationStatus: 'published',
    } as never);

    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error.code).toBe('validation_failed');

    const found = await getPropertyForEdit(db, id);
    if (found.ok) expect(found.data.property.publicationStatus).toBe('draft');
  });

  it('NO permite tocar id, createdAt ni publishedAt', async () => {
    const id = await createDraft();

    for (const campo of ['id', 'createdAt', 'publishedAt']) {
      const updated = await updateProperty(db, id, { [campo]: 1 } as never);
      expect(updated.ok).toBe(false);
    }
  });

  it('devuelve not_found para una propiedad inexistente', async () => {
    const updated = await updateProperty(db, 99_999, { isFeatured: true });
    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error.code).toBe('not_found');
  });

  it('(23) updatedAt avanza al editar y createdAt no cambia', async () => {
    const id = await createDraft();

    // Se retrasa la marca para que el cambio sea observable aunque el test
    // corra dentro del mismo segundo (los timestamps se guardan en segundos).
    sqlite
      .prepare('UPDATE properties SET created_at = ?, updated_at = ? WHERE id = ?')
      .run(1_000_000, 1_000_000, id);

    const before = await getPropertyForEdit(db, id);
    if (!before.ok) throw new Error('setup');

    const updated = await updateProperty(db, id, { isFeatured: true });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.data.updatedAt.getTime()).toBeGreaterThan(
      before.data.property.updatedAt.getTime(),
    );
    expect(updated.data.createdAt.getTime()).toBe(before.data.property.createdAt.getTime());
  });
});

/* -------------------------------------------------------------------------- */
/* Traducciones                                                               */
/* -------------------------------------------------------------------------- */

describe('upsertPropertyTranslation', () => {
  it('(14) crea y luego actualiza la traduccion espanola', async () => {
    const id = await createDraft();

    const created = await upsertPropertyTranslation(db, id, {
      locale: 'es',
      title: 'Lote con vista',
      marketingDescription: 'Bonito lote',
    });
    expect(created.ok).toBe(true);

    const updated = await upsertPropertyTranslation(db, id, {
      locale: 'es',
      title: 'Lote con vista al mar',
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.data.title).toBe('Lote con vista al mar');
    // El upsert no borra lo que no se envia.
    expect(updated.data.marketingDescription).toBe('Bonito lote');

    const found = await getPropertyForEdit(db, id);
    if (found.ok) expect(found.data.translations).toHaveLength(1);
  });

  it('(15) el ingles es independiente del espanol', async () => {
    const id = await createDraft();

    await upsertPropertyTranslation(db, id, { locale: 'es', title: 'Lote', slug: 'lote' });
    const english = await upsertPropertyTranslation(db, id, {
      locale: 'en',
      title: 'Lot',
      slug: 'lot',
    });

    expect(english.ok).toBe(true);

    const found = await getPropertyForEdit(db, id);
    if (!found.ok) return;

    expect(found.data.translations).toHaveLength(2);
    const es = found.data.translations.find((t) => t.locale === 'es');
    const en = found.data.translations.find((t) => t.locale === 'en');
    expect(es?.slug).toBe('lote');
    expect(en?.slug).toBe('lot');
  });

  it('una propiedad puede tener solo espanol', async () => {
    const id = await createDraft();
    await upsertPropertyTranslation(db, id, { locale: 'es', title: 'Lote' });

    const found = await getPropertyForEdit(db, id);
    if (found.ok) expect(found.data.translations).toHaveLength(1);
  });

  it('(16) genera el slug a partir del titulo cuando no se envia', async () => {
    const id = await createDraft();
    const created = await upsertPropertyTranslation(db, id, {
      locale: 'es',
      title: 'Finca Añeja con Vista',
    });

    expect(created.ok).toBe(true);
    if (created.ok) expect(created.data.slug).toBe('finca-aneja-con-vista');
  });

  it('no pisa un slug existente al cambiar el titulo', async () => {
    const id = await createDraft();
    await upsertPropertyTranslation(db, id, { locale: 'es', title: 'Lote uno' });

    const updated = await upsertPropertyTranslation(db, id, { locale: 'es', title: 'Lote dos' });
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.data.slug).toBe('lote-uno');
  });

  it('valida un slug explicito en vez de arreglarlo', async () => {
    const id = await createDraft();
    const bad = await upsertPropertyTranslation(db, id, { locale: 'es', slug: 'Mal Slug' });

    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.field).toBe('slug');
  });

  it('un slug vacio se guarda como null en borrador', async () => {
    const id = await createDraft();
    const created = await upsertPropertyTranslation(db, id, { locale: 'es', slug: '' });

    expect(created.ok).toBe(true);
    if (created.ok) expect(created.data.slug).toBeNull();
  });

  it('(17) rechaza un slug ya usado en el mismo idioma', async () => {
    const first = await createDraft();
    const second = await createDraft();

    await upsertPropertyTranslation(db, first, { locale: 'es', slug: 'lote-vista-al-mar' });
    const collision = await upsertPropertyTranslation(db, second, {
      locale: 'es',
      slug: 'lote-vista-al-mar',
    });

    expect(collision.ok).toBe(false);
    if (!collision.ok) {
      expect(collision.error.code).toBe('slug_taken');
      expect(collision.error.field).toBe('slug');
    }
  });

  it('el mismo slug SI puede repetirse en otro idioma', async () => {
    const id = await createDraft();

    await upsertPropertyTranslation(db, id, { locale: 'es', slug: 'vista-al-mar' });
    const english = await upsertPropertyTranslation(db, id, {
      locale: 'en',
      slug: 'vista-al-mar',
    });

    expect(english.ok).toBe(true);
  });

  it('rechaza un locale no soportado', async () => {
    const id = await createDraft();
    const bad = await upsertPropertyTranslation(db, id, { locale: 'fr' } as never);
    expect(bad.ok).toBe(false);
  });

  it('devuelve not_found si la propiedad no existe', async () => {
    const bad = await upsertPropertyTranslation(db, 99_999, { locale: 'es', title: 'X' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Estados                                                                    */
/* -------------------------------------------------------------------------- */

describe('updatePropertyStatus', () => {
  it('(18) permite draft -> in_review -> approved', async () => {
    const id = await createDraft();

    const review = await updatePropertyStatus(db, id, 'in_review');
    expect(review.ok).toBe(true);
    if (review.ok) expect(review.data.publicationStatus).toBe('in_review');

    const approved = await updatePropertyStatus(db, id, 'approved');
    expect(approved.ok).toBe(true);
    if (approved.ok) expect(approved.data.publicationStatus).toBe('approved');
  });

  it('permite volver a borrador para corregir', async () => {
    const id = await createDraft();
    await updatePropertyStatus(db, id, 'in_review');

    expect((await updatePropertyStatus(db, id, 'draft')).ok).toBe(true);

    await updatePropertyStatus(db, id, 'in_review');
    await updatePropertyStatus(db, id, 'approved');
    expect((await updatePropertyStatus(db, id, 'draft')).ok).toBe(true);
  });

  it('(19) rechaza draft -> published', async () => {
    const id = await createDraft();
    const published = await updatePropertyStatus(db, id, 'published');

    expect(published.ok).toBe(false);
    if (!published.ok) expect(published.error.code).toBe('invalid_status_transition');
  });

  it('(19) tampoco publica desde approved en esta fase', async () => {
    const id = await createDraft();
    await updatePropertyStatus(db, id, 'in_review');
    await updatePropertyStatus(db, id, 'approved');

    const published = await updatePropertyStatus(db, id, 'published');
    expect(published.ok).toBe(false);
  });

  it('rechaza saltarse la revision', async () => {
    const id = await createDraft();
    const approved = await updatePropertyStatus(db, id, 'approved');
    expect(approved.ok).toBe(false);
  });

  it('nunca escribe publishedAt', async () => {
    const id = await createDraft();
    await updatePropertyStatus(db, id, 'in_review');
    await updatePropertyStatus(db, id, 'approved');

    const found = await getPropertyForEdit(db, id);
    if (found.ok) expect(found.data.property.publishedAt).toBeNull();
  });

  it('devuelve not_found si la propiedad no existe', async () => {
    const bad = await updatePropertyStatus(db, 99_999, 'in_review');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Archivado                                                                  */
/* -------------------------------------------------------------------------- */

describe('archiveProperty', () => {
  it('(20) archiva conservando fila, traducciones y estado comercial', async () => {
    const id = await createDraft();
    await updateProperty(db, id, { commercialStatus: 'reserved', locality: 'Jaco' });
    await upsertPropertyTranslation(db, id, { locale: 'es', title: 'Lote uno' });

    const archived = await archiveProperty(db, id);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;

    expect(archived.data.publicationStatus).toBe('archived');
    // El estado comercial NO se toca al archivar.
    expect(archived.data.commercialStatus).toBe('reserved');

    const found = await getPropertyForEdit(db, id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;

    expect(found.data.property.locality).toBe('Jaco');
    expect(found.data.translations).toHaveLength(1);
    expect(found.data.translations[0]?.title).toBe('Lote uno');
  });

  it('la propiedad archivada sigue en la base', async () => {
    const id = await createDraft();
    await archiveProperty(db, id);

    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM properties WHERE id = ?').get(id) as {
      n: number;
    };
    expect(row.n).toBe(1);
  });

  it('permite recuperar una propiedad archivada a borrador', async () => {
    const id = await createDraft();
    await archiveProperty(db, id);

    const restored = await updatePropertyStatus(db, id, 'draft');
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.data.publicationStatus).toBe('draft');
  });
});

/* -------------------------------------------------------------------------- */
/* Tipos de propiedad                                                         */
/* -------------------------------------------------------------------------- */

describe('tipos de propiedad', () => {
  it('lista los tipos del seed con sus traducciones', async () => {
    const types = await listActivePropertyTypes(db);

    expect(types).toHaveLength(6);
    const lot = types.find((t) => t.systemKey === 'lot');
    expect(lot?.names.es).toBe('Lote');
    expect(lot?.names.en).toBe('Lot');
  });

  it('(21) crea un tipo personalizado con nombre espanol', async () => {
    const created = await createCustomPropertyType(db, { nameEs: 'Bodega' });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.data.systemKey).toBeNull();
    expect(created.data.names.es).toBe('Bodega');
    expect(created.data.names.en).toBeUndefined();

    const types = await listActivePropertyTypes(db);
    expect(types).toHaveLength(7);
  });

  it('(22) el ingles del tipo personalizado es opcional', async () => {
    const created = await createCustomPropertyType(db, {
      nameEs: 'Bodega',
      nameEn: 'Warehouse',
    });

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.data.names.es).toBe('Bodega');
      expect(created.data.names.en).toBe('Warehouse');
    }
  });

  it('exige el nombre en espanol', async () => {
    const created = await createCustomPropertyType(db, { nameEs: '   ' });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.field).toBe('nameEs');
  });

  it('varios tipos personalizados conviven con systemKey nulo', async () => {
    await createCustomPropertyType(db, { nameEs: 'Bodega' });
    const second = await createCustomPropertyType(db, { nameEs: 'Oficina' });

    expect(second.ok).toBe(true);
    expect(await listActivePropertyTypes(db)).toHaveLength(8);
  });

  it('un tipo personalizado sirve para una propiedad', async () => {
    const type = await createCustomPropertyType(db, { nameEs: 'Bodega' });
    if (!type.ok) throw new Error('setup');

    const id = await createDraft();
    const updated = await updateProperty(db, id, { propertyTypeId: type.data.id });

    expect(updated.ok).toBe(true);
  });
});
