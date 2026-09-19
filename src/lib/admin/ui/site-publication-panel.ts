/**
 * Publicar los cambios del sitio.
 *
 * Existe por una confusion que la pantalla tiene que deshacer: guardar no es
 * publicar. La configuracion y la media del sitio se guardan en la base al
 * instante, pero el sitio publico es estatico y se construyo antes, asi que no
 * se entera hasta que alguien pide reconstruirlo. Este panel es ese boton.
 *
 * Habla el mismo idioma que el panel de una ficha —reutiliza sus textos de
 * estado— y evita a proposito cualquier palabra de infraestructura: aqui no
 * hay builds, ni runners, ni proveedores. Hay cambios que estan en la web y
 * cambios que todavia no.
 */

import { reconciliationMessage, requestSummary, ACTION_LABELS } from './legacy-publication-labels';
import type { ReconciliationReason } from '../../publication/publication';

const ENDPOINT = '/api/admin/publication/site';

function byId<T extends object>(id: string): T | null {
  return (document.getElementById(id) as T | null) ?? null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SiteRequest {
  id: number;
  action: string;
  status: string;
  errorSummary: string | null;
  requestedAt: string;
  finishedAt: string | null;
  isActive: boolean;
}

export interface SitePublicationState {
  current: SiteRequest | null;
  last: SiteRequest | null;
  canPublish: boolean;
  canReconcile: boolean;
  canAbandon: boolean;
  blockedByPropertyId: number | null;
}

/** Lo que hay que enseñar arriba del todo, y con que tono. */
export interface SiteNotice {
  text: string;
  kind: 'ok' | 'warn' | 'error';
}

/**
 * Que cuenta el panel segun el estado.
 *
 * Funcion pura y exportada porque es lo unico del panel con decisiones de
 * verdad: el resto es pintar. Cada rama dice lo que la base afirma, ni una
 * palabra mas.
 */
export function siteStatusMessage(state: SitePublicationState): SiteNotice {
  if (state.current !== null) {
    return { text: requestSummary(state.current), kind: 'warn' };
  }

  if (state.blockedByPropertyId !== null) {
    return {
      text:
        'Hay otra publicación en curso en este momento. Cuando termine podrás ' +
        'publicar los cambios del sitio.',
      kind: 'warn',
    };
  }

  if (state.last !== null) {
    return {
      text: requestSummary(state.last),
      kind: state.last.status === 'done' ? 'ok' : 'error',
    };
  }

  return {
    text: 'Los cambios que guardes aquí no se ven en el sitio hasta que los publicas.',
    kind: 'ok',
  };
}

/** Lo que espera confirmacion, si algo lo espera. */
export type SitePendingConfirm = 'publish' | 'abandon' | null;

export interface SitePanelView {
  state: SitePublicationState | null;
  pendingConfirm: SitePendingConfirm;
  busy: boolean;
  notice: SiteNotice | null;
}

/**
 * El panel entero, como cadena.
 *
 * Tambien puro: recibe el estado y devuelve el HTML, sin tocar el documento.
 * Asi cada situacion —sin operacion, en curso, fallida, bloqueada— se puede
 * probar sin navegador.
 */
export function renderSitePanel(view: SitePanelView): string {
  const { state, pendingConfirm, busy, notice } = view;

  if (state === null) {
    return '<p class="publication-current">Cargando el estado de publicación…</p>';
  }

  const aviso = notice ?? siteStatusMessage(state);

  const cabecera =
    `<p class="publication-current" data-status="${escapeHtml(state.current?.status ?? 'idle')}" data-kind="${aviso.kind}">` +
    escapeHtml(aviso.text) +
    '</p>';

  /* La confirmacion sustituye a los botones: no caben las dos cosas a la vez. */
  if (pendingConfirm === 'publish') {
    return (
      cabecera +
      '<div class="publication-confirm" role="group" aria-label="Confirmar publicación del sitio">' +
      '<p>Se reconstruirá el sitio público con la configuración guardada. ' +
      'Ninguna propiedad cambia de estado.</p>' +
      '<div class="publication-actions">' +
      `<button type="button" class="admin-button admin-button-primary" data-action="confirm-publish"${busy ? ' disabled' : ''}>Sí, publicar</button>` +
      '<button type="button" class="admin-button" data-action="cancel">Cancelar</button>' +
      '</div></div>'
    );
  }

  if (pendingConfirm === 'abandon') {
    return (
      cabecera +
      '<div class="publication-confirm" role="group" aria-label="Confirmar abandono">' +
      '<p><strong>Esto no publica nada ni deshace nada.</strong> El sitio en línea se ' +
      'queda como está. Solo deja de esperar a esta operación para que puedas pedir otra.</p>' +
      '<p class="admin-muted">No se da por hecho que haya fallado: quedará registrada como ' +
      'abandonada.</p>' +
      '<label class="publication-reason" for="site-abandon-reason">Motivo (opcional)' +
      '<input type="text" id="site-abandon-reason" maxlength="200" ' +
      'placeholder="Por ejemplo: se perdió el aviso"></label>' +
      '<div class="publication-actions">' +
      `<button type="button" class="admin-button admin-button-primary" data-action="confirm-abandon"${busy ? ' disabled' : ''}>Sí, abandonar</button>` +
      '<button type="button" class="admin-button" data-action="cancel">Cancelar</button>' +
      '</div></div>'
    );
  }

  const deshabilitado = busy ? ' disabled' : '';

  const botones =
    '<div class="publication-actions">' +
    (state.canPublish
      ? `<button type="button" class="admin-button admin-button-primary" data-action="publish"${deshabilitado}>Publicar cambios del sitio</button>`
      : '') +
    (state.current !== null
      ? `<button type="button" class="admin-button" data-action="refresh"${deshabilitado}>Actualizar estado</button>`
      : '') +
    (state.canReconcile
      ? `<button type="button" class="admin-button" data-action="reconcile"${deshabilitado}>Comprobar si ya se publicó</button>`
      : '') +
    (state.canAbandon
      ? `<button type="button" class="admin-button publication-abandon" data-action="abandon"${deshabilitado}>Abandonar operación</button>`
      : '') +
    '</div>';

  return cabecera + botones;
}

/* -------------------------------------------------------------------------- */
/* Enganche                                                                   */
/* -------------------------------------------------------------------------- */

interface Respuesta {
  ok?: boolean;
  data?: {
    site?: SitePublicationState;
    reconciliation?: { reconciled: boolean; reason: ReconciliationReason };
  };
  error?: { message?: string };
}

export function initSitePublicationPanel(): void {
  const box = byId<HTMLElement>('site-publication');
  if (box === null) return;

  let state: SitePublicationState | null = null;
  let pendingConfirm: SitePendingConfirm = null;
  let notice: SiteNotice | null = null;
  let busy = false;

  const paint = (): void => {
    box.innerHTML = renderSitePanel({ state, pendingConfirm, busy, notice });
  };

  /**
   * Una llamada, con el candado puesto.
   *
   * `busy` no es cosmetico: mientras hay una peticion en vuelo los botones se
   * deshabilitan Y se rechaza cualquier otra. Un doble clic en "publicar"
   * anotaria dos operaciones, y la segunda chocaria con el candado de la base
   * dando un error que no le dice nada a nadie.
   */
  const call = async (method: string, body?: unknown): Promise<void> => {
    if (busy) return;

    busy = true;
    paint();

    try {
      const response = await fetch(ENDPOINT, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const payload = (await response.json().catch(() => ({}))) as Respuesta;

      if (!response.ok) {
        notice = {
          text: payload.error?.message ?? 'No se pudo completar la operación.',
          kind: 'error',
        };
      } else {
        notice = null;
        if (payload.data?.site !== undefined) state = payload.data.site;

        const rec = payload.data?.reconciliation;
        if (rec !== undefined) {
          const dicho = reconciliationMessage(rec.reason);
          notice = { text: dicho.text, kind: rec.reconciled ? 'ok' : 'warn' };
        }
      }
    } catch {
      /* Sin detalles: un fallo de red no tiene nada que contarle a nadie. */
      notice = { text: 'No se pudo contactar con el servidor. Inténtalo otra vez.', kind: 'error' };
    } finally {
      busy = false;
      pendingConfirm = null;
      paint();
    }
  };

  box.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset['action'];
    if (action === undefined) return;

    if (action === 'cancel') {
      pendingConfirm = null;
      paint();
      return;
    }

    /* Publicar y abandonar piden confirmacion. No son acciones de un clic. */
    if (action === 'publish' || action === 'abandon') {
      pendingConfirm = action;
      notice = null;
      paint();
      return;
    }

    if (action === 'confirm-publish') {
      void call('POST');
      return;
    }

    if (action === 'confirm-abandon') {
      const input = byId<HTMLInputElement>('site-abandon-reason');
      const reason = input?.value.trim() ?? '';
      void call('DELETE', reason.length === 0 ? {} : { reason });
      return;
    }

    if (action === 'reconcile') {
      void call('PUT');
      return;
    }

    if (action === 'refresh') void call('GET');
  });

  paint();
  void call('GET');
}

/* Se reexporta para que los tests del panel puedan leer las etiquetas. */
export { ACTION_LABELS };
