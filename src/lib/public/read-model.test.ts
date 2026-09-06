/**
 * Tests del read model publico.
 *
 * Contra SQLite real con las migraciones del proyecto. Aqui importa tanto lo
 * que se publica como lo que NO: hay un bloque entero dedicado a demostrar que
 * nada privado llega al snapshot.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties, propertyTranslations } from '../../db/schema';
import { createFeatureGroup } from '../admin/features/feature-groups';
import { createFeature } from '../admin/features/features';
import { createMedia } from '../admin/media/media';
import { createPropertyDraft } from '../admin/properties/create-property';
import { updateProperty } from '../admin/properties/update-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import { createTourNode } from '../admin/tour/nodes';
import type { AdminBatchDatabase } from '../admin/types';
import type { CommercialStatus, PublicationStatus } from '../domain/vocabularies';
import {
  buildPublicSnapshot,
  catalogueHref,
  catalogueOf,
  findBySlug,
  formatPrice,
  propertyHref,
  publishedCommercialStatus,
  type PublicSnapshot,
} from './read-model';

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

/**
 * Coloca el estado de publicacion directamente.
 *
 * La maquina de estados exige pasar por revision, y eso ya se prueba en su
 * sitio: aqui interesa el read model, no el camino hasta `published`.
 */
async function setStatus(
  propertyId: number,
  publicationStatus: PublicationStatus,
  commercialStatus: CommercialStatus = 'available',
): Promise<void> {
  await db
    .update(properties)
    .set({ publicationStatus, commercialStatus })
    .where(eq(properties.id, propertyId));
}

async function translate(
  propertyId: number,
  locale: 'es' | 'en',
  fields: { slug?: string | null; title?: string | null; marketingDescription?: string | null },
): Promise<void> {
  const result = await upsertPropertyTranslation(db, propertyId, { locale, ...fields });
  if (!result.ok) throw new Error(`setup: traduccion ${locale}`);
}

/** Propiedad publicada y traducida en espanol, que es el caso habitual. */
async function publishedProperty(slug = 'lote-nosara'): Promise<number> {
  const propertyId = await newProperty();

  await updateProperty(db, propertyId, {
    propertyTypeId: 1,
    priceMode: 'exact',
    priceAmountMinor: 18_500_000,
    currencyCode: 'USD',
    areaSquareMeters: 5200,
    province: 'Guanacaste',
    canton: 'Nicoya',
    district: 'Nosara',
    locality: 'Playa Guiones',
    privateLatitude: 9.9512,
    privateLongitude: -85.6531,
    publicLatitude: 9.951,
    publicLongitude: -85.653,
  });

  await translate(propertyId, 'es', { slug, title: 'Lote con vista al mar' });
  await setStatus(propertyId, 'published');

  return propertyId;
}

async function snapshot(): Promise<PublicSnapshot> {
  return buildPublicSnapshot(db);
}

/* -------------------------------------------------------------------------- */
/* Que se publica                                                             */
/* -------------------------------------------------------------------------- */

