/**
 * Los cuatro huecos de media del sitio, en el panel.
 *
 * No es un gestor de archivos: son cuatro sitios fijos con una imagen cada
 * uno. Por eso no hay lista, ni orden, ni nombres que poner. Cada hueco
 * enseña lo que tiene, deja cambiarlo y deja vaciarlo, y eso es todo.
 *
 * Vive fuera del formulario de configuracion a proposito: los textos se
 * guardan solos con el coordinador de autoguardado, y una subida no es eso.
 * Subir un archivo es una operacion puntual, con su respuesta y su fallo, y
 * mezclarla con el guardado continuo solo complicaria los dos.
 *
 * Lo que se ve aqui es una RUTA (`/site-media/logo`), nunca la clave del
 * objeto: esa no sale del servidor.
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

interface SlotView {
  slot: string;
  label: string;
  present: boolean;
  url: string | null;
  maxBytes: number;
  mimeTypes: string[];
}

type MediaView = Record<string, SlotView>;

/** El orden en el que se enseñan: de lo mas visible a lo mas accesorio. */
const ORDER = ['hero', 'logo', 'social', 'favicon'] as const;

/** Para que se usa cada hueco, en una linea. */
const HINTS: Record<string, string> = {
  hero: 'Fotografía grande de la portada. Se ve detrás del título, a pantalla completa.',
  logo: 'Aparece en la cabecera y en el pie. Sin logo se usa la inicial del nombre.',
  social:
    'La imagen que se ve al compartir un enlace del sitio. La ficha de una propiedad usa su propia portada.',
  favicon: 'El icono de la pestaña del navegador.',
};

export function formatLimit(maxBytes: number): string {
  const kb = Math.round(maxBytes / 1024);

  return kb >= 1024 ? `${Math.round(kb / 1024)} MB` : `${kb} KB`;
}

/** Los tipos admitidos, tal como los entiende quien mira: "JPG, PNG o WebP". */
export function formatTypes(mimeTypes: string[]): string {
  const names = mimeTypes.map((type) => type.replace('image/', '').replace('jpeg', 'jpg'));

  return names.join(', ').toUpperCase();
}

export function initSiteMediaPanel(): void {
  const box = byId<HTMLElement>('site-media');
  if (box === null) return;

  let media: MediaView | null = null;
  let busy = false;
  let message = '';

  const slotHtml = (view: SlotView): string => {
    const preview = view.present
      ? `<img class="site-media-preview" src="${escapeHtml(view.url ?? '')}" alt="">`
      : '<p class="site-media-empty admin-muted">Sin imagen</p>';

    return (
      '<div class="site-media-slot">' +
      `<h3>${escapeHtml(view.label)}</h3>` +
      `<p class="admin-muted site-media-hint">${escapeHtml(HINTS[view.slot] ?? '')}</p>` +
      preview +
      `<p class="admin-muted site-media-rule">${escapeHtml(formatTypes(view.mimeTypes))} · máximo ${escapeHtml(formatLimit(view.maxBytes))}</p>` +
      '<div class="site-media-actions">' +
      `<label class="admin-button" for="site-media-file-${escapeHtml(view.slot)}">${
        view.present ? 'Reemplazar' : 'Subir'
      }</label>` +
      `<input class="site-media-input" id="site-media-file-${escapeHtml(view.slot)}" type="file" accept="${escapeHtml(view.mimeTypes.join(','))}" data-slot="${escapeHtml(view.slot)}" hidden>` +
      (view.present
        ? `<button type="button" class="admin-button" data-action="delete" data-slot="${escapeHtml(view.slot)}">Quitar</button>`
        : '') +
      '</div>' +
      '</div>'
    );
  };

  const render = (): void => {
    if (media === null) {
      box.innerHTML = '<p class="admin-muted">No se pudieron cargar las imágenes del sitio.</p>';
      return;
    }

    box.innerHTML =
      '<div class="site-media-grid">' +
      ORDER.map((slot) => media?.[slot])
        .filter((view): view is SlotView => view !== undefined)
        .map(slotHtml)
        .join('') +
      '</div>' +
      `<p class="editor-error" id="site-media-error" role="alert"${message.length === 0 ? ' hidden' : ''}>${escapeHtml(message)}</p>`;
  };

  const say = (text: string): void => {
    message = text;
    render();
  };

  const load = async (): Promise<void> => {
    try {
      const response = await fetch('/api/admin/settings', {
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        media = null;
        render();
        return;
      }

      const body = (await response.json()) as { data?: { media?: MediaView } };
      media = body.data?.media ?? null;
      render();
    } catch {
      media = null;
      render();
    }
  };

  /** El resultado de subir o quitar ya trae el estado entero de los huecos. */
  const apply = async (response: Response): Promise<void> => {
    const body = (await response.json()) as {
      data?: MediaView;
      error?: { message?: string };
    };

    if (!response.ok || body.data === undefined) {
      say(body.error?.message ?? 'No se pudo completar la operación.');
      return;
    }

    media = body.data;
    message = '';
    render();
  };

  const upload = async (slot: string, file: File): Promise<void> => {
    if (busy) return;
    busy = true;
    say('Subiendo…');

    try {
      const form = new FormData();
      form.set('file', file);

      /*
       * El hueco va en la ruta, no en el cuerpo. Y `origin` explicito porque
       * Astro rechaza un multipart sin el, tratandolo como envio cross-site.
       */
      await apply(
        await fetch(`/api/admin/settings/media/${slot}`, {
          method: 'PUT',
          headers: { accept: 'application/json', origin: location.origin },
          body: form,
        }),
      );
    } catch {
      say('Sin conexión con el servidor.');
    } finally {
      busy = false;
    }
  };

  const remove = async (slot: string): Promise<void> => {
    if (busy) return;
    busy = true;

    try {
      await apply(
        await fetch(`/api/admin/settings/media/${slot}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
        }),
      );
    } catch {
      say('Sin conexión con el servidor.');
    } finally {
      busy = false;
    }
  };

  box.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const slot = target.dataset.slot;
    const file = target.files?.[0];
    if (slot === undefined || file === undefined) return;

    void upload(slot, file);
    // Se limpia para poder volver a elegir el mismo archivo si hace falta.
    target.value = '';
  });

  box.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const slot = target.dataset.slot;
    if (target.dataset.action !== 'delete' || slot === undefined) return;

    void remove(slot);
  });

  void load();
}
