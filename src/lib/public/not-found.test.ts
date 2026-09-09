/**
 * Tests de la pagina no encontrada y del skip link del panel.
 *
 * La regla de idioma se prueba como funcion pura; el resto —que conserve el
 * 404, que no se indexe, que no se canonicalice y que ofrezca salidas— por la
 * estructura de la pagina, que es donde vive.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EMPTY_SITE } from './read-model';
import { localeFromPath } from './not-found';
import { brandOf, notFoundSeo } from './seo';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const PAGE = 'src/pages/404.astro';
const LAYOUT = 'src/layouts/PublicLayout.astro';
const ADMIN_LAYOUT = 'src/layouts/AdminLayout.astro';

/* -------------------------------------------------------------------------- */
/* El idioma de una ruta que no existe                                        */
/* -------------------------------------------------------------------------- */

describe('en que idioma se contesta', () => {
  it('bajo /es se contesta en espanol', () => {
    expect(localeFromPath('/es/no-existe')).toBe('es');
    expect(localeFromPath('/es/propiedades/inventada')).toBe('es');
    expect(localeFromPath('/es')).toBe('es');
    expect(localeFromPath('/es/')).toBe('es');
  });

  it('bajo /en se contesta en ingles', () => {
    expect(localeFromPath('/en/does-not-exist')).toBe('en');
    expect(localeFromPath('/en/propiedades/nope')).toBe('en');
  });

  it('fuera de los dos prefijos no hay idioma que deducir', () => {
    for (const ruta of ['/', '/no-existe', '/admin/loquesea', '/media/9']) {
      expect(localeFromPath(ruta)).toBeNull();
    }
  });

  it('el prefijo tiene que ser un segmento entero', () => {
    // Si no, media web caeria en el idioma equivocado por casualidad.
    expect(localeFromPath('/espanol')).toBeNull();
    expect(localeFromPath('/entrada')).toBeNull();
    expect(localeFromPath('/english/algo')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Lo que declara la pagina                                                   */
/* -------------------------------------------------------------------------- */

describe('el SEO de un 404', () => {
  const seo = notFoundSeo({
    locale: 'es',
    brand: brandOf(EMPTY_SITE, 'es'),
    title: 'Esta página no existe',
    description: 'Prueba con el catálogo.',
  });

  it('no se indexa, pero se siguen sus enlaces', () => {
    expect(seo.indexable).toBe(false);
    expect(read(LAYOUT)).toContain("seo.indexable ? 'index, follow' : 'noindex, follow'");
  });

  it('no tiene canonica: no representa ningun contenido', () => {
    expect(seo.path).toBeNull();

    const layout = read(LAYOUT);
    expect(layout).toContain('{canonical && <link rel="canonical" href={canonical} />}');
    expect(layout).toContain('seo.path === null ? null : url(seo.path)');
  });

  it('tampoco declara alternates ni imagen social', () => {
    expect(seo.alternatePath).toBeNull();
    expect(seo.imagePath).toBeNull();
    // Un alternate solo se emite si ademas hay canonica.
    expect(read(LAYOUT)).toContain('seo.alternatePath && canonical && (');
  });

  it('lleva la marca en el titulo, como el resto del sitio', () => {
    expect(seo.title).toBe('Esta página no existe · Loba');
  });
});

/* -------------------------------------------------------------------------- */
/* La pagina                                                                  */
/* -------------------------------------------------------------------------- */

describe('la pagina 404', () => {
  const page = read(PAGE);

  it('conserva el 404 de verdad', () => {
    expect(page).toContain('Astro.response.status = 404;');
  });

  it('se resuelve en el Worker: es la unica forma de mirar la URL pedida', () => {
    expect(page).toContain('export const prerender = false;');
    expect(page).toContain('localeFromPath(Astro.url.pathname)');
  });

  it('usa el shell publico, con su cabecera y su pie', () => {
    expect(page).toContain('PublicLayout');
    expect(page).toContain('<PublicLayout seo={seo}>');
  });

  it('ofrece portada y catalogo del idioma en el que contesta', () => {
    expect(page).toContain('homeHref(locale)');
    expect(page).toContain('catalogueHref(locale)');
    expect(page).toContain('labels.notFoundHome');
    expect(page).toContain('labels.notFoundCatalogue');
  });

  it('sin prefijo ofrece ademas el otro idioma, en su idioma', () => {
    expect(page).toContain('fromPath === null && (');
    expect(page).toContain('other.notFoundHome');
  });

  it('NO redirige: desde una ruta desconocida es la forma facil de un bucle', () => {
    expect(page).not.toContain('Astro.redirect');
    expect(page).not.toContain('location.href');
  });

  it('no carga mapa, visor 360 ni scripts', () => {
    // Solo los imports: el comentario de cabecera nombra lo que NO carga.
    const imports = page.split('\n').filter((line) => line.startsWith('import '));

    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line).not.toMatch(/mapbox|photo-sphere|panorama/i);
    }

    expect(page).not.toContain('<script');
  });

  it('los textos estan en los dos idiomas', () => {
    const labels = read('src/lib/public/labels.ts');

    for (const clave of ['notFoundTitle', 'notFoundLead', 'notFoundHome', 'notFoundCatalogue']) {
      // Uno en la interfaz y uno en cada idioma.
      expect(labels.split(clave).length - 1).toBeGreaterThanOrEqual(3);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Skip link del panel                                                        */
/* -------------------------------------------------------------------------- */

describe('el skip link del panel', () => {
  const layout = read(ADMIN_LAYOUT);

  it('es el primer elemento del cuerpo', () => {
    const cuerpo = layout.slice(layout.indexOf('<body'));
    const enlace = cuerpo.indexOf('class="skip-link"');
    const primerFoco = cuerpo.indexOf('<button');

    expect(enlace).toBeGreaterThan(0);
    expect(enlace).toBeLessThan(primerFoco);
    expect(enlace).toBeLessThan(cuerpo.indexOf('admin-shell'));
  });

  it('apunta a un destino que existe y es unico', () => {
    expect(layout).toContain('href="#admin-main"');
    expect(layout.split('id="admin-main"').length - 1).toBe(1);
    expect(layout).toContain('<main class="admin-content" id="admin-main">');
  });

  it('reutiliza el patron publico en vez de inventar otro', () => {
    const css = read('src/styles/global.css');

    expect(layout).toContain('class="skip-link"');
    // El panel ya carga `global.css`, donde vive la regla.
    expect(layout).toContain("import '../styles/global.css';");
    expect(css).toContain('.skip-link {');
    expect(css).toContain('.skip-link:focus-visible {');
  });

  it('esta escondido hasta que recibe el foco, sin ocupar sitio', () => {
    const css = read('src/styles/global.css');
    const regla = css.slice(css.indexOf('.skip-link {'), css.indexOf('.skip-link:focus-visible'));

    expect(regla).toContain('position: absolute');
    expect(regla).toContain('left: -9999px');
  });
});
