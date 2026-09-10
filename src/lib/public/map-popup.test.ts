/**
 * Tests de la ficha flotante del mapa.
 *
 * Se prueba por estructura —el marcado que se genera y las reglas de CSS— y no
 * midiendo pixeles, porque lo que se rompio no fue un calculo sino una
 * decision de composicion: la foto iba ENCIMA del texto, el globo pasaba de
 * 330 px de alto y no cabia en un mapa de 269. Mapbox lo abria igual y el
 * `overflow: hidden` del contenedor se comia el enlace, que es lo unico que
 * el globo aporta que no este ya en la pagina.
 *
 * Los huecos reales alrededor del marcador, medidos en produccion:
 *
 *   mapa general escritorio  243 px
 *   ficha escritorio         174 px
 *   mapa general movil       146 px
 *   ficha movil              101 px
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const FUENTE = read('src/lib/public/mapbox.ts');
const CSS = read('src/styles/global.css');

/** El bloque de CSS de un selector, para poder mirarlo entero. */
function regla(selector: string): string {
  const inicio = CSS.indexOf(`${selector} {`);
  expect(inicio, `falta la regla ${selector}`).toBeGreaterThan(-1);
  return CSS.slice(inicio, CSS.indexOf('}', inicio));
}

/* -------------------------------------------------------------------------- */
/* El marcado                                                                 */
/* -------------------------------------------------------------------------- */

describe('el marcado del globo', () => {
  it('envuelve el texto para poder ponerlo al lado de la miniatura', () => {
    expect(FUENTE).toContain('<div class="map-popup-body">');
  });

  it('el enlace es lo ultimo, pegado al borde inferior', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('<div class="map-popup-body">'));
    const enlace = cuerpo.indexOf('map-popup-link');

    expect(enlace).toBeGreaterThan(-1);
    for (const antes of ['map-popup-title', 'map-popup-place', 'map-popup-facts']) {
      expect(cuerpo.indexOf(antes), `${antes} deberia ir antes del enlace`).toBeLessThan(enlace);
    }
  });

  it('"aproximada" comparte fila con precio y superficie', () => {
    // Como parrafo propio costaba una linea entera de alto.
    expect(FUENTE).toContain('<span class="map-popup-approximate">');
    expect(FUENTE).not.toContain('<p class="map-popup-approximate">');
    expect(FUENTE).toContain('${area}${approximate}</p>');
  });

  it('sigue diciendo que la ubicacion es aproximada', () => {
    // Recortar el globo no puede llevarse por delante lo que avisa al usuario.
    expect(FUENTE).toContain("point.precision === 'approximate'");
    expect(FUENTE).toContain('texts.approximate');
  });
});

/* -------------------------------------------------------------------------- */
/* La composicion                                                             */
/* -------------------------------------------------------------------------- */

describe('la composicion en escritorio', () => {
  it('miniatura al lado, no encima', () => {
    const popup = regla('.map-popup');

    expect(popup).toContain('display: flex');
    // Sin `flex-direction: column`: en fila es como no la estira la foto.
    expect(popup).not.toContain('flex-direction: column');
  });

  it('la miniatura tiene tamano fijo y no manda en la altura', () => {
    const imagen = regla('.map-popup-image');

    expect(imagen).toContain('flex: 0 0 auto');
    expect(imagen).toMatch(/height:\s*\d+px/);
    // El `aspect-ratio` de antes ataba el alto al ancho del globo.
    expect(imagen).not.toContain('aspect-ratio');
  });

  it('el texto se corta en vez de estirar la caja', () => {
    expect(regla('.map-popup-body')).toContain('min-width: 0');
    expect(regla('.map-popup-title')).toContain('-webkit-line-clamp: 2');
    expect(regla('.map-popup-place')).toContain('white-space: nowrap');
  });

  it('no se resuelve con scroll dentro del globo', () => {
    for (const selector of ['.map-popup', '.map-popup-body', '.mapboxgl-popup-content']) {
      expect(regla(selector)).not.toContain('overflow-y: auto');
      expect(regla(selector)).not.toContain('max-height');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Los mapas bajos                                                            */
/* -------------------------------------------------------------------------- */

describe('el mapa de una ficha, que es el mas bajo', () => {
  it('se marca en el contenedor para poder apretarlo solo ahi', () => {
    expect(FUENTE).toContain("options.container.classList.add('map-compact')");

    const compacto = FUENTE.slice(FUENTE.indexOf('options.compact === true'));
    expect(compacto).toContain('map-compact');
  });

  it('suelta lo que la pagina ya dice dos parrafos mas arriba', () => {
    expect(regla('.map-compact .map-popup-place')).toContain('display: none');
    expect(regla('.map-compact .map-popup-title')).toContain('-webkit-line-clamp: 1');
  });

  it('nunca suelta el enlace', () => {
    expect(CSS).not.toMatch(/\.map-compact[^{]*\.map-popup-link\s*\{[^}]*display:\s*none/);
    expect(CSS).not.toMatch(/\.map-popup-link\s*\{[^}]*display:\s*none/);
  });
});

describe('en movil', () => {
  it('el globo se queda con el titulo, los datos y el enlace', () => {
    // La foto ya se ocultaba; ahora tambien la ubicacion, que va en la tarjeta.
    expect(CSS).toContain('.map-popup-place {\n    display: none;\n  }');
    expect(CSS).toContain('.map-popup-title {\n    -webkit-line-clamp: 1;\n  }');
  });

  it('en la ficha, ademas, precio y superficie', () => {
    expect(CSS).toContain('.map-compact .map-popup-facts {\n    display: none;\n  }');
  });
});
