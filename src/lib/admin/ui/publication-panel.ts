import type { DirectPublicationState } from '../properties/direct-publication';
import type { PublicationStatus } from '../../domain/vocabularies';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPublicationPanel(state: DirectPublicationState, busy = false): string {
  const disabled = busy ? ' disabled' : '';
  if (state.publicationStatus === 'published') {
    return `<p>Publicada</p><div class="publication-actions">
      ${state.href === null ? '' : `<a class="admin-button" href="${escapeHtml(state.href)}">Ver propiedad</a>`}
      <button type="button" class="admin-button" data-action="unpublish"${disabled}>Retirar</button>
    </div>`;
  }
  if (state.publicationStatus === 'archived')
    return '<p>Restaura la propiedad a borrador antes de publicarla.</p>';
  return `<button type="button" class="admin-button admin-button-primary" data-action="publish"${disabled}>Publicar propiedad</button>`;
}

export function publicationErrorMessages(body: unknown): string[] {
  const error = (
    body as { error?: { message?: string; details?: { issues?: { message: string }[] } } }
  )?.error;
  return (
    error?.details?.issues?.map((issue) => issue.message) ?? [
      error?.message ?? 'No pudimos completar la operación.',
    ]
  );
}

export function initPublicationPanel(
  propertyId: number,
  editor: {
    save: () => Promise<boolean>;
    onStatus: (status: PublicationStatus) => void;
  },
): void {
  const box = document.getElementById('admin-publication');
  if (box === null) return;
  const base = `/api/admin/properties/${propertyId}/publication`;
  let state: DirectPublicationState | null = null;
  let busy = false;
  let errors: string[] = [];

  const render = () => {
    box.innerHTML = `${state === null ? '<p>Cargando publicación…</p>' : renderPublicationPanel(state, busy)}
      <div role="status" aria-live="polite">${errors.length === 0 ? '' : `<ul>${errors.map((message) => `<li>${escapeHtml(message)}</li>`).join('')}</ul>`}</div>`;
  };
  const read = async () => {
    try {
      const response = await fetch(base, { headers: { accept: 'application/json' } });
      const body = (await response.json()) as { data: DirectPublicationState };
      if (response.ok) {
        state = body.data;
        editor.onStatus(state.publicationStatus);
      } else errors = publicationErrorMessages(body);
    } catch {
      errors = ['No se pudo contactar con el servidor. Recarga la página para volver a intentar.'];
    }
    render();
  };

  box.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.dataset.action;
    if (action !== 'publish' && action !== 'unpublish') return;
    if (busy) return;
    busy = true;
    errors = [];
    render();
    try {
      // El mismo coordinador guarda primero; ningun autosave paralelo de publicacion.
      if (!(await editor.save())) {
        errors = ['Hay cambios sin guardar. Corrige los errores de guardado antes de continuar.'];
        return;
      }
      const response = await fetch(`${base}/${action}`, {
        method: 'POST',
        headers: { accept: 'application/json' },
      });
      const body = (await response.json()) as { data: DirectPublicationState };
      if (response.ok) {
        state = body.data;
        editor.onStatus(state.publicationStatus);
      } else errors = publicationErrorMessages(body);
    } catch {
      errors = [
        'No se pudo contactar con el servidor. Recarga la página para comprobar el estado.',
      ];
    } finally {
      busy = false;
      render();
    }
  });
  void read();
}
