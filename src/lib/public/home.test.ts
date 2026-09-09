/**
 * Tests de la portada.
 *
 * Lo que se decide sin pintar —que propiedades encabezan, con que textos abre
 * el hero, en que idioma se entra por la raiz— se prueba como funcion pura. Lo
 * que solo existe como plantilla se comprueba sobre el fuente, como en el
 * resto del proyecto.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  featuredOf,
  hasPlacedProperties,
  homeCopy,
  MAX_FEATURED,
  resolveRootLocale,
} from './home';
import { labelsFor } from './labels';
import { EMPTY_SITE, type PublicPropertyCard, type PublicSite } from './read-model';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const HOME_ES = 'src/pages/es/index.astro';
const HOME_EN = 'src/pages/en/index.astro';
const ROOT = 'src/pages/index.astro';
const HERO = 'src/components/public/HomeHero.astro';
const INTRO = 'src/components/public/HomeIntro.astro';
const MAP_TEASER = 'src/components/public/HomeMapTeaser.astro';
const CONTACT_CTA = 'src/components/public/HomeContactCta.astro';
const LAYOUT = 'src/layouts/PublicLayout.astro';
const CONFIG = 'astro.config.mjs';
const CSS = 'src/styles/global.css';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function card(overrides: Partial<PublicPropertyCard> = {}): PublicPropertyCard {
  return {
    code: 'LOBA-001',
    slug: 'lote',
    title: 'Lote',
    propertyType: 'Lote',
    price: { mode: 'contact', amountMinor: null, currencyCode: null, text: 'Consultar precio' },
    area: null,
    location: {
      province: null,
      canton: null,
      district: null,
      locality: null,
      coordinates: null,
      precision: 'exact',
    },
    commercialStatus: null,
    isFeatured: false,
    media: {
      counts: { image: 0, video: 0, document: 0, panorama: 0 },
      hasTour: false,
      cover: null,
      hero: null,
      items: [],
    },
    href: '/es/propiedades/lote',
    ...overrides,
  };
}

function site(texts: Partial<PublicSite['texts']['es']> = {}, businessName?: string): PublicSite {
  return {
    businessName: businessName ?? null,
    texts: {
      es: { ...EMPTY_SITE.texts.es, ...texts },
      en: EMPTY_SITE.texts.en,
    },
    media: EMPTY_SITE.media,
  };
}

const DEFAULTS = {
  brand: 'Loba',
  heroTitle: 'Titulo por defecto',
  heroSubtitle: 'Subtitulo por defecto',
  seoTitle: 'SEO por defecto',
  seoDescription: 'Descripcion por defecto',
};

/* -------------------------------------------------------------------------- */
/* Destacadas                                                                 */
/* -------------------------------------------------------------------------- */

describe('las propiedades destacadas', () => {
  it('son las que alguien marco a mano, y solo esas', () => {
    const list = [
      card({ slug: 'a', isFeatured: false }),
      card({ slug: 'b', isFeatured: true }),
      card({ slug: 'c', isFeatured: false }),
    ];

    // Ningun ranking automatico: manda el campo del panel.
    expect(featuredOf(list).map((item) => item.slug)).toEqual(['b']);
  });

  it('no se ensenan mas de las que caben en una portada', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      card({ slug: `p${index}`, isFeatured: true }),
    );

    expect(featuredOf(many)).toHaveLength(MAX_FEATURED);
    expect(MAX_FEATURED).toBe(3);
  });

  it('sin ninguna marcada la lista queda vacia, no falla', () => {
    expect(featuredOf([card(), card({ slug: 'b' })])).toEqual([]);
    expect(featuredOf([])).toEqual([]);
  });

  it('conserva el orden del catalogo', () => {
    const list = [
      card({ slug: 'primera', isFeatured: true }),
      card({ slug: 'segunda', isFeatured: true }),
    ];

    expect(featuredOf(list).map((item) => item.slug)).toEqual(['primera', 'segunda']);
  });
});

