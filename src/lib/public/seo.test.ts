/**
 * Tests del SEO publico.
 *
 * Contra SQLite real y el snapshot de verdad, no contra objetos a mano: lo
 * que se quiere comprobar es que por el `<head>`, el JSON-LD y el sitemap sale
 * exactamente lo mismo que ya es publico, y ni un dato mas.
 *
 * Hay un bloque entero dedicado a lo que NO debe aparecer: coordenadas
 * privadas, claves de R2, correos internos y precios que el negocio no ha
 * afirmado.
 */

import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { properties, siteSettings, siteSettingTranslations } from '../../db/schema';
import { createMedia, setMediaRoles } from '../admin/media/media';
import { createPropertyDraft } from '../admin/properties/create-property';
import { updateProperty } from '../admin/properties/update-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import type { AdminBatchDatabase } from '../admin/types';
import type { CommercialStatus, Locale, PublicationStatus } from '../domain/vocabularies';
import {
  buildPublicSnapshot,
  catalogueOf,
  findBySlug,
  type PublicPropertyDetail,
  type PublicSnapshot,
} from './read-model';
import {
  absoluteUrl,
  brandOf,
  factualSummary,
  ogLocale,
  pageTitle,
  propertySeo,
  sectionSeo,
  trimDescription,
  MAX_DESCRIPTION,
} from './seo';
import { renderRobots, renderSitemap, sitemapEntries } from './sitemap';
import {
  canStateCoordinates,
  canStatePrice,
  organizationJsonLd,
  propertyJsonLd,
} from './structured-data';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const SITE = new URL('https://ejemplo.test');

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

interface PropertyOptions {
  slugEs?: string | null;
  slugEn?: string | null;
  marketingEs?: string | null;
  technicalEs?: string | null;
  status?: PublicationStatus;
  commercial?: CommercialStatus;
  showWhenSold?: boolean;
  priceMode?: 'exact' | 'negotiable' | 'contact';
  precision?: 'exact' | 'approximate';
  withImage?: boolean;
}

async function property(options: PropertyOptions = {}): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');

  const id = created.data.id;

  await updateProperty(db, id, {
    propertyTypeId: 1,
    priceMode: options.priceMode ?? 'exact',
    priceAmountMinor: options.priceMode === 'contact' ? null : 18_500_000,
    currencyCode: options.priceMode === 'contact' ? null : 'USD',
    areaSquareMeters: 5200,
    province: 'Guanacaste',
    canton: 'Nicoya',
    district: 'Nosara',
    locality: 'Playa Guiones',
    // Privadas: no deben salir por ninguna parte.
    privateLatitude: 9.951234,
    privateLongitude: -85.653211,
    publicLatitude: 9.951,
    publicLongitude: -85.653,
    locationPrecision: options.precision ?? 'exact',
  });

  if (options.slugEs !== null) {
    await upsertPropertyTranslation(db, id, {
      locale: 'es',
      slug: options.slugEs ?? 'lote-nosara',
      title: 'Lote con vista al mar',
      marketingDescription: options.marketingEs ?? null,
      technicalDescription: options.technicalEs ?? null,
    });
  }

  if (options.slugEn !== undefined && options.slugEn !== null) {
    await upsertPropertyTranslation(db, id, {
      locale: 'en',
      slug: options.slugEn,
      title: 'Lot with ocean view',
    });
  }

  if (options.withImage !== false) {
    const media = await createMedia(db, id, {
      mediaKind: 'image',
      sourceProvider: 'r2',
      objectKey: `propiedades/${id}/portada-secreta.jpg`,
      altTextEs: 'Vista del lote',
    });
    if (!media.ok) throw new Error('setup: archivo');

    await setMediaRoles(db, id, media.data.id, { isHero: true, isCatalogCover: true });
  }

  await db
    .update(properties)
    .set({
      publicationStatus: options.status ?? 'published',
      commercialStatus: options.commercial ?? 'available',
      showWhenSold: options.showWhenSold ?? false,
    })
    .where(eq(properties.id, id));

  return id;
}

async function configureSite(): Promise<void> {
  await db
    .insert(siteSettings)
    .values({ id: 1, businessName: 'Loba', email: 'hola@ejemplo.test' })
    .onConflictDoUpdate({
      target: siteSettings.id,
      set: { businessName: 'Loba', email: 'hola@ejemplo.test' },
    });

  await db.insert(siteSettingTranslations).values({
    siteSettingsId: 1,
    locale: 'es',
    brandTagline: 'Terrenos con vista al Pacífico.',
  });
}