describe('que llega al sitio publico', () => {
  it('una base sin propiedades da un snapshot vacio en los dos idiomas', async () => {
    const data = await snapshot();

    expect(catalogueOf(data, 'es')).toEqual([]);
    expect(catalogueOf(data, 'en')).toEqual([]);
  });

  it('una propiedad publicada y traducida aparece', async () => {
    await publishedProperty();

    const catalogue = catalogueOf(await snapshot(), 'es');

    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]?.title).toBe('Lote con vista al mar');
    expect(catalogue[0]?.href).toBe('/es/propiedades/lote-nosara');
  });

  it('un borrador no aparece', async () => {
    const propertyId = await newProperty();
    await translate(propertyId, 'es', { slug: 'borrador', title: 'Borrador' });

    expect(catalogueOf(await snapshot(), 'es')).toHaveLength(0);
  });

  it('tampoco aparecen en revision, aprobada ni archivada', async () => {
    for (const status of ['in_review', 'approved', 'archived'] as const) {
      const propertyId = await newProperty();
      await translate(propertyId, 'es', {
        slug: `estado-${status.replace('_', '-')}`,
        title: status,
      });
      await setStatus(propertyId, status);
    }

    expect(catalogueOf(await snapshot(), 'es')).toHaveLength(0);
  });

  it('una vendida se oculta salvo que se pida mostrarla', async () => {
    const hidden = await publishedProperty('vendida-oculta');
    await setStatus(hidden, 'published', 'sold');

    expect(catalogueOf(await snapshot(), 'es')).toHaveLength(0);

    await updateProperty(db, hidden, { showWhenSold: true });

    const catalogue = catalogueOf(await snapshot(), 'es');
    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]?.commercialStatus).toBe('sold');
  });

  it('reservada y con oferta siguen visibles', async () => {
    const propertyId = await publishedProperty('reservada');
    await setStatus(propertyId, 'published', 'reserved');

    const catalogue = catalogueOf(await snapshot(), 'es');
    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]?.commercialStatus).toBe('reserved');
  });

  it('el estado comercial normal no se anuncia', async () => {
    await publishedProperty();

    expect(catalogueOf(await snapshot(), 'es')[0]?.commercialStatus).toBeNull();
    expect(publishedCommercialStatus('available')).toBeNull();
    expect(publishedCommercialStatus('reserved')).toBe('reserved');
  });
});

/* -------------------------------------------------------------------------- */
/* Idiomas                                                                    */
/* -------------------------------------------------------------------------- */

