/**
 * Panel de publicacion dentro del editor.
 *
 * Lo que esta pantalla tiene que dejar claro es que publicar NO es inmediato:
 * entre pedirlo y verlo en la web hay un build que ocurre en otro sitio y que
 * puede fallar. Por eso hay dos estados a la vista y no uno —el editorial de
 * la propiedad y el de la operacion en curso— y por eso el panel NUNCA dice
 * "publicada" antes de que el servidor lo diga: todo lo que pinta viene de la
 * respuesta, jamas de suponer que la peticion saldra bien.
 *
 * Publicar y retirar piden confirmacion explicita. No son acciones que se
 * puedan deshacer solas: cambian lo que ve cualquiera que entre al sitio.
 *
 * El panel no sabe quien construye el sitio, y no debe saberlo. Aqui no hay
 * ni una mencion a GitHub ni a Cloudflare: hay "se esta preparando" y "ya
 * esta".
 */

/*
 * Aserciones en vez del generico de `querySelector`: los tipos del runtime de
 * Workers definen su propio `Element` (el de HTMLRewriter) y chocan con el DOM.
 */
function byId<T extends object>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface PublicationRequest {
  id: number;
  action: string;
  status: string;
  errorSummary: string | null;
  requestedAt: string;
  finishedAt: string | null;
  isActive: boolean;
}

interface PublicationIssue {
  code: string;
  section: string;
  message: string;
}

interface PublicationState {
  propertyId: number;
  publicationStatus: string;
  canPublish: boolean;
  canUnpublish: boolean;
  issues: PublicationIssue[];
  current: PublicationRequest | null;
  history: PublicationRequest[];
}

interface ManualInstructions {
  callbackPath: string;
  callbackToken: string;
}

const PUBLICATION_LABELS: Record<string, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  approved: 'Aprobada',
  published: 'Publicada',
  archived: 'Archivada',
};

const ACTION_LABELS: Record<string, string> = {
  publish: 'Publicación',
  unpublish: 'Retirada',
};

/**
 * Como se cuenta el estado de una operacion.
 *
 * Ni una palabra sobre builds ni sobre proveedores: lo unico que le importa a
 * quien mira es si ya esta, si sigue en marcha o si hay que volver a
 * intentarlo.
 */
export function requestSummary(request: PublicationRequest): string {
  const what = ACTION_LABELS[request.action] ?? 'Operación';

  if (request.status === 'pending') return `${what} anotada. Preparando…`;
  if (request.status === 'building') return `${what} en curso. Todavía no está en la web.`;
  if (request.status === 'done') return `${what} completada.`;

  return request.errorSummary === null
    ? `${what} fallida. Vuelve a intentarlo.`
    : `${what} fallida: ${request.errorSummary}`;
}

