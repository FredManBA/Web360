/**
 * Tests del snapshot de build y de las paginas publicas.
 *
 * El snapshot se prueba por su comportamiento (que aguante no encontrar base)
 * y las paginas por su estructura, como en el resto del proyecto: sin
 * navegador y sin dependencias nuevas.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EMPTY_SNAPSHOT } from './read-model';
import { findLocalDatabaseFile, readLocalSnapshot } from './snapshot-source';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const CATALOGUE_ES = 'src/pages/es/propiedades/index.astro';
const CATALOGUE_EN = 'src/pages/en/propiedades/index.astro';
const DETAIL_ES = 'src/pages/es/propiedades/[slug].astro';
const DETAIL_EN = 'src/pages/en/propiedades/[slug].astro';
const CARD = 'src/components/public/PropertyCard.astro';
const DETAIL_COMPONENT = 'src/components/public/PropertyDetail.astro';
const READ_MODEL = 'src/lib/public/read-model.ts';
const SNAPSHOT = 'src/lib/public/snapshot.ts';
const SOURCE = 'src/lib/public/snapshot-source.ts';
const PLUGIN = 'src/lib/public/snapshot-plugin.ts';
const ASTRO_CONFIG = 'astro.config.mjs';

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
  temporary.length = 0;
});

function fakeRoot(withDatabase: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), 'codeloba-snapshot-'));
  temporary.push(root);

  if (withDatabase) {
    const directory = path.join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'metadata.sqlite'), '');
    writeFileSync(path.join(directory, 'abc123.sqlite'), '');
  }

  return root;
}

/* -------------------------------------------------------------------------- */
/* Localizar la base                                                          */
/* -------------------------------------------------------------------------- */

describe('base local de D1', () => {
  it('sin carpeta de estado no hay base', () => {
    expect(findLocalDatabaseFile(fakeRoot(false))).toBeNull();
  });

  it('encuentra el fichero de la base y descarta el de metadatos', () => {
    const found = findLocalDatabaseFile(fakeRoot(true));

    expect(found).not.toBeNull();
    expect(found).toContain('abc123.sqlite');
    expect(found).not.toContain('metadata.sqlite');
  });
});

/* -------------------------------------------------------------------------- */
/* Cargar el snapshot                                                         */
/* -------------------------------------------------------------------------- */

describe('snapshot de build', () => {
  it('tiene los dos idiomas aunque no haya nada publicado', () => {
    expect(EMPTY_SNAPSHOT.properties.es).toEqual([]);
    expect(EMPTY_SNAPSHOT.properties.en).toEqual([]);
  });

  it('devuelve algo utilizable pase lo que pase', async () => {
    const snapshot = await readLocalSnapshot();

    expect(Array.isArray(snapshot.properties.es)).toBe(true);
    expect(Array.isArray(snapshot.properties.en)).toBe(true);
    expect(typeof snapshot.generatedAt).toBe('string');
  });

  it('el plugin lo lee una sola vez, al empezar el build', () => {
    const plugin = read(PLUGIN);

    expect(plugin).toContain('buildStart()');
    expect(plugin).toContain('pending ??= readLocalSnapshot()');
  });
});

/* -------------------------------------------------------------------------- */
/* Arquitectura                                                               */
/* -------------------------------------------------------------------------- */

