/**
 * Panel de revision dentro del editor.
 *
 * Sobrio a proposito: estado actual, un boton para pedir enlace, el enlace
 * recien creado y el historial. No hay sistema de usuarios ni de revisores:
 * el enlace ES la credencial.
 *
 * El token solo existe en la respuesta que lo crea. Se enseña una vez, se
 * puede copiar, y al recargar la pagina ya no esta: lo que se guarda es su
 * hash. Por eso el aviso de "cópialo ahora" no es decorativo.
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

interface ReviewLink {
  id: number;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
}

interface Review {
  id: number;
  status: string;
  reviewerEmail: string | null;
  reviewerComment: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  link: ReviewLink | null;
}

interface ReviewState {
  propertyId: number;
  publicationStatus: string;
  current: Review | null;
  history: Review[];
}

const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  changes_requested: 'Cambios pedidos',
  cancelled: 'Cancelada',
};

const PUBLICATION_LABELS: Record<string, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  approved: 'Aprobada',
  published: 'Publicada',
  archived: 'Archivada',
};

function formatDate(iso: string | null): string {
  if (iso === null) return '—';

  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Que se puede hacer con el enlace de una revision, en una frase. */
export function linkSummary(link: ReviewLink | null): string {
  if (link === null) return 'Sin enlace generado.';
  if (link.revokedAt !== null) return `Enlace revocado el ${formatDate(link.revokedAt)}.`;
  if (link.usedAt !== null) return `Enlace usado el ${formatDate(link.usedAt)}.`;
  if (!link.isActive) return `Enlace caducado el ${formatDate(link.expiresAt)}.`;

  return `Enlace activo hasta el ${formatDate(link.expiresAt)}.`;
}

/** El identificador de la propiedad sale de la URL del editor. */
function propertyIdFromPath(): number | null {
  const match = /\/admin\/propiedades\/(\d+)/.exec(location.pathname);
  const id = match === null ? Number.NaN : Number(match[1]);

  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function initReviewPanel(): void {
  const box = byId<HTMLElement>('admin-review');
  if (box === null) return;

  const propertyId = propertyIdFromPath();
  if (propertyId === null) return;

  let state: ReviewState | null = null;
  /** El token recien creado. Vive en memoria y muere al recargar. */
  let freshToken: string | null = null;
  let freshExpiry: string | null = null;

  const say = (message: string): void => {
    const error = byId<HTMLElement>('review-error');
    if (error === null) return;

    error.hidden = message.length === 0;
    error.textContent = message;
  };

  const historyHtml = (reviews: Review[]): string => {
    if (reviews.length === 0) return '';

    return (
      '<div class="review-history"><h3>Historial</h3><ul>' +
      reviews
        .map(
          (review) =>
            '<li>' +
            `<span class="review-chip review-chip-${escapeHtml(review.status)}">${escapeHtml(REVIEW_STATUS_LABELS[review.status] ?? review.status)}</span> ` +
            `<span class="review-history-date">${escapeHtml(formatDate(review.requestedAt))}</span>` +
            (review.reviewerComment === null
              ? ''
              : `<p class="review-history-comment">${escapeHtml(review.reviewerComment)}</p>`) +
            '</li>',
        )
        .join('') +
      '</ul></div>'
    );
  };

  const render = (): void => {
    if (state === null) {
      box.innerHTML = '<p class="admin-muted">No se pudo cargar la revisión.</p>';
      return;
    }

    const current = state.current;
    const status = PUBLICATION_LABELS[state.publicationStatus] ?? state.publicationStatus;

    const fresh =
      freshToken === null
        ? ''
        : '<div class="review-fresh">' +
          '<p><strong>Copia este enlace ahora.</strong> No se vuelve a mostrar: en la base solo queda su huella.</p>' +
          `<input class="review-link-input" id="review-link" type="text" readonly value="${escapeHtml(location.origin)}/review/${escapeHtml(freshToken)}">` +
          '<button type="button" class="admin-button admin-button-primary" data-action="copy">Copiar enlace</button>' +
          (freshExpiry === null
            ? ''
            : `<p class="admin-muted">Caduca el ${escapeHtml(formatDate(freshExpiry))}.</p>`) +
          '</div>';

    const currentBlock =
      current === null
        ? '<p class="admin-muted">Esta propiedad no está en revisión.</p>'
        : '<p class="review-current">' +
          `<span class="review-chip review-chip-${escapeHtml(current.status)}">${escapeHtml(REVIEW_STATUS_LABELS[current.status] ?? current.status)}</span> ` +
          `${escapeHtml(linkSummary(current.link))}</p>`;

    box.innerHTML =
      `<p class="review-state">Estado editorial: <strong>${escapeHtml(status)}</strong></p>` +
      currentBlock +
      fresh +
      '<div class="review-actions-admin">' +
      `<button type="button" class="admin-button admin-button-primary" data-action="request">${
        current === null ? 'Enviar a revisión' : 'Generar enlace nuevo'
      }</button>` +
      (current?.link?.isActive === true
        ? '<button type="button" class="admin-button" data-action="revoke">Revocar enlace</button>'
        : '') +
      '</div>' +
      '<p class="editor-error" id="review-error" role="alert" hidden></p>' +
      historyHtml(state.history);
  };

  const load = async (): Promise<void> => {
    try {
      const response = await fetch(`/api/admin/properties/${propertyId}/review`, {
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        state = null;
        render();
        return;
      }

      const body = (await response.json()) as { data?: ReviewState };
      state = body.data ?? null;
      render();
    } catch {
      state = null;
      render();
    }
  };

  box.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    if (action === undefined) return;

    if (action === 'copy') {
      const input = byId<HTMLInputElement>('review-link');
      if (input === null) return;

      input.select();
      void navigator.clipboard?.writeText(input.value).catch(() => {
        // Sin permiso de portapapeles queda seleccionado para copiar a mano.
      });
      return;
    }

    void (async () => {
      const path =
        action === 'request'
          ? `/api/admin/properties/${propertyId}/review`
          : `/api/admin/properties/${propertyId}/review/revoke`;

      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          say(
            action === 'request'
              ? 'No se pudo abrir la revisión. Comprueba el estado de la propiedad.'
              : 'No se pudo revocar el enlace.',
          );
          return;
        }

        const body = (await response.json()) as {
          data?: ReviewState | { review: ReviewState; token: string; expiresAt: string };
        };

        if (action === 'request') {
          const data = body.data as { review: ReviewState; token: string; expiresAt: string };
          state = data.review;
          freshToken = data.token;
          freshExpiry = data.expiresAt;
        } else {
          state = body.data as ReviewState;
          // El enlace que se acaba de revocar no debe seguir en pantalla.
          freshToken = null;
          freshExpiry = null;
        }

        say('');
        render();
      } catch {
        say('Sin conexión con el servidor.');
      }
    })();
  });

  void load();
}
