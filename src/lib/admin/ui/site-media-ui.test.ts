/**
 * Tests de la media global en la interfaz.
 *
 * El panel por su estructura, y el sitio publico por como usa cada imagen:
 * cuando la hay y —lo que importa mas— cuando no.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatLimit, formatTypes } from './site-media-panel';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const PANEL = 'src/lib/admin/ui/site-media-panel.ts';
const PAGE = 'src/pages/admin/configuracion.astro';
const LAYOUT = 'src/layouts/PublicLayout.astro';
const HEADER = 'src/components/public/SiteHeader.astro';
const FOOTER = 'src/components/public/SiteFooter.astro';
const HERO = 'src/components/public/HomeHero.astro';

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

describe('la seccion del panel', () => {
  const page = read(PAGE);
  const panel = read(PANEL);

  it('existe y esta rotulada', () => {
    expect(page).toContain('id="settings-media"');
    expect(page).toContain('Imágenes del sitio');
    expect(page).toContain('id="site-media"');
    expect(page).toContain('initSiteMediaPanel();');
  });

  it('ofrece los cuatro huecos', () => {
    for (const slot of ['hero', 'logo', 'social', 'favicon']) {
      expect(panel).toContain(`'${slot}'`);
    }
  });

  it('cada hueco se sube, se reemplaza y se quita', () => {
    expect(panel).toContain("view.present ? 'Reemplazar' : 'Subir'");
    expect(panel).toContain('data-action="delete"');
    expect(panel).toContain("method: 'PUT'");
    expect(panel).toContain("method: 'DELETE'");
  });

  it('y se ve lo que hay', () => {
    expect(panel).toContain('site-media-preview');
    expect(panel).toContain('Sin imagen');
  });

  it('el hueco viaja en la RUTA, y el archivo en el cuerpo', () => {
    expect(panel).toContain('`/api/admin/settings/media/${slot}`');
    expect(panel).toContain("form.set('file', file)");
    // Ninguna clave de R2 se manda desde el navegador.
    expect(panel).not.toContain('objectKey');
  });

  it('dice el limite y los tipos en un idioma humano', () => {
    expect(formatLimit(512 * 1024)).toBe('512 KB');
    expect(formatLimit(8 * 1024 * 1024)).toBe('8 MB');
    expect(formatTypes(['image/png', 'image/jpeg'])).toBe('PNG, JPG');
  });
});

/* -------------------------------------------------------------------------- */
/* El sitio publico                                                           */
/* -------------------------------------------------------------------------- */

describe('el favicon', () => {
  it('se declara solo si esta configurado', () => {
    const layout = read(LAYOUT);

    expect(layout).toContain('snapshot.site.media.favicon');
    expect(layout).toContain('{favicon && <link rel="icon" href={favicon} />}');
  });
});

describe('el logo', () => {
  it('llega a la cabecera y al pie desde la configuracion', () => {
    const layout = read(LAYOUT);

    expect(layout).toContain('logo={snapshot.site.media.logo}');
    expect(read(HEADER)).toContain('logo?: string | null');
    expect(read(FOOTER)).toContain('logo?: string | null');
  });

  it('sin logo, la cabecera sigue teniendo distintivo', () => {
    const header = read(HEADER);

    // La inicial de siempre cuando no hay imagen.
    expect(header).toContain('logo === null ? (');
    expect(header).toContain('brand.trim().charAt(0)');
  });

  it('el nombre del negocio no desaparece nunca', () => {
    expect(read(HEADER)).toContain('<span class="site-brand-name">{brand}</span>');
    expect(read(FOOTER)).toContain('<p class="site-footer-brand">{brand}</p>');
  });

  it('el logo es decorativo: lo que se lee es el nombre', () => {
    for (const source of [read(HEADER), read(FOOTER)]) {
      expect(source).toContain('alt=""');
    }
  });
});

describe('la portada de la Home', () => {
  it('usa la imagen del sitio, no la de una propiedad', () => {
    const hero = read(HERO);

    expect(hero).toContain('image?: string | null');
    expect(hero).not.toContain('property_media');
  });

  it('sin imagen, el fondo dibujado sigue siendo el de siempre', () => {
    const hero = read(HERO);

    expect(hero).toContain('image !== null && (');
    expect(hero).toContain('hero-terrain');
  });
});
