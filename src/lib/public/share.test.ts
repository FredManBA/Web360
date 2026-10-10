/**
 * Compartir una propiedad: enlace de la ficha publica y QR del panel.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { QR_QUIET_ZONE, qrMatrix, qrPath, qrSvg } from '../admin/share/qr';
import { propertyHref } from './read-model';
import { propertySharePath, propertyShareUrl, shareOrigin, whatsappShareHref } from './share';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const PROD = new URL('https://properties.costarica360.workers.dev');

describe('el enlace que se comparte', () => {
  it('en produccion lleva al dominio publico, aunque el panel se abra desde otro host', () => {
    expect(
      shareOrigin({ site: PROD, request: new URL('https://otro-host.dev/admin/x'), dev: false }),
    ).toBe('https://properties.costarica360.workers.dev');
  });

  it('en desarrollo lleva al host local: la propiedad local no existe en produccion', () => {
    expect(
      shareOrigin({ site: PROD, request: new URL('http://localhost:4321/es/x'), dev: true }),
    ).toBe('http://localhost:4321');
  });

  it('sin dominio configurado, el host de la peticion', () => {
    expect(
      shareOrigin({ site: undefined, request: new URL('https://a.example/es/'), dev: false }),
    ).toBe('https://a.example');
  });

  it('es la ficha publica normal, la misma ruta que usa el sitio', () => {
    for (const locale of ['es', 'en'] as const) {
      expect(propertySharePath(locale, 'casa-madera')).toBe(propertyHref(locale, 'casa-madera'));
    }
    expect(propertyShareUrl('https://a.example', 'en', 'lot-guiones')).toBe(
      'https://a.example/en/propiedades/lot-guiones',
    );
  });

  it('WhatsApp abre sin destinatario, con el titulo y el enlace', () => {
    const href = whatsappShareHref('Casa & jardín', 'https://a.example/es/propiedades/casa');

    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href.slice('https://wa.me/?text='.length))).toBe(
      'Casa & jardín\nhttps://a.example/es/propiedades/casa',
    );
  });
});

describe('el QR', () => {
  const url =
    'https://properties.costarica360.workers.dev/es/propiedades/casa-madera-bosque-nuboso';

  it('es cuadrado y deja el margen de cuatro modulos que pide la norma', () => {
    const matrix = qrMatrix(url);

    expect(matrix.data).toHaveLength(matrix.size);
    for (const row of matrix.data) expect(row).toHaveLength(matrix.size);
    // Version v: 17 + 4v modulos, mas el margen por los dos lados.
    expect((matrix.size - 2 * QR_QUIET_ZONE - 17) % 4).toBe(0);
    // El margen esta vacio.
    expect(matrix.data[0]!.some(Boolean)).toBe(false);
    expect(matrix.data.map((row) => row[0]).some(Boolean)).toBe(false);
    // La esquina del primer patron de posicion empieza justo despues del margen.
    expect(matrix.data[QR_QUIET_ZONE]![QR_QUIET_ZONE]).toBe(true);
  });

  it('el mismo enlace da siempre el mismo QR', () => {
    expect(qrSvg(qrMatrix(url))).toBe(qrSvg(qrMatrix(url)));
  });

  it('el SVG es autonomo: fondo propio, un solo trazo y nada ejecutable', () => {
    const svg = qrSvg(qrMatrix(url), { title: 'QR <CR360-002>' });

    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('<rect');
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('<title>QR &lt;CR360-002&gt;</title>');
    expect(svg).not.toContain('<script');
  });

  it('el trazo cubre exactamente los modulos oscuros', () => {
    const matrix = qrMatrix(url);
    const dark = matrix.data.flat().filter(Boolean).length;
    const covered = [...qrPath(matrix).matchAll(/h(\d+)v1/g)].reduce(
      (total, match) => total + Number(match[1]),
      0,
    );

    expect(covered).toBe(dark);
  });
});

describe('quien comparte que', () => {
  it('la ficha publica ofrece compartir el enlace, pero no el QR', () => {
    const publicFiles = [
      ...readdirSync('src/components/public').map((file) => `src/components/public/${file}`),
      ...readdirSync('src/lib/public')
        .filter((file) => !file.endsWith('.test.ts'))
        .map((file) => `src/lib/public/${file}`),
    ];

    for (const file of publicFiles) {
      expect(read(file), file).not.toMatch(/from ['"]uqr['"]|admin\/share\/qr/);
    }
    expect(read('src/components/public/PropertyDetail.astro')).toContain('<PropertyShare');
  });

  it('el panel ofrece el QR para descargar', () => {
    const editor = read('src/pages/admin/propiedades/[id].astro');

    expect(editor).toContain('id="r2-share"');
    expect(editor).toContain('data-share-action="png"');
    expect(editor).toContain('data-share-action="svg"');
    expect(editor).toContain('initShare()');
  });
});
