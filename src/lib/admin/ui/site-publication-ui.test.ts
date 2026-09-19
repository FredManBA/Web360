/**
 * Tests del panel "Publicar los cambios".
 *
 * Lo que decide el panel es que se puede hacer y que se cuenta en cada
 * situacion, asi que eso es lo que se prueba: el render es una funcion pura de
 * un estado, y aqui se le pasan los estados uno a uno.
 *
 * La logica de verdad —quien puede publicar, que bloquea a que— vive en
 * `src/lib/publication` y se prueba contra la base. Aqui solo la pantalla.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  renderSitePanel,
  siteStatusMessage,
  type SitePublicationState,
  type SiteRequest,
} from './site-publication-panel';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const PAGE = 'src/pages/admin/configuracion.astro';
const PANEL = 'src/lib/admin/ui/site-publication-panel.ts';

function request(status: string, errorSummary: string | null = null): SiteRequest {
  return {
    id: 7,
    action: 'publish_site',
    status,
    errorSummary,
    requestedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: status === 'pending' || status === 'building' ? null : '2026-01-01T00:05:00.000Z',
    isActive: status === 'pending' || status === 'building',
  };
}

/** Un estado libre, sin nada en curso ni nada anterior. */
const LIBRE: SitePublicationState = {
  current: null,
  last: null,
  canPublish: true,
  canReconcile: false,
  canAbandon: false,
  blockedByPropertyId: null,
};

/** Un estado con la operacion del sitio en marcha. */
const enCurso = (status: string): SitePublicationState => ({
  current: request(status),
  last: null,
  canPublish: false,
  canReconcile: true,
  canAbandon: true,
  blockedByPropertyId: null,
});

/** Un estado ya terminado, sin nada vivo. */
const terminado = (status: string, error: string | null = null): SitePublicationState => ({
  current: null,
  last: request(status, error),
  canPublish: true,
  canReconcile: false,
  canAbandon: false,
  blockedByPropertyId: null,
});

const paint = (
  state: SitePublicationState | null,
  extra: Partial<Parameters<typeof renderSitePanel>[0]> = {},
) => renderSitePanel({ state, pendingConfirm: null, busy: false, notice: null, ...extra });

/* -------------------------------------------------------------------------- */
/* Sin nada en curso                                                          */
/* -------------------------------------------------------------------------- */

describe('cuando no hay nada en curso', () => {
  it('ofrece publicar y explica que guardar no es publicar', () => {
    const html = paint(LIBRE);

    expect(html).toContain('data-action="publish"');
    expect(html).toContain('Publicar cambios del sitio');
    expect(siteStatusMessage(LIBRE).text).toContain('no se ven en el sitio hasta que los publicas');
  });

  it('no ofrece lo que no aplica', () => {
    const html = paint(LIBRE);

    expect(html).not.toContain('data-action="reconcile"');
    expect(html).not.toContain('data-action="abandon"');
    expect(html).not.toContain('data-action="refresh"');
  });

  it('mientras no se sabe el estado, no ofrece nada', () => {
    const html = paint(null);

    expect(html).toContain('Cargando');
    expect(html).not.toContain('data-action=');
  });
});

/* -------------------------------------------------------------------------- */
/* Confirmacion y doble clic                                                  */
/* -------------------------------------------------------------------------- */

describe('publicar pide confirmacion', () => {
  it('el primer clic no publica: abre la confirmacion', () => {
    const html = paint(LIBRE, { pendingConfirm: 'publish' });

    expect(html).toContain('data-action="confirm-publish"');
    expect(html).toContain('Sí, publicar');
    expect(html).toContain('data-action="cancel"');
    // Y el boton de publicar desaparece: no caben los dos a la vez.
    expect(html).not.toContain('data-action="publish"');
  });

  it('dice que ninguna propiedad cambia de estado', () => {
    expect(paint(LIBRE, { pendingConfirm: 'publish' })).toContain(
      'Ninguna propiedad cambia de estado',
    );
  });

  it('mientras hay una peticion en vuelo, los botones no responden', () => {
    const confirmando = paint(LIBRE, { pendingConfirm: 'publish', busy: true });
    expect(confirmando).toContain('data-action="confirm-publish" disabled');

    const enMarcha = paint(enCurso('building'), { busy: true });
    expect(enMarcha).toContain('data-action="refresh" disabled');
    expect(enMarcha).toContain('data-action="reconcile" disabled');
  });

  it('el candado esta en el codigo, no solo en el atributo', () => {
    // `disabled` solo desactiva el raton; `busy` rechaza tambien la llamada.
    expect(read(PANEL)).toContain('if (busy) return;');
  });
});

