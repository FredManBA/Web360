/**
 * Tests del shell publico y de la pagina de catalogo.
 *
 * Navegacion e idiomas se prueban por comportamiento; la estructura de las
 * plantillas, sobre el fuente, como en el resto del proyecto. Sin navegador y
 * sin dependencias nuevas.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { labelsFor } from './labels';
import { LANGUAGE_STORAGE_KEY, languageOptions, navigationFor } from './navigation';
import {
  alternateHref,
  catalogueOf,
  EMPTY_CONTACT,
  EMPTY_SITE,
  type PublicSnapshot,
} from './read-model';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const LAYOUT = 'src/layouts/PublicLayout.astro';
const HEADER = 'src/components/public/SiteHeader.astro';
const FOOTER = 'src/components/public/SiteFooter.astro';
const CARD = 'src/components/public/PropertyCard.astro';
const CATALOGUE_ES = 'src/pages/es/propiedades/index.astro';
const CATALOGUE_EN = 'src/pages/en/propiedades/index.astro';
const DETAIL_ES = 'src/pages/es/propiedades/[slug].astro';
const CSS = 'src/styles/global.css';

/* -------------------------------------------------------------------------- */
/* Navegacion                                                                 */
/* -------------------------------------------------------------------------- */

describe('navegacion', () => {
  it('tiene las tres secciones, en los dos idiomas', () => {
    expect(navigationFor('es').map((item) => item.label)).toEqual([
      'Propiedades',
      'Mapa',
      'Contacto',
    ]);
    expect(navigationFor('en').map((item) => item.label)).toEqual(['Properties', 'Map', 'Contact']);
  });

  it('las tres secciones enlazan: desde 4F ya existen todas', () => {
    const items = navigationFor('es');

    expect(items.every((item) => item.available)).toBe(true);
  });

  it('cada idioma apunta a su propio arbol', () => {
    expect(navigationFor('es')[0]?.href).toBe('/es/propiedades');
    expect(navigationFor('en')[0]?.href).toBe('/en/propiedades');
    expect(navigationFor('es')[1]?.href).toBe('/es/mapa');
    expect(navigationFor('en')[1]?.href).toBe('/en/map');
  });

  it('la seccion activa se marca en el HTML', () => {
    const header = read(HEADER);

    expect(header).toContain("aria-current={item.id === section ? 'page' : undefined}");
    expect(header).toContain("class={item.id === section ? 'is-current' : undefined}");
  });

  it('en escritorio el menu se ve entero, aunque el `<details>` este cerrado', () => {
    const css = read(CSS);

    /*
     * El navegador esconde el contenido de un `<details>` cerrado con
     * `content-visibility`, y ningun `display` de dentro lo anula: sin esto,
     * la navegacion de escritorio no se ve.
     */
    expect(css).toContain('.site-nav-toggle::details-content');
    expect(css).toContain('content-visibility: visible');
    // Y en movil vuelve a cerrarse, que es donde el menu sirve de algo.
    expect(css).toContain('.site-nav-toggle:not([open])::details-content');
  });

  it('lo que no existe se muestra pero no lleva a un 404', () => {
    const header = read(HEADER);

    expect(header).toContain('site-nav-pending');
    expect(header).toContain('aria-disabled="true"');
    expect(header).toContain('labels.comingSoon');
  });
});

describe('recuento de resultados', () => {
  it('el recuento sale del servidor con el total publicado', () => {
    for (const page of [CATALOGUE_ES, CATALOGUE_EN]) {
      expect(read(page)).toContain('{labels.results(properties.length)}');
    }
  });

  it('cada idioma tiene su singular y su plural', () => {
    expect(labelsFor('es').results(1)).toBe('1 propiedad');
    expect(labelsFor('es').results(4)).toBe('4 propiedades');
    expect(labelsFor('en').results(1)).toBe('1 property');
    expect(labelsFor('en').results(4)).toBe('4 properties');
  });
});

describe('el nombre del negocio', () => {
  it('lo pone la configuracion, no la plantilla', () => {
    const header = read(HEADER);
    const footer = read(FOOTER);

    // Antes de 5A estaba escrito a mano en las dos, y no seguia al panel.
    expect(header).toContain('brand: string');
    expect(header).toContain('{brand}');
    expect(header).not.toContain('>Loba<');

    expect(footer).toContain('brand: string');
    expect(footer).toContain('{brand}');
    expect(footer).not.toContain('>Loba<');
  });

  it('el shell lo resuelve una sola vez, donde pasan todas las paginas', () => {
    const layout = read(LAYOUT);

    expect(layout).toContain('site.businessName');
    // Sin configurar, el sitio no se queda sin marca.
    expect(layout).toContain('labelsFor(locale).brandName');
    expect(layout).toContain('brand={brand}');
  });

  it('la inicial del distintivo sale del propio nombre', () => {
    // Una "L" fija junto a otro nombre quedaria absurda.
    expect(read(HEADER)).toContain('brand.trim().charAt(0)');
  });
});