describe('el sitio publico sigue siendo estatico', () => {
  it('ninguna pagina publica se pasa a ejecucion bajo demanda', () => {
    for (const page of [CATALOGUE_ES, CATALOGUE_EN, DETAIL_ES, DETAIL_EN]) {
      expect(read(page)).not.toContain('prerender = false');
    }
  });

  it('las paginas no llaman a la API del admin', () => {
    for (const page of [CATALOGUE_ES, CATALOGUE_EN, DETAIL_ES, DETAIL_EN]) {
      const source = read(page);
      expect(source).not.toContain('/api/admin');
      expect(source).not.toContain('fetch(');
    }
  });

  it('las paginas no tocan D1 ni el runtime del Worker', () => {
    for (const page of [CATALOGUE_ES, CATALOGUE_EN, DETAIL_ES, DETAIL_EN]) {
      const source = read(page);
      expect(source).not.toContain('cloudflare:workers');
      expect(source).not.toContain('drizzle');
    }
  });

  it('solo el origen del snapshot sabe de la base local', () => {
    expect(read(SOURCE)).toContain('node:sqlite');

    // Ni el read model ni lo que importan las paginas abren nada.
    expect(read(READ_MODEL)).not.toContain('node:sqlite');
    expect(read(SNAPSHOT)).not.toContain('node:sqlite');
    expect(read(SNAPSHOT)).not.toContain('node:fs');
  });

  it('las paginas reciben datos ya resueltos, no una consulta', () => {
    // El prerenderizado del adaptador ocurre en workerd: alli no hay ficheros.
    expect(read(SNAPSHOT)).toContain("import snapshot from 'virtual:public-snapshot'");
    expect(read(PLUGIN)).toContain('virtual:public-snapshot');
    expect(read(ASTRO_CONFIG)).toContain('publicSnapshotPlugin()');
  });

  it('el origen aisla lo que habra que cambiar para D1 remoto', () => {
    const source = read(SOURCE);

    expect(source).toContain('readLocalSnapshot');
    expect(source).toContain('D1 remoto');
  });

  it('cada ficha se genera desde el snapshot, no en tiempo de peticion', () => {
    for (const page of [DETAIL_ES, DETAIL_EN]) {
      const source = read(page);
      expect(source).toContain('getStaticPaths');
      expect(source).toContain('loadPublicSnapshot');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Paginas                                                                    */
/* -------------------------------------------------------------------------- */

describe('catalogo y ficha', () => {
  it('cada idioma tiene su arbol de rutas', () => {
    expect(read(CATALOGUE_ES)).toContain("const locale = 'es' as const");
    expect(read(CATALOGUE_EN)).toContain("const locale = 'en' as const");
    expect(read(DETAIL_ES)).toContain("catalogueOf(snapshot, 'es')");
    expect(read(DETAIL_EN)).toContain("catalogueOf(snapshot, 'en')");
  });

  it('el catalogo tiene un estado vacio', () => {
    expect(read(CATALOGUE_ES)).toContain('labels.empty');
    expect(read(CATALOGUE_ES)).toContain('properties.length === 0');
  });

  it('la tarjeta muestra lo que pide el catalogo', () => {
    const card = read(CARD);

    expect(card).toContain('property.title');
    expect(card).toContain('labels.code');
    expect(card).toContain('property.propertyType');
    expect(card).toContain('property.price.text');
    expect(card).toContain('property.area');
    expect(card).toContain('property.href');
    expect(card).toContain('commercialStatusLabel');
  });

  it('la ficha trae descripcion, ubicacion y caracteristicas', () => {
    const detail = read(DETAIL_COMPONENT);

    expect(detail).toContain('property.marketingDescription');
    expect(detail).toContain('property.technicalDescription');
    expect(detail).toContain('labels.location');
    expect(detail).toContain('property.features.map');
  });

  it('la ficha deja hueco para multimedia y 360 sin exponer nada', () => {
    const detail = read(DETAIL_COMPONENT);

    expect(detail).toContain('property.media.hasTour');
    expect(detail).toContain('labels.mediaPending');
    // Sin URLs de R2: todavia no hay entrega publica.
    expect(detail).not.toContain('objectKey');
    expect(detail).not.toContain('/api/admin');
  });

  it('el HTML es semantico', () => {
    expect(read(CARD)).toContain('<article');
    expect(read(DETAIL_COMPONENT)).toContain('<h1>');
    expect(read(DETAIL_COMPONENT)).toContain('<section');
    expect(read(CATALOGUE_ES)).toContain('<main');
    expect(read(CATALOGUE_ES)).toContain('<ul class="property-list">');
  });

  it('ninguna plantilla publica pinta datos privados', () => {
    for (const file of [CARD, DETAIL_COMPONENT, CATALOGUE_ES, DETAIL_ES]) {
      const source = read(file);

      for (const forbidden of [
        'privateLatitude',
        'privateLongitude',
        'publicationStatus',
        'objectKey',
        'youtubeVideoId',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});