async function snapshot(): Promise<PublicSnapshot> {
  return buildPublicSnapshot(db);
}

async function detail(locale: Locale = 'es', slug = 'lote-nosara'): Promise<PublicPropertyDetail> {
  const found = findBySlug(await snapshot(), locale, slug);
  if (found === null) throw new Error('setup: ficha');

  return found;
}

/* -------------------------------------------------------------------------- */
/* Textos                                                                     */
/* -------------------------------------------------------------------------- */

describe('los textos del <head>', () => {
  it('el titulo lleva la marca detras, y no la repite', () => {
    expect(pageTitle('Propiedades', 'Loba')).toBe('Propiedades · Loba');
    expect(pageTitle('Loba · Propiedades', 'Loba')).toBe('Loba · Propiedades');
  });

  it('la descripcion se recorta por palabras y sin dejar una a medias', () => {
    const largo = `${'palabra '.repeat(40)}final`;
    const corta = trimDescription(largo) ?? '';

    expect(corta.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(corta.endsWith('…')).toBe(true);
    expect(corta).not.toMatch(/pala…$/);
  });

  it('un texto vacio no se convierte en una descripcion vacia', () => {
    expect(trimDescription('   ')).toBeNull();
    expect(trimDescription(null)).toBeNull();
  });

  it('og:locale lleva el territorio de cada idioma', () => {
    expect(ogLocale('es')).toBe('es_CR');
    expect(ogLocale('en')).toBe('en_US');
  });
});

/* -------------------------------------------------------------------------- */
/* La ficha                                                                   */
/* -------------------------------------------------------------------------- */

describe('el SEO de una ficha', () => {
  it('usa el titulo publicado de ESE idioma', async () => {
    await property({ slugEn: 'lot-nosara' });
    const snap = await snapshot();

    const es = propertySeo(findBySlug(snap, 'es', 'lote-nosara')!, 'es', 'Loba', null);
    const en = propertySeo(findBySlug(snap, 'en', 'lot-nosara')!, 'en', 'Loba', null);

    expect(es.title).toBe('Lote con vista al mar · Loba');
    expect(en.title).toBe('Lot with ocean view · Loba');
  });

  it('la descripcion sale del texto de marketing cuando lo hay', async () => {
    await property({ marketingEs: 'Media hectárea a diez minutos de la playa.' });

    const seo = propertySeo(await detail(), 'es', 'Loba', null);

    expect(seo.description).toBe('Media hectárea a diez minutos de la playa.');
  });

  it('sin marketing cae al texto tecnico', async () => {
    await property({ marketingEs: null, technicalEs: 'Frente de 40 m, acceso lastreado.' });

    const seo = propertySeo(await detail(), 'es', 'Loba', null);

    expect(seo.description).toBe('Frente de 40 m, acceso lastreado.');
  });

  it('y sin ninguno de los dos, a los datos ya publicados', async () => {
    await property({ marketingEs: null, technicalEs: null });
    const ficha = await detail();

    const seo = propertySeo(ficha, 'es', 'Loba', null);

    expect(seo.description).toBe(factualSummary(ficha));
    expect(seo.description).toContain('Playa Guiones');
    // Nada inventado: solo tipo, lugar y superficie.
    expect(seo.description).toContain(ficha.area?.text ?? '');
  });

  it('la canonica es la de su propio idioma', async () => {
    await property({ slugEn: 'lot-nosara' });
    const snap = await snapshot();

    expect(propertySeo(findBySlug(snap, 'es', 'lote-nosara')!, 'es', 'Loba', null).path).toBe(
      '/es/propiedades/lote-nosara',
    );
    expect(propertySeo(findBySlug(snap, 'en', 'lot-nosara')!, 'en', 'Loba', null).path).toBe(
      '/en/propiedades/lot-nosara',
    );
  });

  it('la imagen social es la portada publica, nunca una clave de R2', async () => {
    await property();

    const seo = propertySeo(await detail(), 'es', 'Loba', null);

    expect(seo.imagePath).toMatch(/^\/media\/\d+$/);
    expect(seo.imagePath).not.toContain('portada-secreta');
    expect(seo.imageAlt).toBe('Vista del lote');
  });

  it('sin imagen no se declara ninguna', async () => {
    await property({ withImage: false });

    const seo = propertySeo(await detail(), 'es', 'Loba', null);

    expect(seo.imagePath).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* La imagen social del sitio                                                 */
/* -------------------------------------------------------------------------- */

describe('la imagen social configurada', () => {
  const SOCIAL = '/site-media/social?v=123';

  it('la usan las paginas que no tienen portada propia', () => {
    const seo = sectionSeo({
      locale: 'es',
      brand: 'Loba',
      title: 'Mapa',
      description: null,
      path: '/es/mapa',
      alternatePath: '/en/map',
      socialImage: SOCIAL,
    });

    expect(seo.imagePath).toBe(SOCIAL);
    expect(seo.imageAlt).toBe('Loba');
  });

  it('sin configurar, esas paginas no declaran imagen', () => {
    const seo = sectionSeo({
      locale: 'es',
      brand: 'Loba',
      title: 'Mapa',
      description: null,
      path: '/es/mapa',
      alternatePath: '/en/map',
    });

    expect(seo.imagePath).toBeNull();
  });

  it('la portada de la propiedad MANDA sobre la del sitio', async () => {
    await property();

    const seo = propertySeo(await detail(), 'es', 'Loba', null, SOCIAL);

    expect(seo.imagePath).toMatch(/^\/media\/\d+$/);
    expect(seo.imagePath).not.toBe(SOCIAL);
  });

  it('y solo entra cuando la ficha no tiene ninguna', async () => {
    await property({ withImage: false });

    const seo = propertySeo(await detail(), 'es', 'Loba', null, SOCIAL);

    expect(seo.imagePath).toBe(SOCIAL);
    expect(seo.imageAlt).toBe('Loba');
  });
});

/* -------------------------------------------------------------------------- */
/* Idiomas                                                                    */
/* -------------------------------------------------------------------------- */

describe('canonical y hreflang', () => {
  it('las dos versiones se apuntan mutuamente cuando ambas existen', async () => {
    await property({ slugEn: 'lot-nosara' });
    const snap = await snapshot();

    const es = catalogueOf(snap, 'es')[0];
    const en = catalogueOf(snap, 'en')[0];

    expect(es?.href).toBe('/es/propiedades/lote-nosara');
    expect(en?.href).toBe('/en/propiedades/lot-nosara');
  });

  it('sin traduccion en el otro idioma NO se declara alternate', async () => {
    await property({ slugEn: null });
    const snap = await snapshot();

    expect(catalogueOf(snap, 'en')).toHaveLength(0);

    const seo = propertySeo(findBySlug(snap, 'es', 'lote-nosara')!, 'es', 'Loba', null);
    expect(seo.alternatePath).toBeNull();
  });

  it('una seccion siempre existe en los dos idiomas', () => {
    const seo = sectionSeo({
      locale: 'es',
      brand: 'Loba',
      title: 'Mapa',
      description: 'Dónde está cada propiedad.',
      path: '/es/mapa',
      alternatePath: '/en/map',
    });

    expect(seo.path).toBe('/es/mapa');
    expect(seo.alternatePath).toBe('/en/map');
    expect(seo.indexable).toBe(true);
  });

  it('las rutas se vuelven absolutas solo si hay dominio', () => {
    expect(absoluteUrl(undefined, '/es/mapa')).toBe('/es/mapa');
    expect(absoluteUrl(SITE, '/es/mapa')).toBe('https://ejemplo.test/es/mapa');
  });
});

/* -------------------------------------------------------------------------- */
/* Visibilidad                                                                */
/* -------------------------------------------------------------------------- */

describe('que llega a tener ficha', () => {
  it('una propiedad no publicada no genera ninguna', async () => {
    await property({ status: 'approved' });
    const snap = await snapshot();

    expect(catalogueOf(snap, 'es')).toHaveLength(0);
    expect(sitemapEntries(snap).some((entry) => entry.path.includes('lote-nosara'))).toBe(false);
  });

  it('una vendida que el admin decide mostrar sigue siendo indexable', async () => {
    await property({ commercial: 'sold', showWhenSold: true });
    const snap = await snapshot();

    const ficha = findBySlug(snap, 'es', 'lote-nosara');
    expect(ficha).not.toBeNull();
    expect(propertySeo(ficha!, 'es', 'Loba', null).indexable).toBe(true);
  });

  it('una vendida que el admin oculta no llega a existir', async () => {
    await property({ commercial: 'sold', showWhenSold: false });
    const snap = await snapshot();

    expect(catalogueOf(snap, 'es')).toHaveLength(0);
    expect(sitemapEntries(snap).some((entry) => entry.path.includes('lote-nosara'))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Datos estructurados                                                        */
/* -------------------------------------------------------------------------- */

describe('el JSON-LD de una ficha', () => {
  async function jsonLdOf(options: PropertyOptions = {}): Promise<Record<string, unknown>> {
    await property(options);
    const ficha = await detail();

    return propertyJsonLd({
      property: ficha,
      locale: 'es',
      url: `https://ejemplo.test${ficha.href}`,
      images: ficha.media.items
        .map((item) => item.url)
        .filter((url): url is string => url !== null),
    });
  }

  it('es un anuncio inmobiliario con lo publicado', async () => {
    const node = await jsonLdOf({ marketingEs: 'Media hectárea junto a la playa.' });

    expect(node['@type']).toBe('RealEstateListing');
    expect(node.name).toBe('Lote con vista al mar');
    expect(node.description).toBe('Media hectárea junto a la playa.');
    expect(node.url).toBe('https://ejemplo.test/es/propiedades/lote-nosara');
    expect(node.inLanguage).toBe('es');
  });

  it('con precio exacto declara la oferta', async () => {
    const node = await jsonLdOf({ priceMode: 'exact' });
    const oferta = node.mainEntity as Record<string, unknown>;

    expect(oferta['@type']).toBe('Offer');
    expect(oferta.price).toBe(185_000);
    expect(oferta.priceCurrency).toBe('USD');
    expect(oferta.availability).toBe('https://schema.org/InStock');
  });

  it('negociable y a consultar NO afirman ningun precio', async () => {
    for (const mode of ['negotiable', 'contact'] as const) {
      const test = createTestDatabase();
      db = test.db;
      applySeed(test.sqlite);

      const node = await jsonLdOf({ priceMode: mode });

      expect(node.mainEntity).toBeUndefined();
      expect(node.about).toBeDefined();
      expect(JSON.stringify(node)).not.toContain('price');
    }
  });

  it('una vendida visible se declara agotada', async () => {
    const node = await jsonLdOf({ commercial: 'sold', showWhenSold: true });
    const oferta = node.mainEntity as Record<string, unknown>;

    expect(oferta.availability).toBe('https://schema.org/SoldOut');
  });

  it('declara las coordenadas PUBLICAS solo si son exactas', async () => {
    const node = await jsonLdOf({ precision: 'exact' });
    const lugar = (node.mainEntity as Record<string, unknown>).itemOffered as Record<
      string,
      unknown
    >;
    const geo = lugar.geo as Record<string, unknown>;

    expect(geo['@type']).toBe('GeoCoordinates');
    expect(geo.latitude).toBe(9.951);
    // Y nunca la privada.
    expect(JSON.stringify(node)).not.toContain('9.951234');
  });

  it('con ubicacion aproximada no declara ninguna', async () => {
    const node = await jsonLdOf({ precision: 'approximate' });
    const lugar = (node.mainEntity as Record<string, unknown>).itemOffered as Record<
      string,
      unknown
    >;

    expect(lugar.geo).toBeUndefined();
    expect(JSON.stringify(node)).not.toContain('GeoCoordinates');
  });

  it('la direccion es la administrativa publica', async () => {
    const node = await jsonLdOf();
    const lugar = (node.mainEntity as Record<string, unknown>).itemOffered as Record<
      string,
      unknown
    >;
    const direccion = lugar.address as Record<string, unknown>;

    expect(direccion.addressCountry).toBe('CR');
    expect(direccion.addressRegion).toBe('Guanacaste');
    expect(direccion.streetAddress).toBe('Playa Guiones');
  });

  it('nunca lleva claves de R2 ni identificadores internos', async () => {
    const node = await jsonLdOf();
    const crudo = JSON.stringify(node);

    expect(crudo).not.toContain('portada-secreta');
    expect(crudo).not.toContain('objectKey');
    expect(crudo).not.toMatch(/"id":/);
  });

  it('las banderas de precio y coordenadas dicen lo mismo que el nodo', async () => {
    await property({ priceMode: 'contact', precision: 'approximate' });
    const ficha = await detail();

    expect(canStatePrice(ficha)).toBe(false);
    expect(canStateCoordinates(ficha)).toBe(false);
  });
});

describe('el JSON-LD de la portada', () => {
  it('no se emite si no hay ni nombre configurado', async () => {
    const snap = await snapshot();

    expect(
      organizationJsonLd({ site: snap.site, contact: snap.contact, locale: 'es', url: '/es/' }),
    ).toBeNull();
  });

  it('con configuracion, declara solo lo que hay', async () => {
    await configureSite();
    const snap = await snapshot();

    const node = organizationJsonLd({
      site: snap.site,
      contact: snap.contact,
      locale: 'es',
      url: 'https://ejemplo.test/es/',
    })!;

    expect(node['@type']).toBe('Organization');
    expect(node.name).toBe('Loba');
    expect(node.description).toBe('Terrenos con vista al Pacífico.');
    expect(node.email).toBe('hola@ejemplo.test');
    // Sin telefono configurado, no se inventa uno.
    expect(node.telephone).toBeUndefined();
    expect(node.address).toBeUndefined();
  });

  it('la marca cae al nombre por defecto del idioma cuando no hay configuracion', async () => {
    const snap = await snapshot();

    expect(brandOf(snap.site, 'es')).toBe('Loba');
  });
});

/* -------------------------------------------------------------------------- */
/* Sitemap y robots                                                           */
/* -------------------------------------------------------------------------- */

describe('el sitemap', () => {
  it('lleva las cuatro secciones de cada idioma', async () => {
    const entries = sitemapEntries(await snapshot());

    expect(entries.map((entry) => entry.path)).toEqual([
      '/es/',
      '/es/propiedades',
      '/es/mapa',
      '/es/contacto',
      '/en/',
      '/en/propiedades',
      '/en/map',
      '/en/contact',
    ]);
  });

  it('anade las fichas publicas y las empareja por idioma', async () => {
    await property({ slugEn: 'lot-nosara' });
    const entries = sitemapEntries(await snapshot());

    const ficha = entries.find((entry) => entry.path === '/es/propiedades/lote-nosara');

    expect(ficha?.alternatePath).toBe('/en/propiedades/lot-nosara');
  });

  it('sin gemela no inventa un alternate', async () => {
    await property({ slugEn: null });
    const entries = sitemapEntries(await snapshot());

    const ficha = entries.find((entry) => entry.path === '/es/propiedades/lote-nosara');

    expect(ficha).toBeDefined();
    expect(ficha?.alternatePath).toBeNull();
  });

  it('nunca lleva admin, revision, API ni archivos', async () => {
    await property({ slugEn: 'lot-nosara' });
    const xml = renderSitemap(sitemapEntries(await snapshot()), SITE);

    for (const prohibido of ['/admin', '/review', '/api', '/media']) {
      expect(xml).not.toContain(prohibido);
    }
  });

  it('sin dominio sale vacio y explica por que, en vez de inventar un host', async () => {
    await property();
    const xml = renderSitemap(sitemapEntries(await snapshot()), undefined);

    expect(xml).toContain('<urlset');
    expect(xml).not.toContain('<url>');
    expect(xml).toContain('Sin dominio configurado');
    // Ni una URL del sitio: solo los espacios de nombres del formato.
    expect(xml).not.toContain('<loc>');
    expect(xml).not.toContain('ejemplo.test');
  });

  it('con dominio, todas las URL son absolutas', async () => {
    await property();
    const xml = renderSitemap(sitemapEntries(await snapshot()), SITE);

    for (const loc of xml.match(/<loc>(.*?)<\/loc>/g) ?? []) {
      expect(loc).toContain('https://ejemplo.test/');
    }

    expect(xml).toContain('<loc>https://ejemplo.test/es/propiedades/lote-nosara</loc>');
  });
});

describe('el robots.txt', () => {
  it('abre lo publico y cierra lo que no es para buscadores', () => {
    const robots = renderRobots(undefined);

    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /admin/');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Disallow: /review/');
  });

  it('apunta al sitemap solo cuando puede dar una URL absoluta', () => {
    expect(renderRobots(undefined)).not.toContain('Sitemap:');
    expect(renderRobots(SITE)).toContain('Sitemap: https://ejemplo.test/sitemap.xml');
  });
});

/* -------------------------------------------------------------------------- */
/* Lo privado sigue fuera                                                     */
/* -------------------------------------------------------------------------- */

describe('las superficies privadas no se indexan', () => {
  it('el panel se declara no indexable', () => {
    expect(read('src/layouts/AdminLayout.astro')).toContain('noindex, nofollow');
  });

  it('la revision tambien, y ademas por cabecera', () => {
    const page = read('src/pages/review/[token].astro');

    expect(page).toContain('noindex, nofollow');
    expect(page).toContain("Astro.response.headers.set('x-robots-tag'");
  });

  it('el sitemap y el robots salen del mismo sitio que el sitio publico', () => {
    expect(read('src/pages/sitemap.xml.ts')).toContain('loadPublicSnapshot()');
    expect(read('src/pages/robots.txt.ts')).toContain('renderRobots');
  });

  it('la plantilla publica decide indexar por pagina', () => {
    const layout = read('src/layouts/PublicLayout.astro');

    expect(layout).toContain("seo.indexable ? 'index, follow' : 'noindex, follow'");
  });
});
