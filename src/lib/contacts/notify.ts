/**
 * Aviso al administrador cuando entra una consulta.
 *
 * Regla que manda sobre todo lo demas: **la consulta ya esta guardada cuando
 * esto se ejecuta**. Un fallo de Resend, una clave caducada o un corte de red
 * no pueden perderla ni convertirse en un error para quien la envio. Por eso
 * esta funcion no lanza nunca: devuelve como fue y quien llama decide si lo
 * registra.
 *
 * Sin credenciales no se intenta nada y se dice `skipped`, no `failed`: en
 * desarrollo y en el build no hay claves, y eso no es un fallo.
 *
 * No hay dependencia de Resend: son un `fetch` y un JSON. Anadir su SDK seria
 * traer un paquete para construir un objeto.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface LeadNotification {
  id: number;
  name: string;
  method: string;
  contactValue: string;
  message: string | null;
  locale: string;
  propertyCode: string | null;
  propertyTitle: string | null;
}

export interface NotifyDeps {
  /** Clave de Resend. `null` en desarrollo y en el build. */
  apiKey: string | null;
  /** Remitente verificado en Resend. */
  from: string | null;
  /** Destinatario, que sale de la configuracion del sitio. */
  to: string | null;
  /** Se inyecta para poder probar sin salir a la red. */
  fetch?: typeof globalThis.fetch;
}

export type NotifyOutcome =
  /** Enviado. */
  | { status: 'sent' }
  /** Faltaba configuracion; no se intento. */
  | { status: 'skipped'; reason: 'missing_key' | 'missing_from' | 'missing_recipient' }
  /** Se intento y no salio. La consulta sigue guardada. */
  | { status: 'failed'; reason: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Asunto reconocible de un vistazo en la bandeja. */
export function notificationSubject(lead: LeadNotification): string {
  return lead.propertyCode === null
    ? `Nueva consulta de ${lead.name}`
    : `Nueva consulta sobre ${lead.propertyCode} de ${lead.name}`;
}

export function notificationHtml(lead: LeadNotification): string {
  const rows: [string, string][] = [
    ['Nombre', lead.name],
    ['Medio preferido', lead.method],
    ['Contacto', lead.contactValue],
    ['Idioma', lead.locale],
  ];

  if (lead.propertyCode !== null) {
    rows.push(['Propiedad', `${lead.propertyCode} — ${lead.propertyTitle ?? ''}`.trim()]);
  }

  const table = rows
    .map(([label, value]) => `<tr><th align="left">${label}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');

  const message =
    lead.message === null
      ? ''
      : `<p><strong>Mensaje</strong></p><p>${escapeHtml(lead.message).replace(/\n/g, '<br>')}</p>`;

  return `<h2>${escapeHtml(notificationSubject(lead))}</h2><table>${table}</table>${message}`;
}

/**
 * Envia el aviso.
 *
 * Nunca lanza. Cualquier error se convierte en `failed` con un motivo corto,
 * pensado para quedar en el log del Worker, no para ensenarselo a nadie.
 */
export async function notifyNewLead(
  deps: NotifyDeps,
  lead: LeadNotification,
): Promise<NotifyOutcome> {
  if (deps.apiKey === null || deps.apiKey.length === 0) {
    return { status: 'skipped', reason: 'missing_key' };
  }
  if (deps.from === null || deps.from.length === 0) {
    return { status: 'skipped', reason: 'missing_from' };
  }
  if (deps.to === null || deps.to.length === 0) {
    return { status: 'skipped', reason: 'missing_recipient' };
  }

  const send = deps.fetch ?? globalThis.fetch;

  try {
    const response = await send(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: deps.from,
        to: [deps.to],
        subject: notificationSubject(lead),
        html: notificationHtml(lead),
      }),
    });

    if (!response.ok) return { status: 'failed', reason: `http_${response.status}` };

    return { status: 'sent' };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.name : 'unknown',
    };
  }
}
