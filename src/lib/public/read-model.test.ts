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

import {
  properties,
  propertyTourNodes,
  propertyTranslations,
  siteSettings,
  siteSettingTranslations,
} from '../../db/schema';
import { createFeatureGroup } from '../admin/features/feature-groups';
import { createFeature } from '../admin/features/features';
import { createMedia } from '../admin/media/media';
import { createPropertyDraft } from '../admin/properties/create-property';
import { updateProperty } from '../admin/properties/update-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import { createTourLink } from '../admin/tour/links';
import { createTourNode, setStartNode, type CreateTourNodeInput } from '../admin/tour/nodes';
import type { AdminBatchDatabase } from '../admin/types';
import type { CommercialStatus, PublicationStatus } from '../domain/vocabularies';
import { createLead } from '../contacts/lead';
import { featuredOf } from './home';
import { mapPointsOf } from './map';
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
/* Recorrido 360                                                              */
/* -------------------------------------------------------------------------- */

describe('el recorrido publicado', () => {
  /** Un panorama nuevo de la propiedad, listo para colgarle un punto. */
  async function panorama(propertyId: number, name: string): Promise<number> {
    const created = await createMedia(db, propertyId, {
      mediaKind: 'panorama',
      sourceProvider: 'r2',
      objectKey: `propiedades/${propertyId}/panorama/${name}.jpg`,
    });
    if (!created.ok) throw new Error('setup: panorama');

    return created.data.id;
  }

  async function node(
    propertyId: number,
    mediaId: number,
    input: Partial<CreateTourNodeInput> = {},
  ): Promise<number> {
    const created = await createTourNode(db, propertyId, {
      propertyMediaId: mediaId,
      ...input,
    });
    if (!created.ok) throw new Error('setup: punto');

    return created.data.id;
  }

  it('una propiedad sin puntos no publica recorrido', async () => {
    const propertyId = await publishedProperty();
    await panorama(propertyId, 'suelto');

    const property = findBySlug(await snapshot(), 'es', 'lote-nosara');

    // Hay un panorama, pero nadie ha montado el recorrido con el.
    expect(property?.tour).toBeNull();
    expect(property?.media.hasTour).toBe(false);
  });

  it('publica los puntos en su orden, con su panorama', async () => {
    const propertyId = await publishedProperty();

    await node(propertyId, await panorama(propertyId, 'entrada'), {
      nameEs: 'Entrada',
      sortOrder: 0,
    });
    const second = await panorama(propertyId, 'mirador');
    await node(propertyId, second, { nameEs: 'Mirador', sortOrder: 1 });

    const tour = findBySlug(await snapshot(), 'es', 'lote-nosara')?.tour;

    expect(tour?.nodes.map((item) => item.name)).toEqual(['Entrada', 'Mirador']);
    // La ruta publica de 4B, no la clave del objeto.
    expect(tour?.nodes[1]?.url).toBe(`/media/${second}`);
  });

  it('empieza por el punto inicial marcado', async () => {
    const propertyId = await publishedProperty();

    await node(propertyId, await panorama(propertyId, 'entrada'), { nameEs: 'Entrada' });
    const miradorId = await node(propertyId, await panorama(propertyId, 'mirador'), {
      nameEs: 'Mirador',
    });

    const marked = await setStartNode(db, propertyId, miradorId, true);
    if (!marked.ok) throw new Error('setup: inicio');

    const tour = findBySlug(await snapshot(), 'es', 'lote-nosara')?.tour;

    // La clave es la posicion dentro del recorrido: el segundo punto.
    expect(tour?.start).toBe('2');
    expect(tour?.nodes.find((item) => item.key === tour.start)?.name).toBe('Mirador');
  });

  it('sin punto inicial marcado abre por el primero', async () => {
    const propertyId = await publishedProperty();

    await node(propertyId, await panorama(propertyId, 'entrada'), { nameEs: 'Entrada' });
    await node(propertyId, await panorama(propertyId, 'mirador'), { nameEs: 'Mirador' });

    expect(findBySlug(await snapshot(), 'es', 'lote-nosara')?.tour?.start).toBe('1');
  });

  it('los saltos apuntan a la clave del destino, con su posicion', async () => {
    const propertyId = await publishedProperty();

    const entrada = await node(propertyId, await panorama(propertyId, 'entrada'), {
      nameEs: 'Entrada',
    });
    const mirador = await node(propertyId, await panorama(propertyId, 'mirador'), {
      nameEs: 'Mirador',
    });

    const link = await createTourLink(db, propertyId, {
      fromNodeId: entrada,
      toNodeId: mirador,
      yaw: 1.25,
      pitch: -0.4,
    });
    if (!link.ok) throw new Error('setup: salto');

    const tour = findBySlug(await snapshot(), 'es', 'lote-nosara')?.tour;

    expect(tour?.nodes[0]?.links).toEqual([{ to: '2', yaw: 1.25, pitch: -0.4 }]);
    // El salto es dirigido: el destino no gana uno de vuelta por su cuenta.
    expect(tour?.nodes[1]?.links).toEqual([]);
  });

  it('publica la camara inicial solo cuando esta ajustada', async () => {
    const propertyId = await publishedProperty();

    await node(propertyId, await panorama(propertyId, 'entrada'), {
      initialYaw: 0.5,
      initialPitch: 0.1,
      initialFov: 70,
    });
    await node(propertyId, await panorama(propertyId, 'mirador'), {});

    const tour = findBySlug(await snapshot(), 'es', 'lote-nosara')?.tour;

    expect(tour?.nodes[0]?.initialView).toEqual({ yaw: 0.5, pitch: 0.1, fov: 70 });
    expect(tour?.nodes[1]?.initialView).toBeNull();
  });

  it('cada idioma trae sus nombres, y el que falta queda vacio', async () => {
    const propertyId = await publishedProperty();
    await translate(propertyId, 'en', { slug: 'ocean-view-lot', title: 'Ocean view lot' });

    await node(propertyId, await panorama(propertyId, 'entrada'), {
      nameEs: 'Entrada',
      nameEn: 'Entrance',
    });
    // Este solo tiene nombre en espanol.
    await node(propertyId, await panorama(propertyId, 'mirador'), { nameEs: 'Mirador' });

    const data = await snapshot();

    expect(findBySlug(data, 'es', 'lote-nosara')?.tour?.nodes.map((item) => item.name)).toEqual([
      'Entrada',
      'Mirador',
    ]);
    // En ingles no se inventa el nombre ni se copia del otro idioma.
    expect(findBySlug(data, 'en', 'ocean-view-lot')?.tour?.nodes.map((item) => item.name)).toEqual([
      'Entrance',
      null,
    ]);
  });

  it('el recorrido de una propiedad no publicada no existe', async () => {
    const propertyId = await publishedProperty();
    await node(propertyId, await panorama(propertyId, 'entrada'), { nameEs: 'Entrada' });

    await setStatus(propertyId, 'draft');

    const data = await snapshot();

    expect(catalogueOf(data, 'es')).toHaveLength(0);
    expect(JSON.stringify(data)).not.toContain('Entrada');
  });

  it('el recorrido de una vendida y oculta tampoco', async () => {
    const propertyId = await publishedProperty();
    await node(propertyId, await panorama(propertyId, 'entrada'), { nameEs: 'Entrada' });

    await setStatus(propertyId, 'published', 'sold');

    expect(JSON.stringify(await snapshot())).not.toContain('Entrada');
  });

  /*
   * Los dos casos que la base no puede impedir. La clave foranea garantiza que
   * el archivo existe, pero no que sea de esta propiedad ni que sea un
   * panorama: eso lo comprueba el read model, y por eso se prueba insertando
   * la fila a mano, que es la unica forma de llegar ahi.
   */
  it('descarta un punto cuyo panorama es de otra propiedad', async () => {
    const otherId = await newProperty();
    const ajeno = await panorama(otherId, 'ajeno');

    const propertyId = await publishedProperty();
    await db.insert(propertyTourNodes).values({ propertyId, propertyMediaId: ajeno });

    const property = findBySlug(await snapshot(), 'es', 'lote-nosara');

    expect(property?.tour).toBeNull();
    expect(property?.media.hasTour).toBe(false);
  });

  it('descarta un punto colgado de un archivo que no es panorama', async () => {
    const propertyId = await publishedProperty();

    const photo = await createMedia(db, propertyId, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: 'propiedades/1/image/foto.jpg',
    });
    if (!photo.ok) throw new Error('setup: foto');

    await db.insert(propertyTourNodes).values({ propertyId, propertyMediaId: photo.data.id });

    expect(findBySlug(await snapshot(), 'es', 'lote-nosara')?.tour).toBeNull();
  });

  it('no lleva claves de R2 ni ids de la base', async () => {
    /*
     * Otra propiedad con su recorrido, para que los ids de los puntos no
     * empiecen en 1: si coincidieran con las claves publicas, la comprobacion
     * de abajo pasaria sola y no demostraria nada.
     */
    const decoy = await newProperty();
    await node(decoy, await panorama(decoy, 'otra-a'));
    await node(decoy, await panorama(decoy, 'otra-b'));

    const propertyId = await publishedProperty();

    const entrada = await node(propertyId, await panorama(propertyId, 'entrada'), {
      nameEs: 'Entrada',
    });
    const mirador = await node(propertyId, await panorama(propertyId, 'mirador'), {
      nameEs: 'Mirador',
    });
    await createTourLink(db, propertyId, { fromNodeId: entrada, toNodeId: mirador });

    const tour = findBySlug(await snapshot(), 'es', 'lote-nosara')?.tour;
    const json = JSON.stringify(tour);

    // Las claves son la posicion dentro del recorrido, no el numero de fila.
    expect(entrada).toBeGreaterThan(2);
    expect(tour?.nodes.map((item) => item.key)).toEqual(['1', '2']);
    expect(json).not.toContain(`"to":"${mirador}"`);

    expect(json).not.toContain('objectKey');
    expect(json).not.toContain('panorama/entrada.jpg');
    expect(Object.keys(tour?.nodes[0] ?? {}).sort()).toEqual(
      ['initialView', 'key', 'links', 'name', 'url'].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Mapa publico                                                               */
/* -------------------------------------------------------------------------- */

describe('el mapa publico', () => {
  /** Los puntos que el mapa pintaria a partir del snapshot. */
  async function points(locale: 'es' | 'en' = 'es') {
    return mapPointsOf(catalogueOf(await snapshot(), locale), () => null);
  }

  it('situa una propiedad publicada con coordenada publica', async () => {
    await publishedProperty();

    const placed = await points();

    expect(placed).toHaveLength(1);
    // La publica era 9.951 / -85.653; la privada, 9.9512 / -85.6531.
    expect(placed[0]?.latitude).toBe(9.951);
    expect(placed[0]?.longitude).toBe(-85.653);
  });

  it('una en borrador no llega ni al snapshot ni al mapa', async () => {
    const propertyId = await publishedProperty();
    await setStatus(propertyId, 'draft');

    expect(await points()).toEqual([]);
  });

  it('una vendida y oculta tampoco se situa', async () => {
    const propertyId = await publishedProperty();
    await setStatus(propertyId, 'published', 'sold');

    expect(await points()).toEqual([]);
  });

  it('una publicada SIN coordenada publica no se situa, aunque tenga privada', async () => {
    const propertyId = await newProperty();

    await updateProperty(db, propertyId, {
      // Solo la privada: es justo el caso que no debe filtrarse.
      privateLatitude: 9.9512,
      privateLongitude: -85.6531,
      province: 'Guanacaste',
      canton: 'Nicoya',
    });

    await translate(propertyId, 'es', { slug: 'sin-coordenada', title: 'Sin coordenada' });
    await setStatus(propertyId, 'published');

    const data = await snapshot();

    // Sigue en el catalogo; simplemente no esta en el mapa.
    expect(catalogueOf(data, 'es')).toHaveLength(1);
    expect(findBySlug(data, 'es', 'sin-coordenada')?.location.coordinates).toBeNull();
    expect(mapPointsOf(catalogueOf(data, 'es'), () => null)).toEqual([]);
  });

  it('la precision viaja tal cual esta guardada', async () => {
    const propertyId = await publishedProperty();
    await updateProperty(db, propertyId, { locationPrecision: 'approximate' });

    expect((await points())[0]?.precision).toBe('approximate');
  });

  it('el mapa se llena en los dos idiomas, cada uno con sus textos', async () => {
    const propertyId = await publishedProperty();
    await translate(propertyId, 'en', { slug: 'ocean-view-lot', title: 'Ocean view lot' });

    expect((await points('es'))[0]?.title).toBe('Lote con vista al mar');
    expect((await points('es'))[0]?.href).toBe('/es/propiedades/lote-nosara');
    expect((await points('en'))[0]?.title).toBe('Ocean view lot');
    expect((await points('en'))[0]?.href).toBe('/en/propiedades/ocean-view-lot');
  });

  it('lo que se pinta no lleva ni el rastro de la coordenada privada', async () => {
    const propertyId = await publishedProperty();
    await updateProperty(db, propertyId, { locationPrecision: 'approximate' });

    const json = JSON.stringify(await points());

    expect(json).not.toContain('privateLatitude');
    expect(json).not.toContain('privateLongitude');
    // Ni el valor concreto, que es lo unico que de verdad importa.
    expect(json).not.toContain('9.9512');
    expect(json).not.toContain('-85.6531');
  });
});

/* -------------------------------------------------------------------------- */
/* Portada                                                                    */
/* -------------------------------------------------------------------------- */

describe('las destacadas de la portada', () => {
  /** Marca una propiedad como destacada, como haria el panel. */
  async function feature(propertyId: number): Promise<void> {
    await db.update(properties).set({ isFeatured: true }).where(eq(properties.id, propertyId));
  }

  async function featured(locale: 'es' | 'en' = 'es') {
    return featuredOf(catalogueOf(await snapshot(), locale));
  }

  it('una publicada y marcada encabeza la portada', async () => {
    const propertyId = await publishedProperty();
    await feature(propertyId);

    expect((await featured()).map((item) => item.slug)).toEqual(['lote-nosara']);
  });

  it('una publicada sin marcar no sale, aunque este en el catalogo', async () => {
    await publishedProperty();

    expect(await featured()).toEqual([]);
    expect(catalogueOf(await snapshot(), 'es')).toHaveLength(1);
  });

  it('una destacada en borrador no sale por ninguna parte', async () => {
    const propertyId = await publishedProperty();
    await feature(propertyId);
    await setStatus(propertyId, 'draft');

    expect(await featured()).toEqual([]);
  });

  it('una destacada VENDIDA y oculta no sale: la marca no salta la visibilidad', async () => {
    const propertyId = await publishedProperty();
    await feature(propertyId);
    await setStatus(propertyId, 'published', 'sold');

    // `show_when_sold` sigue en falso: la regla de visibilidad manda.
    expect(await featured()).toEqual([]);
  });

  it('una vendida que se publica a proposito si puede encabezar', async () => {
    const propertyId = await publishedProperty();
    await feature(propertyId);
    await db
      .update(properties)
      .set({ commercialStatus: 'sold', showWhenSold: true })
      .where(eq(properties.id, propertyId));

    expect((await featured()).map((item) => item.slug)).toEqual(['lote-nosara']);
  });

  it('la portada se queda en tres aunque haya mas marcadas', async () => {
    for (let index = 0; index < 5; index += 1) {
      const propertyId = await publishedProperty(`destacada-${index}`);
      await feature(propertyId);
    }

    expect(await featured()).toHaveLength(3);
  });

  it('los textos del negocio llegan por idioma, y sin ellos no hay hueco', async () => {
    await db.insert(siteSettings).values({ id: 1, businessName: 'Loba Costa Rica' });
    await db.insert(siteSettingTranslations).values([
      { siteSettingsId: 1, locale: 'es', homeHeroTitle: 'Nuestra costa' },
      { siteSettingsId: 1, locale: 'en', homeHeroTitle: 'Our coast' },
    ]);

    const site = (await snapshot()).site;

    expect(site.businessName).toBe('Loba Costa Rica');
    expect(site.texts.es.heroTitle).toBe('Nuestra costa');
    expect(site.texts.en.heroTitle).toBe('Our coast');
    // Lo que nadie ha escrito llega vacio, y la pagina pone lo suyo.
    expect(site.texts.es.heroSubtitle).toBeNull();
  });

  it('sin configuracion ninguna, el sitio se construye igual', async () => {
    const site = (await snapshot()).site;

    expect(site.businessName).toBeNull();
    expect(site.texts.es.heroTitle).toBeNull();
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

  it('no lleva nada de revisiones ni tokens', async () => {
    const json = JSON.stringify(await fullSnapshot());

    for (const forbidden of ['token', 'Token', 'review', 'Review']) {
      expect(json).not.toContain(forbidden);
    }
  });

  /*
   * Desde 4F el snapshot SI lleva una seccion `contact`, pero con los canales
   * publicos del negocio, no con las consultas de nadie. Estos dos tests
   * separan una cosa de la otra, que es lo que el antiguo "no contiene la
   * palabra contact" no distinguia.
   */
  it('publica los canales del negocio, y no sus buzones internos', async () => {
    await db.insert(siteSettings).values({
      id: 1,
      businessName: 'Loba',
      phone: '+506 2222 2222',
      whatsapp: '+506 8888 8888',
      email: 'hola@codeloba.test',
      // Los dos internos: uno para revisar borradores, otro para los avisos.
      reviewerEmail: 'revision-interna@codeloba.test',
      notificationsEmail: 'avisos-internos@codeloba.test',
    });

    const json = JSON.stringify(await snapshot());

    expect(json).toContain('hola@codeloba.test');
    expect(json).toContain('+506 8888 8888');

    expect(json).not.toContain('revision-interna@codeloba.test');
    expect(json).not.toContain('avisos-internos@codeloba.test');
    expect(json).not.toContain('reviewerEmail');
    expect(json).not.toContain('notificationsEmail');
  });

  it('no lleva ninguna consulta recibida', async () => {
    await createLead(db, {
      name: 'Ana Rojas',
      method: 'email',
      contactValue: 'ana@example.com',
      message: 'Mensaje privado de una persona.',
      locale: 'es',
      consent: true,
    });

    const json = JSON.stringify(await fullSnapshot());

    // Quien escribe a la web no aparece en el sitio publico, faltaria mas.
    expect(json).not.toContain('Ana Rojas');
    expect(json).not.toContain('ana@example.com');
    expect(json).not.toContain('Mensaje privado');
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
        'tour',
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
