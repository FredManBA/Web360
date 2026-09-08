/**
 * Tests del panel de publicacion.
 *
 * La parte con logica —que se puede publicar, que se anota, que se confirma—
 * se prueba contra la base en `src/lib/publication`. Aqui queda lo que es
 * propio de la pantalla: que la seccion exista, que el texto de cada estado
 * diga la verdad y que la UI no hable de proveedores.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { requestSummary } from './publication-panel';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const EDITOR_PAGE = 'src/pages/admin/propiedades/[id].astro';
const PANEL = 'src/lib/admin/ui/publication-panel.ts';

function request(status: string, errorSummary: string | null = null) {
  return {
    id: 1,
    action: 'publish',
    status,
    errorSummary,
    requestedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
    isActive: status === 'pending' || status === 'building',
  };
}

/* -------------------------------------------------------------------------- */
/* La seccion del editor                                                      */
/* -------------------------------------------------------------------------- */

describe('la seccion de publicacion', () => {
  const page = read(EDITOR_PAGE);

  it('existe y esta rotulada', () => {
    expect(page).toContain('id="editor-publication"');
    expect(page).toContain('aria-labelledby="publication-heading"');
    expect(page).toContain('<h2 id="publication-heading">Publicación</h2>');
    expect(page).toContain('id="admin-publication"');
  });

  it('avisa de que publicar no es inmediato', () => {
    expect(page).toContain('No es inmediato');
  });

  it('se inicializa junto al resto del editor', () => {
    expect(page).toContain(
      "import { initPublicationPanel } from '../../../lib/admin/ui/publication-panel'",
    );
    expect(page).toContain('initPublicationPanel();');
  });
});

/* -------------------------------------------------------------------------- */
/* Como se cuenta cada estado                                                 */
/* -------------------------------------------------------------------------- */

describe('el resumen de una operacion', () => {
  it('distingue preparando, en curso, hecha y fallida', () => {
    expect(requestSummary(request('pending'))).toContain('Preparando');
    expect(requestSummary(request('building'))).toContain('en curso');
    expect(requestSummary(request('done'))).toContain('completada');
    expect(requestSummary(request('failed'))).toContain('fallida');
  });

  it('mientras esta en curso deja claro que todavia no esta en la web', () => {
    expect(requestSummary(request('building'))).toContain('Todavía no está en la web');
  });

  it('un fallo con motivo lo enseña, y sin motivo invita a reintentar', () => {
    expect(requestSummary(request('failed', 'El despliegue no terminó.'))).toContain(
      'El despliegue no terminó.',
    );
    expect(requestSummary(request('failed'))).toContain('Vuelve a intentarlo');
  });

  it('nunca dice "publicada" por el hecho de haberlo pedido', () => {
    for (const status of ['pending', 'building']) {
      expect(requestSummary(request(status))).not.toMatch(/publicada/i);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Lo que la UI no debe saber                                                 */
/* -------------------------------------------------------------------------- */

describe('el panel', () => {
  const source = read(PANEL);

  it('no menciona a quien construye ni despliega el sitio', () => {
    // Se miran solo el codigo y los textos: los comentarios si explican por que.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/github|cloudflare|workflow|wrangler|deploy/i);
  });

  it('pide confirmacion explicita antes de publicar o retirar', () => {
    expect(source).toContain('confirm-publish');
    expect(source).toContain('confirm-unpublish');
    expect(source).toContain('Sí, publicar');
    expect(source).toContain('Sí, retirar');
    expect(source).toContain('Cancelar');
  });

  it('los botones salen del permiso que da el servidor, no del estado a ojo', () => {
    expect(source).toContain('state.canPublish');
    expect(source).toContain('state.canUnpublish');
  });

  it('avisa de que el token del paso manual no se vuelve a ver', () => {
    expect(source).toContain('No se vuelve a mostrar');
  });
});
