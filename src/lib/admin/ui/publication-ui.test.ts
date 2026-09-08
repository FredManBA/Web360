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

import { reconciliationMessage, requestSummary } from './publication-panel';

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

    expect(code).not.toMatch(/github|cloudflare|workflow|wrangler/i);
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

/* -------------------------------------------------------------------------- */
/* Comprobar si ya esta desplegado                                            */
/* -------------------------------------------------------------------------- */

describe('el resultado de comprobar una operacion viva', () => {
  it('cuenta que ya estaba publicado cuando el artefacto lo demuestra', () => {
    const message = reconciliationMessage('applied');

    expect(message.kind).toBe('ok');
    expect(message.text).toContain('ya está en línea');
  });

  it('sin operacion pendiente lo dice y ya', () => {
    expect(reconciliationMessage('nothing_to_reconcile').text).toContain(
      'No hay ninguna operación',
    );
  });

  it('cuando la version en linea es otra NO dice que haya fallado', () => {
    for (const reason of ['release_mismatch', 'no_release_deployed'] as const) {
      const message = reconciliationMessage(reason);

      expect(message.kind).toBe('warn');
      expect(message.text).toContain('todavía no se ha desplegado');
      expect(message.text).toContain('No se ha cambiado nada');
      expect(message.text).not.toMatch(/ha fallado|error|cancel/i);
    }
  });
});

describe('el panel y las operaciones vivas', () => {
  const source = read(PANEL);

  it('ofrece comprobar el estado real, y solo con una operacion viva', () => {
    expect(source).toContain('data-action="reconcile"');
    expect(source).toContain('Comprobar si ya se publicó');

    // Los dos botones de una operacion viva cuelgan de la misma condicion.
    const live = source.slice(source.indexOf('current !== null'));
    expect(live.slice(0, 400)).toContain('reconcile');
  });

  it('no marca nada por su cuenta comparando releases', () => {
    // Que la version en linea sea otra es lo normal mientras se prepara, y
    // cuando cuenta —para ofrecer el abandono— lo decide el servidor.
    expect(source).not.toContain('deployed.requestId ===');
    expect(source).not.toContain('deployed.requestId !==');
  });
});

/* -------------------------------------------------------------------------- */
/* Abandono                                                                   */
/* -------------------------------------------------------------------------- */

describe('una operacion abandonada', () => {
  function request(status: string, errorSummary: string | null = null) {
    return {
      id: 1,
      action: 'publish',
      status,
      errorSummary,
      requestedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      isActive: false,
    };
  }

  it('no se cuenta como fallida', () => {
    const abandoned = requestSummary(request('abandoned'));

    expect(abandoned).toContain('abandonada');
    expect(abandoned).not.toMatch(/fallid|error/i);
    // Y deja claro lo importante: no ha pasado nada en la web.
    expect(abandoned).toContain('No se publicó ni se retiró nada');
  });

  it('enseña el motivo cuando lo hay', () => {
    expect(requestSummary(request('abandoned', 'se perdió el aviso'))).toContain(
      'se perdió el aviso',
    );
  });

  it('sigue distinguiendose de una fallida', () => {
    expect(requestSummary(request('failed'))).toContain('fallida');
    expect(requestSummary(request('failed'))).not.toContain('abandonada');
  });
});

describe('el panel al abandonar', () => {
  const source = read(PANEL);

  it('ofrece abandonar solo cuando el servidor lo permite', () => {
    expect(source).toContain('state.canAbandon');
    expect(source).toContain('Abandonar operación');
  });

  it('pide confirmacion y explica que no publica ni retira', () => {
    expect(source).toContain('confirm-abandon');
    expect(source).toContain('Sí, abandonar');
    expect(source).toContain('Esto no publica ni retira nada');
    expect(source).toContain('No se da por hecho que haya fallado');
  });

  it('permite un motivo opcional', () => {
    expect(source).toContain('id="publication-reason"');
    expect(source).toContain('Motivo (opcional)');
  });

  it('el estado que pinta despues viene del servidor', () => {
    const abandon = source.slice(source.indexOf('const abandon ='));

    expect(abandon.slice(0, 1400)).toContain('body.data.publication');
    // No se inventa el desenlace por su cuenta.
    expect(abandon.slice(0, 1400)).not.toContain("status: 'abandoned'");
  });
});