/* -------------------------------------------------------------------------- */
/* Idiomas                                                                    */
/* -------------------------------------------------------------------------- */

describe('selector de idioma', () => {
  it('ofrece el otro idioma, no el actual', () => {
    const [current, other] = languageOptions('es', '/en/propiedades');

    expect(current?.locale).toBe('es');
    expect(current?.current).toBe(true);
    expect(other?.locale).toBe('en');
    expect(other?.label).toBe('English');
  });

  it('lleva a la version equivalente cuando existe', () => {
    const [, other] = languageOptions('es', '/en/propiedades/ocean-view-lot');

    expect(other?.href).toBe('/en/propiedades/ocean-view-lot');
  });

  it('sin equivalente, lleva al catalogo en vez de inventar una URL', () => {
    const [, other] = languageOptions('es', null);

    expect(other?.href).toBe('/en/propiedades');
  });

  it('mantiene los prefijos de idioma', () => {
    expect(languageOptions('en', null)[1]?.href.startsWith('/es/')).toBe(true);
    expect(languageOptions('es', null)[1]?.href.startsWith('/en/')).toBe(true);
  });

  it('la preferencia se guarda con una clave propia', () => {
    expect(LANGUAGE_STORAGE_KEY).toContain('codeloba');
  });

  it('solo se recuerda cuando alguien elige de verdad', () => {
    const module = read('src/lib/public/language-preference.ts');

    // Se engancha al clic del selector, no a la simple visita.
    expect(module).toContain("addEventListener('click'");
    expect(module).toContain('storeLanguagePreference');
    // Y no mueve a nadie de pagina por su cuenta.
    expect(module).not.toContain('location.replace');
    expect(module).not.toContain('location.href =');
  });

  it('sin almacenamiento disponible, el sitio sigue funcionando', () => {
    const module = read('src/lib/public/language-preference.ts');

    expect(module).toContain('catch');
  });
});

/* -------------------------------------------------------------------------- */
/* Equivalencia entre idiomas                                                 */
/* -------------------------------------------------------------------------- */

describe('la misma ficha en el otro idioma', () => {
  function snapshotWith(es: string[], en: string[]): PublicSnapshot {
    const build = (slug: string, code: string) =>
      ({ slug, code, href: `/x/${slug}` }) as unknown as PublicSnapshot['properties']['es'][number];

    return {
      generatedAt: '2026-01-01T00:00:00.000Z',
      properties: {
        es: es.map((slug, index) => build(slug, `LOBA-00${index + 1}`)),
        en: en.map((slug, index) => build(slug, `LOBA-00${index + 1}`)),
      },
      contact: EMPTY_CONTACT,
      site: EMPTY_SITE,
    };
  }

  it('se correlaciona por el codigo, no por el slug', () => {
    const snapshot = snapshotWith(['lote-uno'], ['lot-one']);

    expect(alternateHref(snapshot, 'es', 'lote-uno')).toBe('/x/lot-one');
  });

  it('sin traduccion, no hay equivalente', () => {
    const snapshot = snapshotWith(['lote-uno'], []);

    expect(alternateHref(snapshot, 'es', 'lote-uno')).toBeNull();
  });

  it('una ficha que no existe tampoco tiene equivalente', () => {
    const snapshot = snapshotWith(['lote-uno'], ['lot-one']);

    expect(alternateHref(snapshot, 'es', 'no-existe')).toBeNull();
  });

  it('funciona en las dos direcciones', () => {
    const snapshot = snapshotWith(['lote-uno'], ['lot-one']);

    expect(alternateHref(snapshot, 'en', 'lot-one')).toBe('/x/lote-uno');
  });
});

/* -------------------------------------------------------------------------- */
/* Textos                                                                     */
/* -------------------------------------------------------------------------- */

describe('todo el texto publico esta en los dos idiomas', () => {
  it('ningun texto se queda sin traducir', () => {
    const es = labelsFor('es');
    const en = labelsFor('en');

    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());

    /*
     * Lo que de verdad se escribe igual en los dos idiomas. Son nombres
     * propios, no textos sin traducir: traducir "WhatsApp" o el nombre del
     * negocio seria un error.
     */
    const sameInBoth = new Set(['code', 'contactWhatsapp', 'brandName']);

    for (const key of Object.keys(es) as (keyof typeof es)[]) {
      const spanish = es[key];
      const english = en[key];

      if (typeof spanish === 'string' && typeof english === 'string') {
        expect(spanish.length).toBeGreaterThan(0);
        expect(english.length).toBeGreaterThan(0);
        // Y no es el mismo texto copiado de un idioma al otro.
        if (!sameInBoth.has(key)) expect(spanish).not.toBe(english);
      }
    }
  });

  it('el recuento concuerda en singular y plural', () => {
    expect(labelsFor('es').results(1)).toBe('1 propiedad');
    expect(labelsFor('es').results(4)).toBe('4 propiedades');
    expect(labelsFor('en').results(1)).toBe('1 property');
    expect(labelsFor('en').results(4)).toBe('4 properties');
  });
});