/* -------------------------------------------------------------------------- */
/* Cada estado de la operacion                                                */
/* -------------------------------------------------------------------------- */

describe('lo que se cuenta en cada estado', () => {
  it('pending: anotada y preparando', () => {
    expect(siteStatusMessage(enCurso('pending')).text).toContain('Preparando');
  });

  it('building: en curso, y todavia no esta en la web', () => {
    const aviso = siteStatusMessage(enCurso('building'));

    expect(aviso.text).toContain('en curso');
    expect(aviso.text).toContain('Todavía no está en la web');
    expect(aviso.kind).toBe('warn');
  });

  it('done: completada, y se dice con tono de exito', () => {
    const aviso = siteStatusMessage(terminado('done'));

    expect(aviso.text).toContain('completada');
    expect(aviso.kind).toBe('ok');
  });

  it('failed: fallida, con el motivo si lo hay', () => {
    const aviso = siteStatusMessage(terminado('failed', 'el ejecutor no acepto el trabajo'));

    expect(aviso.text).toContain('fallida');
    expect(aviso.text).toContain('el ejecutor no acepto el trabajo');
    expect(aviso.kind).toBe('error');
  });

  it('abandoned: NO se cuenta como fallida', () => {
    const aviso = siteStatusMessage(terminado('abandoned'));

    expect(aviso.text).toContain('abandonada');
    expect(aviso.text).not.toContain('fallida');
  });

  it('tras terminar, se puede volver a publicar', () => {
    expect(paint(terminado('done'))).toContain('data-action="publish"');
    expect(paint(terminado('failed', 'algo'))).toContain('data-action="publish"');
  });
});

/* -------------------------------------------------------------------------- */
/* Bloqueo por una propiedad                                                  */
/* -------------------------------------------------------------------------- */

describe('cuando lo que bloquea es una propiedad', () => {
  const bloqueado: SitePublicationState = {
    current: null,
    last: null,
    canPublish: false,
    canReconcile: false,
    canAbandon: false,
    blockedByPropertyId: 42,
  };

  it('no deja pedir otra', () => {
    expect(paint(bloqueado)).not.toContain('data-action="publish"');
  });

  it('lo explica sin hablar de candados ni de operaciones internas', () => {
    const aviso = siteStatusMessage(bloqueado);

    expect(aviso.text).toContain('otra publicación en curso');
    expect(aviso.text).not.toContain('candado');
    expect(aviso.text).not.toContain('publish_site');
    // Ni el numero de la propiedad, que no le dice nada a quien mira.
    expect(aviso.text).not.toContain('42');
  });
});

/* -------------------------------------------------------------------------- */
/* Reconciliar y abandonar                                                    */
/* -------------------------------------------------------------------------- */