describe('la seccion del mapa', () => {
  it('solo se ofrece si hay algo situado que mirar', () => {
    const placed = card({
      location: { ...card().location, coordinates: { latitude: 9.9, longitude: -85.6 } },
    });

    expect(hasPlacedProperties([placed])).toBe(true);
    expect(hasPlacedProperties([card()])).toBe(false);
    expect(hasPlacedProperties([])).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Textos                                                                     */
/* -------------------------------------------------------------------------- */

describe('los textos de la portada', () => {
  it('sin nada configurado se usan los de la pagina', () => {
    const copy = homeCopy(EMPTY_SITE, 'es', DEFAULTS);

    expect(copy.brand).toBe('Loba');
    expect(copy.heroTitle).toBe('Titulo por defecto');
    expect(copy.heroSubtitle).toBe('Subtitulo por defecto');
    expect(copy.tagline).toBeNull();
  });

  it('lo que escribio el negocio manda', () => {
    const copy = homeCopy(
      site({ heroTitle: 'Nuestra costa', heroSubtitle: 'Lo que buscabas' }, 'Loba Costa Rica'),
      'es',
      DEFAULTS,
    );

    expect(copy.brand).toBe('Loba Costa Rica');
    expect(copy.heroTitle).toBe('Nuestra costa');
    expect(copy.heroSubtitle).toBe('Lo que buscabas');
  });

  it('cada campo se decide por separado', () => {
    // Rellenar el panel es progresivo: medio configurado no deja huecos.
    const copy = homeCopy(site({ heroTitle: 'Solo el titulo' }), 'es', DEFAULTS);

    expect(copy.heroTitle).toBe('Solo el titulo');
    expect(copy.heroSubtitle).toBe('Subtitulo por defecto');
  });

  it('el titulo de la pestana lleva la marca cuando no hay SEO escrito', () => {
    expect(homeCopy(EMPTY_SITE, 'es', DEFAULTS).seoTitle).toBe('Loba · SEO por defecto');
  });

  it('y se respeta tal cual cuando si lo hay', () => {
    const copy = homeCopy(site({ seoTitle: 'Loba | Bienes raices' }), 'es', DEFAULTS);

    expect(copy.seoTitle).toBe('Loba | Bienes raices');
  });

  it('cada idioma coge los suyos', () => {
    const both: PublicSite = {
      businessName: 'Loba',
      texts: {
        es: { ...EMPTY_SITE.texts.es, heroTitle: 'En espanol' },
        en: { ...EMPTY_SITE.texts.en, heroTitle: 'In English' },
      },
      media: EMPTY_SITE.media,
    };

    expect(homeCopy(both, 'es', DEFAULTS).heroTitle).toBe('En espanol');
    expect(homeCopy(both, 'en', DEFAULTS).heroTitle).toBe('In English');
  });
});

/* -------------------------------------------------------------------------- */
/* Idioma en la raiz                                                          */
/* -------------------------------------------------------------------------- */

describe('el idioma al entrar por la raiz', () => {
  it('manda lo que la persona eligio a proposito', () => {
    // Aunque el navegador pida lo contrario.
    expect(resolveRootLocale('en', ['es-CR', 'es'])).toBe('en');
    expect(resolveRootLocale('es', ['en-US'])).toBe('es');
  });

  it('sin eleccion guardada, se mira el navegador', () => {
    expect(resolveRootLocale(null, ['en-US', 'en'])).toBe('en');
    expect(resolveRootLocale(null, ['es-CR'])).toBe('es');
  });

  it('solo importa la parte de delante del idioma', () => {
    expect(resolveRootLocale(null, ['en-GB'])).toBe('en');
    expect(resolveRootLocale(null, ['es-419'])).toBe('es');
  });

  it('se recorre la lista hasta encontrar uno que hablemos', () => {
    expect(resolveRootLocale(null, ['fr-FR', 'de', 'en-US'])).toBe('en');
  });

  it('si nada encaja, espanol: el negocio esta en Costa Rica', () => {
    expect(resolveRootLocale(null, ['fr', 'de'])).toBe('es');
    expect(resolveRootLocale(null, [])).toBe('es');
    expect(resolveRootLocale(null)).toBe('es');
    expect(DEFAULT_LOCALE).toBe('es');
  });

  it('una preferencia guardada corrupta se ignora', () => {
    expect(resolveRootLocale('fr', ['en'])).toBe('en');
    expect(resolveRootLocale('', ['en'])).toBe('en');
  });
});

/* -------------------------------------------------------------------------- */
/* La raiz como pagina                                                        */
/* -------------------------------------------------------------------------- */

describe('la raiz', () => {
  it('ya no es un redirect fijo de la configuracion', () => {
    const config = read(CONFIG);

    // Un 302 del servidor no puede saber que idioma eligio la persona.
    expect(config).not.toContain('redirects:');
    expect(config).toContain('src/pages/index.astro');
  });

  it('decide antes de pintar, con el script en linea', () => {
    const root = read(ROOT);

    expect(root).toContain('is:inline');
    expect(root).toContain('location.replace');
    // `replace` y no `assign`: volver atras no debe caer otra vez aqui.
    expect(root).not.toContain('location.assign');
  });

  it('implementa el mismo orden que la funcion probada', () => {
    const root = read(ROOT);

    expect(root).toContain('localStorage.getItem(key)');
    expect(root).toContain('navigator.languages');
    expect(root).toContain("'/' + (chosen ?? 'es') + '/'");
  });

  it('sin JavaScript queda una eleccion de idioma de verdad', () => {
    const root = read(ROOT);

    expect(root).toContain('href="/es/"');
    expect(root).toContain('href="/en/"');
    expect(root).toContain('chooseLanguage');
  });

  it('declara los dos idiomas y un x-default', () => {
    const root = read(ROOT);

    expect(root).toContain('hreflang="es"');
    expect(root).toContain('hreflang="en"');
    expect(root).toContain('hreflang="x-default"');
  });

  it('es una pagina de paso: ni shell ni catalogo', () => {
    const root = read(ROOT);

    /*
     * Del snapshot solo coge la marca, que necesita para no escribir el
     * nombre del negocio a mano. Ni cabecera, ni pie, ni propiedades.
     */
    expect(root).toContain('loadPublicSnapshot().site.businessName');
    expect(root).not.toContain('PublicLayout');
    expect(root).not.toContain('catalogueOf');
  });
});

/* -------------------------------------------------------------------------- */
/* SEO base                                                                   */
/* -------------------------------------------------------------------------- */

describe('el <head> de la portada', () => {
  it('cada idioma tiene su canonica y su alternate', () => {
    expect(read(HOME_ES)).toContain("path: '/es/'");
    expect(read(HOME_ES)).toContain("alternatePath: '/en/'");
    expect(read(HOME_EN)).toContain("path: '/en/'");
    expect(read(HOME_EN)).toContain("alternatePath: '/es/'");

    // Y quien las pinta es una sola plantilla.
    expect(read(LAYOUT)).toContain('rel="canonical"');
  });

  it('la portada declara tambien su propio idioma y el x-default', () => {
    const layout = read(LAYOUT);

    expect(read(HOME_ES)).toContain('isHome: true');
    expect(layout).toContain('hreflang="x-default"');
  });

  it('las URL se vuelven absolutas solas el dia que haya dominio', () => {
    // Mientras no exista `site`, relativas: son validas y resuelven bien.
    expect(read('src/lib/public/seo.ts')).toContain(
      'site === undefined ? path : new URL(path, site).href',
    );
    expect(read(LAYOUT)).toContain('absoluteUrl(Astro.site, path)');
  });

  it('titulo y descripcion salen de la configuracion cuando existe', () => {
    expect(read(HOME_ES)).toContain('copy.seoTitle');
    expect(read(HOME_ES)).toContain('copy.seoDescription');
  });

  it('un solo H1, y es el del hero', () => {
    expect(read(HERO)).toContain('<h1');
    for (const file of [HOME_ES, HOME_EN, INTRO, MAP_TEASER, CONTACT_CTA]) {
      expect(read(file)).not.toContain('<h1');
    }
  });

  it('cada seccion tiene su encabezado y su etiqueta', () => {
    for (const file of [INTRO, MAP_TEASER, CONTACT_CTA]) {
      expect(read(file)).toContain('aria-labelledby');
      expect(read(file)).toContain('<h2');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Composicion y peso                                                         */
/* -------------------------------------------------------------------------- */

describe('la portada', () => {
  it('sigue siendo estatica', () => {
    for (const file of [HOME_ES, HOME_EN, ROOT]) {
      expect(read(file)).not.toContain('prerender = false');
    }
    expect(read(HOME_ES)).toContain('loadPublicSnapshot');
  });

  it('reutiliza la tarjeta del catalogo en vez de duplicarla', () => {
    expect(read(HOME_ES)).toContain('<PropertyCard');
    expect(read(HOME_ES)).toContain('featuredOf(properties)');
  });

  it('sin destacadas la composicion no se rompe', () => {
    const home = read(HOME_ES);

    expect(home).toContain('featured.length === 0');
    expect(home).toContain('labels.homeFeaturedEmpty');
  });

  it('no carga Mapbox, ni el visor 360, ni YouTube', () => {
    for (const file of [HOME_ES, HOME_EN, HERO, INTRO, MAP_TEASER, CONTACT_CTA]) {
      const source = read(file);

      expect(source).not.toContain('mapbox');
      expect(source).not.toContain('map-page');
      expect(source).not.toContain('photo-sphere');
      expect(source).not.toContain('youtube');
    }
  });

  it('la seccion del mapa enlaza, no monta un mapa', () => {
    const teaser = read(MAP_TEASER);

    expect(teaser).toContain('mapHref(locale)');
    expect(teaser).not.toContain('createPublicMap');
  });

  it('el cierre lleva a contacto sin repetir el formulario', () => {
    const cta = read(CONTACT_CTA);

    expect(cta).toContain('contactHref(locale)');
    expect(cta).not.toContain('<form');
  });
});

/* -------------------------------------------------------------------------- */
/* Direccion visual                                                           */
/* -------------------------------------------------------------------------- */

describe('el hero', () => {
  it('no se cuelga de la foto de ninguna propiedad', () => {
    /*
     * La portada usa la imagen del SITIO, que se configura en el panel. Atarla
     * a la foto de un lote la romperia el dia que ese lote deje de estar
     * publicado.
     *
     * Se mira el codigo, no el comentario de cabecera.
     */
    const hero = read(HERO);
    const code = hero.slice(hero.indexOf('---', 3));

    expect(code).not.toContain('property_media');
    expect(code).not.toContain('catalogueOf');

    // La imagen llega por props, y quien la pasa es la portada.
    expect(hero).toContain('image?: string | null');
    for (const page of [HOME_ES, HOME_EN]) {
      expect(read(page)).toContain('image={snapshot.site.media.hero}');
    }
  });

  it('con imagen, ni se pierde legibilidad ni se mueve nada al cargar', () => {
    const css = read(CSS);
    const hero = read(HERO);

    // El degradado va encima de la foto: el texto no depende de como sea.
    expect(css).toContain('.hero-has-image::after');
    // El hueco lo fija el hero, y la foto se recorta dentro.
    expect(css).toContain('object-fit: cover');
    expect(css).toContain('min-height: min(78vh, 40rem)');
    // Es la imagen mas importante de la pagina: se pide cuanto antes.
    expect(hero).toContain('fetchpriority="high"');
    expect(hero).not.toContain('loading="lazy"');
  });

  it('sin imagen configurada, el fondo se dibuja: ni una peticion de red', () => {
    const css = read(CSS);
    const hero = read(HERO);

    expect(css).toContain('.hero-terrain');
    expect(css).toContain('repeating-radial-gradient');
    // Ninguna imagen que descargar.
    expect(css).not.toContain('.hero-terrain {\n  background-image: url(');

    // Y el <img> solo aparece cuando hay algo que ensenar.
    expect(hero).toContain('image !== null && (');
  });

  it('lleva marca, mensaje y camino a Propiedades', () => {
    const hero = read(HERO);

    expect(hero).toContain('copy.brand');
    expect(hero).toContain('copy.heroTitle');
    expect(hero).toContain('catalogueHref(locale)');
  });

  it('el segundo camino solo aparece cuando aporta algo', () => {
    expect(read(HERO)).toContain('showMap &&');
    expect(read(HOME_ES)).toContain('hasPlacedProperties(properties)');
  });

  it('quien pide menos movimiento no recibe ninguno', () => {
    // La regla global ya lo cubre; aqui se comprueba que sigue en pie.
    expect(read(CSS)).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('en movil el hero se adapta y los botones se pulsan con el pulgar', () => {
    const css = read(CSS);

    expect(css).toMatch(/\.hero \{\s+min-height: auto;/);
    expect(css).toMatch(/\.hero-cta \{\s+\/\*[^}]*\*\/\s+flex: 1 1 100%;/);
  });
});

/* -------------------------------------------------------------------------- */
/* Idiomas                                                                    */
/* -------------------------------------------------------------------------- */

describe('idiomas', () => {
  it('toda la portada esta en los dos', () => {
    const es = labelsFor('es');
    const en = labelsFor('en');

    expect(es.homeHeroTitle).not.toBe(en.homeHeroTitle);
    expect(es.homeIntroTitle).not.toBe(en.homeIntroTitle);
    expect(es.homeMapTitle).not.toBe(en.homeMapTitle);
    expect(es.homeContactTitle).not.toBe(en.homeContactTitle);
  });

  it('las dos portadas son la misma pagina en distinto idioma', () => {
    // Si una gana una seccion y la otra no, esto lo caza.
    const neutral = (source: string): string =>
      source.replace(/'(es|en)'/g, "'X'").replace(/\/(es|en)\//g, '/X/');

    expect(neutral(read(HOME_ES))).toBe(neutral(read(HOME_EN)));
  });
});
