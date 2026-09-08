/**
 * La decision del reviewer en el navegador.
 *
 * Manda la decision al endpoint y cuenta que ha pasado. No valida nada: quien
 * decide si el enlace sirve es el servidor, y aqui solo se traduce su
 * respuesta a una frase.
 *
 * Una decision es final, asi que en cuanto sale bien los botones desaparecen:
 * dejarlos ahi invitaria a pulsar otra vez sobre un enlace ya muerto.
 */

/*
 * Aserciones en vez del generico de `querySelector`: los tipos del runtime de
 * Workers definen su propio `Element` (el de HTMLRewriter) y chocan con el DOM.
 */
function byId<T extends object>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const DONE: Record<string, string> = {
  approved: 'Aprobada. Gracias: quien lleva el sitio ya puede publicarla.',
  changes_requested: 'Enviado. Quien lleva el sitio verá tus comentarios.',
};

/**
 * El endpoint a partir de la URL de la pagina.
 *
 * La vista previa vive en `/review/<token>` y su endpoint en
 * `/api/review/<token>/decision`: no es la misma ruta con un sufijo, asi que
 * se construye a proposito y no concatenando sobre `location.pathname`.
 */
export function decisionEndpoint(pathname: string): string | null {
  const match = /^\/review\/([^/]+)\/?$/.exec(pathname);
  const token = match?.[1];

  return token === undefined ? null : `/api/review/${token}/decision`;
}

export function initReviewDecision(): void {
  const section = byId<HTMLElement>('review-decision');
  const status = byId<HTMLElement>('review-status');
  if (section === null) return;

  const endpoint = decisionEndpoint(location.pathname);
  if (endpoint === null) return;

  const comment = byId<HTMLTextAreaElement>('review-comment');
  const buttons = [...section.querySelectorAll('[data-decision]')] as HTMLButtonElement[];

  const say = (message: string, kind: 'sending' | 'ok' | 'error'): void => {
    if (status === null) return;

    status.hidden = message.length === 0;
    status.textContent = message;
    status.dataset.kind = kind;
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const decision = button.dataset.decision;
      if (decision === undefined) return;

      for (const other of buttons) other.disabled = true;
      say('Enviando…', 'sending');

      void (async () => {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ decision, comment: comment?.value ?? '' }),
          });

          if (response.ok) {
            // La decision es final: se retira lo que ya no se puede volver a usar.
            section.dataset.done = 'true';
            say(DONE[decision] ?? 'Gracias.', 'ok');
            status?.focus();
            return;
          }

          if (response.status === 404) {
            say('Este enlace ya no sirve. Pide uno nuevo a quien te lo envió.', 'error');
            return;
          }

          say('No se pudo enviar. Inténtalo otra vez en un momento.', 'error');
        } catch {
          say('Sin conexión. Inténtalo otra vez en un momento.', 'error');
        } finally {
          if (section.dataset.done !== 'true') {
            for (const other of buttons) other.disabled = false;
          }
        }
      })();
    });
  }
}