describe('las acciones de una operacion en curso', () => {
  it('ofrece comprobar y abandonar mientras espera', () => {
    const html = paint(enCurso('building'));

    expect(html).toContain('data-action="reconcile"');
    expect(html).toContain('Comprobar si ya se publicó');
    expect(html).toContain('data-action="abandon"');
  });

  it('no ofrece abandonar cuando el artefacto ya la demuestra', () => {
    const html = paint({ ...enCurso('building'), canAbandon: false });

    expect(html).toContain('data-action="reconcile"');
    expect(html).not.toContain('data-action="abandon"');
  });

  it('abandonar se explica por lo que NO hace', () => {
    const html = paint(enCurso('building'), { pendingConfirm: 'abandon' });

    expect(html).toContain('no publica nada ni deshace nada');
    expect(html).toContain('se queda como está');
    expect(html).toContain('quedará registrada como');
    // Y nunca se presenta como cancelar un despliegue.
    expect(html.toLowerCase()).not.toContain('cancelar el despliegue');
    expect(html.toLowerCase()).not.toContain('cancelar deploy');
  });

  it('el motivo del abandono es opcional', () => {
    expect(paint(enCurso('building'), { pendingConfirm: 'abandon' })).toContain('(opcional)');
  });
});

/* -------------------------------------------------------------------------- */
/* Errores                                                                    */
/* -------------------------------------------------------------------------- */

describe('los errores', () => {
  it('el aviso recibido manda sobre el mensaje por defecto', () => {
    const html = paint(LIBRE, {
      notice: { text: 'Ya hay una publicación del sitio en curso.', kind: 'error' },
    });

    expect(html).toContain('Ya hay una publicación del sitio en curso.');
    expect(html).toContain('data-kind="error"');
  });

  it('un fallo de red se cuenta sin detalles', () => {
    const fuente = read(PANEL);

    expect(fuente).toContain('No se pudo contactar con el servidor');
    // Nada de volcar el error al usuario.
    expect(fuente).not.toMatch(/notice = \{ text: String\(error\)/);
  });

  it('el HTML del servidor se escapa antes de pintarse', () => {
    const html = paint(LIBRE, { notice: { text: '<img src=x onerror=alert(1)>', kind: 'error' } });

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

/* -------------------------------------------------------------------------- */
/* La pagina                                                                  */
/* -------------------------------------------------------------------------- */

describe('Configuracion R1', () => {
  it('guardar es suficiente y el panel historico no se monta', () => {
    const page = read(PAGE);
    expect(page).not.toContain('id="site-publication"');
    expect(page).not.toContain('initSitePublicationPanel');
    expect(page).not.toContain('Publicar los cambios');
    expect(page).toContain('Los cambios guardados se muestran al momento');
  });
});

/* -------------------------------------------------------------------------- */
/* Lo que el panel NO hace                                                    */
/* -------------------------------------------------------------------------- */

describe('el panel no toca nada de las propiedades', () => {
  const fuente = read(PANEL);

  it('solo habla con su propia ruta', () => {
    const rutas = [...fuente.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]);

    expect(rutas).toEqual(['/api/admin/publication/site']);
  });

  it('no escribe en ningun formulario de configuracion', () => {
    // Solo pinta dentro de su caja.
    expect(fuente).not.toContain('document.forms');
    expect(fuente).not.toContain("querySelector('form')");
  });

  it('no le habla al usuario de proveedores ni de infraestructura', () => {
    /*
     * Se mira lo que se PINTA, en todos los estados, no el codigo fuente: el
     * fuente contiene `publication-actions` como clase de CSS, que no es
     * ninguna filtracion. Lo que no puede aparecer es en la pantalla.
     */
    const pantallas = [
      paint(LIBRE),
      paint(LIBRE, { pendingConfirm: 'publish' }),
      paint(enCurso('pending')),
      paint(enCurso('building')),
      paint(enCurso('building'), { pendingConfirm: 'abandon' }),
      paint(terminado('done')),
      paint(terminado('failed', 'no se pudo')),
      paint(terminado('abandoned')),
    ];

    /* Solo el texto visible: fuera etiquetas, atributos y clases. */
    const visible = pantallas
      .map((html) => html.replace(/<[^>]*>/g, ' '))
      .join(' ')
      .toLowerCase();

    for (const palabra of [
      'github',
      'actions',
      'cloudflare',
      'workflow',
      'runner',
      'deploy',
      'build',
    ]) {
      expect(visible, `se coló "${palabra}"`).not.toContain(palabra);
    }
  });
});