describe('espanol e ingles son independientes', () => {
  it('sin traduccion inglesa, la propiedad no existe en ingles', async () => {
    await publishedProperty();

    const data = await snapshot();
    expect(catalogueOf(data, 'es')).toHaveLength(1);
    expect(catalogueOf(data, 'en')).toHaveLength(0);
  });

  it('con las dos, cada idioma usa SU slug y SU titulo', async () => {
    const propertyId = await publishedProperty('lote-vista-al-mar');
    await translate(propertyId, 'en', { slug: 'ocean-view-lot', title: 'Ocean view lot' });

    const data = await snapshot();

    expect(catalogueOf(data, 'es')[0]?.slug).toBe('lote-vista-al-mar');
    expect(catalogueOf(data, 'en')[0]?.slug).toBe('ocean-view-lot');
    expect(catalogueOf(data, 'en')[0]?.title).toBe('Ocean view lot');
    expect(catalogueOf(data, 'en')[0]?.href).toBe('/en/propiedades/ocean-view-lot');
  });

  it('nunca se copia el contenido de un idioma al otro', async () => {
    const propertyId = await publishedProperty('solo-espanol');
    await translate(propertyId, 'es', { marketingDescription: 'Texto en español' });

    const data = await snapshot();

    expect(catalogueOf(data, 'en')).toHaveLength(0);
    expect(findBySlug(data, 'es', 'solo-espanol')?.marketingDescription).toBe('Texto en español');
  });

  it('una traduccion con titulo pero sin slug no genera ficha', async () => {
    const propertyId = await publishedProperty();

    /*
     * Se escribe la fila directamente: `upsertPropertyTranslation` deriva el
     * slug del titulo cuando no hay ninguno, asi que por la via del admin este
     * estado no se alcanza. Aqui se comprueba la regla del read model, que es
     * la ultima defensa si la fila llega de otro sitio.
     */
    await db
      .insert(propertyTranslations)
      .values({ propertyId, locale: 'en', slug: null, title: 'Ocean view lot' });

    expect(catalogueOf(await snapshot(), 'en')).toHaveLength(0);
  });

  it('una traduccion con slug pero sin titulo tampoco', async () => {
    const propertyId = await publishedProperty();
    await translate(propertyId, 'en', { slug: 'ocean-view-lot' });

    expect(catalogueOf(await snapshot(), 'en')).toHaveLength(0);
  });

  it('no se inventa ningun slug', async () => {
    const propertyId = await newProperty();
    await setStatus(propertyId, 'published');

    // Sin traduccion en ninguno de los dos idiomas: no hay nada que publicar.
    const data = await snapshot();
    expect(catalogueOf(data, 'es')).toHaveLength(0);
    expect(catalogueOf(data, 'en')).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Contenido de la ficha                                                      */
/* -------------------------------------------------------------------------- */

describe('contenido de la ficha', () => {
  it('trae precio, superficie, ubicacion publica y tipo', async () => {
    await publishedProperty();

    const property = findBySlug(await snapshot(), 'es', 'lote-nosara');

    expect(property?.price.text).toContain('185');
    expect(property?.area?.squareMeters).toBe(5200);
    expect(property?.area?.text).toContain('m²');
    expect(property?.location.province).toBe('Guanacaste');
    expect(property?.location.locality).toBe('Playa Guiones');
    expect(property?.propertyType).not.toBeNull();
  });

  it('la coordenada publica es la publica, nunca la privada', async () => {
    await publishedProperty();

    const property = findBySlug(await snapshot(), 'es', 'lote-nosara');

    expect(property?.location.coordinates).toEqual({ latitude: 9.951, longitude: -85.653 });
    // La privada era 9.9512 / -85.6531: no coincide con ninguna de las dos.
    expect(property?.location.coordinates?.latitude).not.toBe(9.9512);
  });

  it('sin coordenada publica no se publica ninguna', async () => {
    const propertyId = await publishedProperty('sin-coordenadas');
    await updateProperty(db, propertyId, { publicLatitude: null, publicLongitude: null });

    expect(findBySlug(await snapshot(), 'es', 'sin-coordenadas')?.location.coordinates).toBeNull();
  });

  it('agrupa las caracteristicas y respeta su orden', async () => {
    const propertyId = await publishedProperty();

    const group = await createFeatureGroup(db, propertyId, { nameEs: 'Terreno' });
    if (!group.ok) throw new Error('setup');

    await createFeature(db, propertyId, {
      groupId: group.data.id,
      labelEs: 'Área',
      valueEs: '5.200 m²',
    });
    await createFeature(db, propertyId, { labelEs: 'Acceso', valueEs: 'Calle lastreada' });

    const property = findBySlug(await snapshot(), 'es', 'lote-nosara');

    expect(property?.features).toHaveLength(2);
    expect(property?.features[0]?.name).toBe('Terreno');
    expect(property?.features[0]?.items).toEqual([{ label: 'Área', value: '5.200 m²' }]);
    // Las sueltas van al final, en un grupo sin nombre.
    expect(property?.features[1]?.name).toBeNull();
    expect(property?.features[1]?.items[0]?.label).toBe('Acceso');
  });

  it('una caracteristica sin etiqueta en ese idioma no se publica', async () => {
    const propertyId = await publishedProperty();
    await translate(propertyId, 'en', { slug: 'ocean-view-lot', title: 'Ocean view lot' });

    await createFeature(db, propertyId, { labelEs: 'Acceso', valueEs: 'Lastre' });

    const data = await snapshot();

    expect(findBySlug(data, 'es', 'lote-nosara')?.features).toHaveLength(1);
    // En ingles esa caracteristica no dice nada, asi que no aparece.
    expect(findBySlug(data, 'en', 'ocean-view-lot')?.features).toHaveLength(0);
  });

  it('resume el multimedia sin decir donde esta', async () => {
    const propertyId = await publishedProperty();

    await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: 'privado/foto.jpg',
    });
    await createMedia(db, propertyId, {
      mediaKind: 'panorama',
      sourceProvider: 'r2',
      objectKey: 'privado/pano.jpg',
    });

    const property = findBySlug(await snapshot(), 'es', 'lote-nosara');

    expect(property?.media.counts.image).toBe(1);
    expect(property?.media.counts.panorama).toBe(1);
    expect(property?.media.counts.video).toBe(0);
    expect(property?.media.hasTour).toBe(false);
  });

  it('anuncia que hay recorrido 360 cuando lo hay', async () => {
    const propertyId = await publishedProperty();

    const panorama = await createMedia(db, propertyId, {
      mediaKind: 'panorama',
      sourceProvider: 'r2',
      objectKey: 'privado/pano-tour.jpg',
    });
    if (!panorama.ok) throw new Error('setup');

    await createTourNode(db, propertyId, { propertyMediaId: panorama.data.id });

    expect(findBySlug(await snapshot(), 'es', 'lote-nosara')?.media.hasTour).toBe(true);
  });

  it('una propiedad inexistente no se encuentra por slug', async () => {
    await publishedProperty();

    expect(findBySlug(await snapshot(), 'es', 'no-existe')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Precio                                                                     */
/* -------------------------------------------------------------------------- */

describe('precio publicado', () => {
  it('el modo consultar no publica importe aunque haya uno guardado', async () => {
    const propertyId = await publishedProperty('a-consultar');
    await updateProperty(db, propertyId, { priceMode: 'contact' });

    const property = findBySlug(await snapshot(), 'es', 'a-consultar');

    expect(property?.price.amountMinor).toBeNull();
    expect(property?.price.currencyCode).toBeNull();
    expect(property?.price.text).toBe('Consultar precio');
  });

  it('el negociable se marca como tal', () => {
    expect(formatPrice('negotiable', 18_500_000, 'USD', 'es').text).toContain('negociable');
    expect(formatPrice('negotiable', 18_500_000, 'USD', 'en').text).toContain('negotiable');
  });

  it('cada idioma formatea con su convencion', () => {
    const es = formatPrice('exact', 18_500_000, 'USD', 'es').text;
    const en = formatPrice('exact', 18_500_000, 'USD', 'en').text;

    expect(es).toContain('185');
    expect(en).toContain('185');
    // No se convierte de moneda en ningun caso.
    expect(formatPrice('exact', 18_500_000, 'CRC', 'es').currencyCode).toBe('CRC');
  });

  it('sin importe se pide consultar, sea cual sea el modo', () => {
    expect(formatPrice('exact', null, 'USD', 'es').text).toBe('Consultar precio');
    expect(formatPrice('exact', 18_500_000, null, 'en').text).toBe('Price on request');
  });
});

/* -------------------------------------------------------------------------- */
/* Nada privado                                                               */
/* -------------------------------------------------------------------------- */

describe('el snapshot no contiene nada privado', () => {
  /** Recorre el snapshot entero buscando claves y valores prohibidos. */
  function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit);
      return;
    }

    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        visit(key, child);
        walk(child, visit);
      }
    }
  }

  async function fullSnapshot(): Promise<PublicSnapshot> {
    const propertyId = await publishedProperty();
    await translate(propertyId, 'en', { slug: 'ocean-view-lot', title: 'Ocean view lot' });

    const group = await createFeatureGroup(db, propertyId, { nameEs: 'Terreno' });
    if (group.ok) {
      await createFeature(db, propertyId, { groupId: group.data.id, labelEs: 'Área' });
    }

    const panorama = await createMedia(db, propertyId, {
      mediaKind: 'panorama',
      sourceProvider: 'r2',
      objectKey: 'propiedades/1/panorama/secreto.jpg',
    });
    if (panorama.ok) await createTourNode(db, propertyId, { propertyMediaId: panorama.data.id });

    await createMedia(db, propertyId, {
      mediaKind: 'video',
      sourceProvider: 'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });

    // Una propiedad no publicada, para comprobar que ni asoma.
    const draft = await newProperty();
    await translate(draft, 'es', { slug: 'borrador-secreto', title: 'Borrador secreto' });

    return snapshot();
  }

  it('no lleva coordenadas privadas', async () => {
    const data = await fullSnapshot();
    const json = JSON.stringify(data);

    expect(json).not.toContain('privateLatitude');
    expect(json).not.toContain('privateLongitude');
    // Ni el valor concreto de la coordenada privada.
    expect(json).not.toContain('9.9512');
    expect(json).not.toContain('-85.6531');
  });

  it('no lleva estado editorial ni fechas internas', async () => {
    const json = JSON.stringify(await fullSnapshot());

    for (const forbidden of ['publicationStatus', 'publishedAt', 'createdAt', 'updatedAt']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('no lleva identificadores de la base', async () => {
    const data = await fullSnapshot();

    const keys: string[] = [];
    walk(data, (key) => keys.push(key));

    for (const forbidden of ['id', 'propertyId', 'propertyTypeId', 'groupId', 'mediaId']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('no lleva claves de R2, ni el nombre del objeto', async () => {
    const json = JSON.stringify(await fullSnapshot());

    expect(json).not.toContain('objectKey');
    expect(json).not.toContain('secreto.jpg');
    expect(json).not.toContain('propiedades/1/panorama');
  });

  it('el identificador de YouTube si viaja: es publico por definicion', async () => {
    const data = await fullSnapshot();
    const property = catalogueOf(data, 'es')[0];

    const video = property?.media.items.find((item) => item.kind === 'video');

    expect(video?.youtubeVideoId).toBe('dQw4w9WgXcQ');
    // Y no se sirve desde R2: no hay URL propia que proxie el video.
    expect(video?.url).toBeNull();
  });

  it('cada archivo de R2 se publica como ruta, no como clave', async () => {
    const data = await fullSnapshot();
    const property = catalogueOf(data, 'es')[0];

    const panorama = property?.media.items.find((item) => item.kind === 'panorama');

    expect(panorama?.url).toMatch(/^\/media\/\d+$/);
    expect(panorama?.youtubeVideoId).toBeNull();
  });

  it('no lleva nada de revisiones, tokens ni contactos', async () => {
    const json = JSON.stringify(await fullSnapshot());

    for (const forbidden of ['token', 'Token', 'review', 'Review', 'contact', 'Contact']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('no lleva propiedades sin publicar', async () => {
    const json = JSON.stringify(await fullSnapshot());

    expect(json).not.toContain('borrador-secreto');
    expect(json).not.toContain('Borrador secreto');
  });

  it('las claves publicadas son exactamente las previstas', async () => {
    const data = await fullSnapshot();
    const property = catalogueOf(data, 'es')[0];
    if (property === undefined) throw new Error('setup');

    expect(Object.keys(property).sort()).toEqual(
      [
        'area',
        'code',
        'commercialStatus',
        'features',
        'href',
        'isFeatured',
        'location',
        'marketingDescription',
        'media',
        'price',
        'propertyType',
        'slug',
        'technicalDescription',
        'title',
      ].sort(),
    );
  });

  it('la ubicacion solo expone lo publicable', async () => {
    const data = await fullSnapshot();
    const property = catalogueOf(data, 'es')[0];

    expect(Object.keys(property?.location ?? {}).sort()).toEqual(
      ['canton', 'coordinates', 'district', 'locality', 'precision', 'province'].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Rutas                                                                      */
/* -------------------------------------------------------------------------- */

describe('rutas publicas', () => {
  it('cada idioma tiene su arbol', () => {
    expect(catalogueHref('es')).toBe('/es/propiedades');
    expect(catalogueHref('en')).toBe('/en/propiedades');
    expect(propertyHref('es', 'lote-nosara')).toBe('/es/propiedades/lote-nosara');
    expect(propertyHref('en', 'ocean-view-lot')).toBe('/en/propiedades/ocean-view-lot');
  });
});
