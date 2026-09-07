/**
 * El formulario de contacto en el navegador.
 *
 * Mejora progresiva: el `<form>` ya sabe enviarse solo. Esto lo intercepta
 * para responder sin recargar la pagina y para poder decir "enviando" y
 * "enviado" donde se ve. Si el script no llega, el navegador envia el
 * formulario a `/api/contact` y quien escribe recibe la respuesta del
 * servidor; no es bonito, pero funciona.
 *
 * Aqui no hay ninguna validacion de negocio: lo que decide si una consulta
 * vale es el servidor. Esto solo traduce su respuesta a una frase.
 */

import { readContactResponse } from './contact';

/*
 * Aserciones en vez del generico de `querySelector`: los tipos del runtime de
 * Workers definen su propio `Element` (el de HTMLRewriter) y chocan con el DOM.
 */
function byId<T extends object>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

interface ContactTexts {
  invalid_request: string;
  property_not_available: string;
  too_fast: string;
  server_error: string;
  sending: string;
  submit: string;
  sent: string;
  values: Record<string, string>;
}

const FALLBACK: ContactTexts = {
  invalid_request: '',
  property_not_available: '',
  too_fast: '',
  server_error: '',
  sending: '',
  submit: '',
  sent: '',
  values: {},
};

function readTexts(): ContactTexts {
  const raw = byId<HTMLElement>('contact-texts')?.textContent;
  if (raw === null || raw === undefined) return FALLBACK;

  try {
    return { ...FALLBACK, ...(JSON.parse(raw) as Partial<ContactTexts>) };
  } catch {
    return FALLBACK;
  }
}

export function initContactForm(): void {
  const form = byId<HTMLFormElement>('contact-form');
  if (form === null) return;

  const status = byId<HTMLElement>('contact-status');
  const submit = byId<HTMLButtonElement>('contact-submit');
  const value = byId<HTMLInputElement>('contact-value');
  const valueLabel = byId<HTMLElement>('contact-value-label');
  const texts = readTexts();

  // Cuando se abrio el formulario; el servidor lo usa como badén antispam.
  const openedAt = Date.now();

  /*
   * La etiqueta y el tipo del campo siguen al medio elegido: pedir "tu
   * correo" cuando alguien ha marcado WhatsApp confunde, y el teclado del
   * movil deberia ser el que toca.
   */
  const syncValueField = (): void => {
    const method = form.querySelector('input[name="method"]:checked');
    if (!(method instanceof HTMLInputElement) || value === null) return;

    const placeholder = method.dataset.placeholder ?? '';
    if (valueLabel !== null) valueLabel.textContent = placeholder;

    value.type = method.value === 'email' ? 'email' : 'tel';
    value.autocomplete = method.value === 'email' ? 'email' : 'tel';
    value.placeholder = texts.values[method.value] ?? '';
  };

  form.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === 'method') {
      syncValueField();
    }
  });

  syncValueField();

  const say = (message: string, kind: 'sending' | 'ok' | 'error'): void => {
    if (status === null) return;

    status.hidden = message.length === 0;
    status.textContent = message;
    status.dataset.kind = kind;
  };

  form.addEventListener('submit', (event) => {
    // El navegador ya ha comprobado `required` y los tipos antes de llegar.
    event.preventDefault();

    const data = new FormData(form);
    const body = {
      name: String(data.get('name') ?? ''),
      method: String(data.get('method') ?? 'email'),
      contactValue: String(data.get('contactValue') ?? ''),
      message: String(data.get('message') ?? ''),
      locale: form.dataset.locale ?? 'es',
      propertySlug: form.dataset.propertySlug ?? null,
      consent: data.get('consent') !== null,
      website: String(data.get('website') ?? ''),
      elapsedMs: Date.now() - openedAt,
    };

    if (submit !== null) submit.disabled = true;
    say(texts.sending, 'sending');

    void (async () => {
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

        const result = readContactResponse(response.status, await response.text());

        if (result.ok) {
          /*
           * El formulario desaparece y queda la confirmacion: dejarlo ahi
           * invita a enviar lo mismo dos veces.
           */
          form.reset();
          form.dataset.sent = 'true';
          say(texts.sent, 'ok');
          status?.focus();
          return;
        }

        say(texts[result.code ?? 'server_error'], 'error');
      } catch {
        // Sin red. Es recuperable: se deja el formulario como estaba.
        say(texts.server_error, 'error');
      } finally {
        if (submit !== null && form.dataset.sent !== 'true') {
          submit.disabled = false;
          submit.textContent = texts.submit;
        }
      }
    })();
  });
}