/* -------------------------------------------------------------------------- */
/* Catalogo                                                                   */
/* -------------------------------------------------------------------------- */

describe('pagina de catalogo', () => {
  it('usa el shell publico y marca su seccion', () => {
    for (const page of [CATALOGUE_ES, CATALOGUE_EN]) {
      const source = read(page);

      expect(source).toContain('PublicLayout');
      expect(source).toContain('section="properties"');
      expect(source).toContain('alternatePath:');
    }
  });

  it('se resuelve en runtime', () => {
    for (const page of [CATALOGUE_ES, CATALOGUE_EN, DETAIL_ES]) {
      expect(read(page)).toContain('prerender = false');
    }
  });

  it('se ven todas las tarjetas, sin filtros ni paginacion', () => {
    for (const page of [CATALOGUE_ES, CATALOGUE_EN]) {
      const source = read(page);

      // El servidor pinta la lista entera; no hay modulo que la recorte.
      expect(source).toContain('properties.map((property)');
      expect(source).not.toContain('.slice(');
      expect(source).not.toContain('CatalogueControls');
      expect(source).not.toContain('catalogue-page');
    }

    // La tarjeta no nace oculta (`aria-hidden` del enlace decorativo no cuenta).
    expect(read(CARD)).not.toMatch(/<article[^>]*\shidden/);
  });

  it('sin nada publicado se dice, y una tarjeta sin foto no deja hueco', () => {
    expect(read(CATALOGUE_ES)).toContain('labels.empty');
    expect(read(CARD)).toContain('property-card-placeholder');
  });
});

/* -------------------------------------------------------------------------- */
/* Accesibilidad y rendimiento                                                */
/* -------------------------------------------------------------------------- */

describe('accesibilidad y peso', () => {
  it('hay un enlace para saltar al contenido', () => {
    expect(read(HEADER)).toContain('skip-link');
    expect(read(HEADER)).toContain('href="#contenido"');
    expect(read(LAYOUT)).toContain('id="contenido"');
  });

  it('la navegacion se anuncia', () => {
    expect(read(HEADER)).toContain('aria-label={labels.mainNavigation}');
  });

  it('el menu movil funciona sin JavaScript', () => {
    const header = read(HEADER);

    expect(header).toContain('<details class="site-nav-toggle">');
    expect(header).toContain('<summary');
  });

  it('el foco es siempre visible y se respeta quien pide menos movimiento', () => {
    const css = read(CSS);

    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('el idioma del documento acompaña a la ruta', () => {
    expect(read(LAYOUT)).toContain('<html lang={locale}>');
  });

  it('la pagina no arrastra ninguna libreria de interfaz', () => {
    const manifest = read('package.json');

    for (const forbidden of ['react', 'vue', 'svelte', 'tailwind', 'bootstrap']) {
      expect(manifest).not.toContain(`"${forbidden}"`);
    }
  });

  it('el pie es el mismo en las dos versiones', () => {
    expect(read(FOOTER)).toContain('labels.footerNote');
  });
});

/* -------------------------------------------------------------------------- */
/* Direccion visual                                                           */
/* -------------------------------------------------------------------------- */

describe('sistema visual', () => {
  it('la paleta aprobada esta en los tokens', () => {
    const css = read(CSS);

    for (const token of ['--jungle', '--ivory', '--sand', '--ink']) {
      expect(css).toContain(`${token}:`);
    }
  });

  it('serif para los titulos y sans para la interfaz', () => {
    const css = read(CSS);

    expect(css).toContain('--font-display');
    expect(css).toContain('--font-base');
    expect(css).toContain('font-family: var(--font-display)');
  });

  it('las familias son del sistema: no se descarga ninguna tipografia', () => {
    const css = read(CSS);

    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('fonts.googleapis');
  });

  it('el catalogo respeta el lazy/eager de la fase anterior', () => {
    const image = read('src/components/public/PropertyImage.astro');

    expect(image).toContain("loading={priority ? 'eager' : 'lazy'}");
  });
});

/* -------------------------------------------------------------------------- */
/* Coherencia con el snapshot                                                 */
/* -------------------------------------------------------------------------- */

describe('coherencia', () => {
  it('el catalogo se sigue leyendo del snapshot', () => {
    expect(read(CATALOGUE_ES)).toContain('loadRuntimePublicSnapshot');
    expect(read(CATALOGUE_ES)).toContain('catalogueOf(snapshot, locale)');
    expect(typeof catalogueOf).toBe('function');
  });
});
