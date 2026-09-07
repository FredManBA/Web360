/**
 * Bandeja de consultas en el navegador.
 *
 * Mismo patron que el listado de propiedades: el shell llega del servidor y
 * los datos se piden a `/api/admin/contacts`, para no saltarse la capa HTTP
 * ni duplicar consultas contra la base.
 *
 * Es una bandeja, no un CRM: leer, marcar como atendida y borrar.
 */

import { CONTACT_METHOD_LABELS, CONTACT_STATUS_LABELS } from './labels';

/*
 * Aserciones en vez del generico de `querySelector`: los tipos del runtime de
 * Workers definen su propio `Element` (el de HTMLRewriter) y chocan con el DOM.
 */
function byId<T extends object>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export interface ApiContact {
  id: number;
  name: string;
  preferredContactMethod: string;
  contactValue: string;
  messagePreview: string | null;
  message?: string | null;
  locale: string;
  status: string;
  propertyId: number | null;
  propertyCode: string | null;
  propertyTitle: string | null;
  createdAt: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Fecha corta y local; la hora importa poco en una bandeja. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Cuantas quedan sin atender; es el unico numero que interesa de un vistazo. */
export function pendingCount(contacts: readonly ApiContact[]): number {
  return contacts.filter((contact) => contact.status === 'new').length;
}

const methodLabel = (method: string): string =>
  CONTACT_METHOD_LABELS[method as keyof typeof CONTACT_METHOD_LABELS] ?? method;

const statusLabel = (status: string): string =>
  CONTACT_STATUS_LABELS[status as keyof typeof CONTACT_STATUS_LABELS] ?? status;

export function contactRowHtml(contact: ApiContact): string {
  const property =
    contact.propertyCode === null
      ? ''
      : `<p class="contact-row-property">${escapeHtml(contact.propertyCode)}${
          contact.propertyTitle === null ? '' : ` — ${escapeHtml(contact.propertyTitle)}`
        }</p>`;

  const message =
    contact.messagePreview === null
      ? ''
      : `<p class="contact-row-message">${escapeHtml(contact.messagePreview)}</p>`;

  const reviewed = contact.status === 'reviewed';

  return (
    `<article class="contact-row" data-contact="${contact.id}" data-status="${escapeHtml(contact.status)}">` +
    '<div class="contact-row-head">' +
    `<h3>${escapeHtml(contact.name)}</h3>` +
    `<span class="contact-badge contact-badge-${escapeHtml(contact.status)}">${escapeHtml(statusLabel(contact.status))}</span>` +
    '</div>' +
    `<p class="contact-row-meta">${escapeHtml(methodLabel(contact.preferredContactMethod))} · ` +
    `<strong>${escapeHtml(contact.contactValue)}</strong> · ${escapeHtml(contact.locale.toUpperCase())} · ` +
    `${escapeHtml(formatDate(contact.createdAt))}</p>` +
    property +
    message +
    '<div class="contact-row-actions">' +
    `<button type="button" class="admin-button" data-action="toggle" data-id="${contact.id}">` +
    `${reviewed ? 'Marcar como pendiente' : 'Marcar como atendida'}</button>` +
    `<button type="button" class="admin-button admin-button-danger" data-action="delete" data-id="${contact.id}">Eliminar</button>` +
    '</div>' +
    '</article>'
  );
}

export function initContactsPage(): void {
  const results = byId<HTMLElement>('contacts-results');
  const count = byId<HTMLElement>('contacts-count');
  const filter = byId<HTMLSelectElement>('contacts-filter');
  const error = byId<HTMLElement>('contacts-error');
  if (results === null) return;

  const say = (message: string): void => {
    if (error === null) return;
    error.hidden = message.length === 0;
    error.textContent = message;
  };

  let contacts: ApiContact[] = [];

  const render = (): void => {
    if (contacts.length === 0) {
      results.innerHTML = '<p class="admin-empty">No hay consultas todavía.</p>';
    } else {
      results.innerHTML = contacts.map(contactRowHtml).join('');
    }

    if (count !== null) {
      const pending = pendingCount(contacts);
      count.textContent = `${contacts.length} consulta${contacts.length === 1 ? '' : 's'} · ${pending} sin atender`;
    }
  };

  const load = async (): Promise<void> => {
    const status = filter?.value ?? '';
    const query = status === '' ? '' : `?status=${encodeURIComponent(status)}`;

    results.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(`/api/admin/contacts${query}`, {
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        say('No se pudieron cargar las consultas.');
        return;
      }

      const body = (await response.json()) as { data?: ApiContact[] };
      contacts = body.data ?? [];
      say('');
      render();
    } catch {
      say('No se pudieron cargar las consultas.');
    } finally {
      results.setAttribute('aria-busy', 'false');
    }
  };

  results.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    const id = Number(target.dataset.id);
    if (action === undefined || !Number.isFinite(id)) return;

    const contact = contacts.find((candidate) => candidate.id === id);
    if (contact === undefined) return;

    void (async () => {
      try {
        if (action === 'toggle') {
          const next = contact.status === 'reviewed' ? 'new' : 'reviewed';
          const response = await fetch(`/api/admin/contacts/${id}/status`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: next }),
          });

          if (!response.ok) {
            say('No se pudo cambiar el estado.');
            return;
          }

          contact.status = next;
          say('');
          render();
          return;
        }

        if (action === 'delete') {
          // Borrar es definitivo: no hay papelera en el modelo.
          if (!window.confirm(`¿Eliminar la consulta de ${contact.name}?`)) return;

          const response = await fetch(`/api/admin/contacts/${id}`, { method: 'DELETE' });
          if (!response.ok) {
            say('No se pudo eliminar la consulta.');
            return;
          }

          contacts = contacts.filter((candidate) => candidate.id !== id);
          say('');
          render();
        }
      } catch {
        say('No se pudo completar la acción.');
      }
    })();
  });

  filter?.addEventListener('change', () => void load());

  void load();
}