function formatDate(iso: string | null): string {
  if (iso === null) return '—';

  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** El identificador de la propiedad sale de la URL del editor. */
function propertyIdFromPath(): number | null {
  const match = /\/admin\/propiedades\/(\d+)/.exec(location.pathname);
  const id = match === null ? Number.NaN : Number(match[1]);

  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function initPublicationPanel(): void {
  const box = byId<HTMLElement>('admin-publication');
  if (box === null) return;

  const propertyId = propertyIdFromPath();
  if (propertyId === null) return;

  let state: PublicationState | null = null;
  /** Instrucciones manuales recien recibidas. Viven en memoria y no vuelven. */
  let manual: ManualInstructions | null = null;
  /** Que accion esta esperando confirmacion. */
  let pendingConfirm: 'publish' | 'unpublish' | null = null;
  let busy = false;
  let message = '';

  const issuesHtml = (issues: PublicationIssue[]): string => {
    if (issues.length === 0) return '';

    return (
      '<div class="publication-issues"><p>Para publicarla falta:</p><ul>' +
      issues.map((issue) => `<li>${escapeHtml(issue.message)}</li>`).join('') +
      '</ul></div>'
    );
  };

  const historyHtml = (requests: PublicationRequest[]): string => {
    const past = requests.filter((request) => !request.isActive);
    if (past.length === 0) return '';

    return (
      '<div class="publication-history"><h3>Historial</h3><ul>' +
      past
        .map(
          (request) =>
            '<li>' +
            `<span class="publication-chip publication-chip-${escapeHtml(request.status)}">${escapeHtml(ACTION_LABELS[request.action] ?? request.action)}</span> ` +
            `<span class="publication-history-date">${escapeHtml(formatDate(request.finishedAt ?? request.requestedAt))}</span>` +
            (request.errorSummary === null
              ? ''
              : `<p class="publication-history-error">${escapeHtml(request.errorSummary)}</p>`) +
            '</li>',
        )
        .join('') +
      '</ul></div>'
    );
  };

  const manualHtml = (): string => {
    if (manual === null) return '';

    return (
      '<div class="publication-manual">' +
      '<p><strong>Falta el paso manual.</strong> Genera y despliega el sitio y confirma el ' +
      'resultado con este token. No se vuelve a mostrar.</p>' +
      `<input class="publication-token-input" id="publication-token" type="text" readonly value="${escapeHtml(manual.callbackToken)}">` +
      '<button type="button" class="admin-button" data-action="copy">Copiar token</button>' +
      `<p class="admin-muted">Confirmación: <code>POST ${escapeHtml(manual.callbackPath)}</code></p>` +
      '</div>'
    );
  };

  const confirmHtml = (): string => {
    if (pendingConfirm === null) return '';

    const publishing = pendingConfirm === 'publish';

    return (
      '<div class="publication-confirm" role="group" aria-label="Confirmar operación">' +
      `<p>${
        publishing
          ? 'La ficha pasará a estar visible en el sitio público cuando termine la preparación.'
          : 'La ficha dejará de verse en el sitio público cuando termine la preparación.'
      }</p>` +
      '<div class="publication-actions">' +
      `<button type="button" class="admin-button admin-button-primary" data-action="${publishing ? 'confirm-publish' : 'confirm-unpublish'}">${
        publishing ? 'Sí, publicar' : 'Sí, retirar'
      }</button>` +
      '<button type="button" class="admin-button" data-action="cancel">Cancelar</button>' +
      '</div>' +
      '</div>'
    );
  };

  const render = (): void => {
    if (state === null) {
      box.innerHTML = '<p class="admin-muted">No se pudo cargar el estado de publicación.</p>';
      return;
    }

    const status = PUBLICATION_LABELS[state.publicationStatus] ?? state.publicationStatus;
    const current = state.current;

    const currentBlock =
      current === null
        ? ''
        : `<p class="publication-current" data-status="${escapeHtml(current.status)}">${escapeHtml(requestSummary(current))}</p>`;

    const lastFailed = state.history.find((request) => !request.isActive);
    const failureBlock =
      current === null && lastFailed?.status === 'failed'
        ? `<p class="publication-current" data-status="failed">${escapeHtml(requestSummary(lastFailed))}</p>`
        : '';

    /*
     * Los botones solo aparecen cuando el servidor dice que la operacion es
     * posible. No se deducen del estado editorial por si solo: con una
     * operacion viva tampoco se puede pedir otra.
     */
    const actions =
      pendingConfirm !== null
        ? ''
        : '<div class="publication-actions">' +
          (state.canPublish
            ? '<button type="button" class="admin-button admin-button-primary" data-action="publish">Publicar</button>'
            : '') +
          (state.canUnpublish
            ? '<button type="button" class="admin-button" data-action="unpublish">Retirar</button>'
            : '') +
          (current !== null
            ? '<button type="button" class="admin-button" data-action="refresh">Actualizar estado</button>'
            : '') +
          '</div>';

    box.innerHTML =
      `<p class="publication-state">Estado editorial: <strong>${escapeHtml(status)}</strong></p>` +
      currentBlock +
      failureBlock +
      (state.publicationStatus === 'approved' && !state.canPublish && current === null
        ? issuesHtml(state.issues)
        : '') +
      manualHtml() +
      confirmHtml() +
      actions +
      `<p class="editor-error" id="publication-error" role="alert"${message.length === 0 ? ' hidden' : ''}>${escapeHtml(message)}</p>` +
      historyHtml(state.history);
  };

  const say = (text: string): void => {
    message = text;
    render();
  };

  const load = async (): Promise<void> => {
    try {
      const response = await fetch(`/api/admin/properties/${propertyId}/publication`, {
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        state = null;
        render();
        return;
      }

      const body = (await response.json()) as { data?: PublicationState };
      state = body.data ?? null;
      render();
    } catch {
      state = null;
      render();
    }
  };

  const send = async (action: 'publish' | 'unpublish'): Promise<void> => {
    if (busy) return;
    busy = true;

    try {
      const response = await fetch(`/api/admin/properties/${propertyId}/publication/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({}),
      });

      const body = (await response.json()) as {
        data?: { publication: PublicationState; manual: ManualInstructions | null };
        error?: { message?: string };
      };

      if (!response.ok) {
        // El motivo viene del servidor: es el unico que sabe por que no se pudo.
        say(body.error?.message ?? 'No se pudo completar la operación.');
        // Puede haber cambiado algo mientras tanto.
        await load();
        return;
      }

      const data = body.data;
      if (data === undefined) {
        say('No se pudo completar la operación.');
        return;
      }

      state = data.publication;
      manual = data.manual;
      message = '';
      render();
    } catch {
      say('Sin conexión con el servidor.');
    } finally {
      busy = false;
    }
  };

  box.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    if (action === undefined) return;

    if (action === 'copy') {
      const input = byId<HTMLInputElement>('publication-token');
      if (input === null) return;

      input.select();
      void navigator.clipboard?.writeText(input.value).catch(() => {
        // Sin permiso de portapapeles queda seleccionado para copiar a mano.
      });
      return;
    }

    if (action === 'publish' || action === 'unpublish') {
      pendingConfirm = action;
      message = '';
      render();
      return;
    }

    if (action === 'cancel') {
      pendingConfirm = null;
      render();
      return;
    }

    if (action === 'refresh') {
      void load();
      return;
    }

    if (action === 'confirm-publish' || action === 'confirm-unpublish') {
      pendingConfirm = null;
      render();
      void send(action === 'confirm-publish' ? 'publish' : 'unpublish');
    }
  });

  void load();
}
