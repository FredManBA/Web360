import type { properties, media } from '../../../db/schema';
import { parseAmountToMinor } from '../../domain/money';

type Property = typeof properties.$inferSelect;
type Media = typeof media.$inferSelect;
export const escape = (v: unknown) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(`/api/admin/${path}`, {
    method,
    headers: body === undefined || multipart ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
  });
  const result = (await response.json()) as {
    data: T;
    error?: { message?: string; details?: { issues?: { message: string }[] } };
  };
  if (!response.ok)
    throw new Error(
      result.error?.details?.issues
        ?.map((issue: { message: string }) => issue.message)
        .join('\n') ||
        result.error?.message ||
        'No se pudo completar la operación.',
    );
  return result.data as T;
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo contactar con el servidor.';
}
function status(text: string) {
  const box = document.getElementById('r2-status');
  if (box) box.textContent = text;
}
async function action(button: HTMLButtonElement, work: () => Promise<void>) {
  button.disabled = true;
  try {
    await work();
  } catch (error) {
    status(message(error));
  } finally {
    button.disabled = false;
  }
}

export function initList() {
  const button = document.getElementById('r2-create') as HTMLButtonElement | null;
  button?.addEventListener(
    'click',
    () =>
      void action(button, async () => {
        const row = await api<Property>('properties', 'POST');
        location.assign(`/admin/propiedades/${row.id}`);
      }),
  );
  document.getElementById('r2-filter')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    document.querySelectorAll<HTMLElement>('[data-property-status]').forEach((row) => {
      row.hidden = !!value && row.dataset.propertyStatus !== value;
    });
  });
}

const numeric = new Set(['areaSquareMeters', 'mapLatitude', 'mapLongitude']);
function formValues(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of new FormData(form)) {
    if (typeof value !== 'string') continue;
    out[name] = numeric.has(name) ? (value.trim() ? Number(value) : null) : value.trim() || null;
  }
  return out;
}

function initRows(box: HTMLElement, template: HTMLTemplateElement, add: HTMLButtonElement) {
  add.addEventListener('click', () => {
    box.appendChild(template.content.cloneNode(true));
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  box.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-row-action]');
    const row = button?.closest<HTMLElement>('[data-row]');
    if (!row || !button) return;
    if (button.dataset.rowAction === 'remove') row.remove();
    if (button.dataset.rowAction === 'up' && row.previousElementSibling)
      box.insertBefore(row, row.previousElementSibling);
    if (button.dataset.rowAction === 'down' && row.nextElementSibling)
      box.insertBefore(row.nextElementSibling, row);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function rows(box: HTMLElement) {
  return [...box.querySelectorAll<HTMLElement>('[data-row]')].map((row) =>
    Object.fromEntries(
      [...row.querySelectorAll<HTMLInputElement>('input[data-key]')].map((input) => [
        input.dataset.key!,
        input.value.trim() || null,
      ]),
    ),
  );
}

export function initEditor() {
  const form = document.getElementById('r2-property') as HTMLFormElement | null;
  if (!form) return;
  const id = form.dataset.id!;
  const base = `properties/${id}`;
  const saveButton = document.getElementById('r2-save') as HTMLButtonElement;
  const publishButton = document.getElementById('r2-publish') as HTMLButtonElement;
  const withdrawButton = document.getElementById('r2-withdraw') as HTMLButtonElement;
  const view = document.getElementById('r2-view') as HTMLAnchorElement;
  const features = document.getElementById('r2-features')!;
  initRows(
    features,
    document.getElementById('r2-feature-template') as HTMLTemplateElement,
    document.getElementById('r2-add-feature') as HTMLButtonElement,
  );
  let dirty = false,
    busy = false;
  form.addEventListener('input', () => {
    dirty = true;
    status('Cambios sin guardar');
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });
  function showPublication(p: Property) {
    publishButton.hidden = p.status === 'published';
    withdrawButton.hidden = p.status !== 'published';
    view.hidden = p.status !== 'published' || !p.slugEs;
    view.href = `/es/propiedades/${encodeURIComponent(p.slugEs ?? '')}`;
    document.getElementById('r2-publication-state')!.textContent =
      p.status === 'published' ? 'Publicada' : 'Borrador';
  }
  async function save() {
    const data = formValues(form!);
    data.featured = (form!.elements.namedItem('featured') as HTMLInputElement).checked;
    const amount = String(data.priceAmount ?? '');
    delete data.priceAmount;
    if (amount) {
      const parsed = parseAmountToMinor(amount, String(data.currencyCode ?? ''));
      if (!parsed.ok) throw new Error('Revisa el importe y la moneda.');
      data.priceAmountMinor = parsed.amountMinor;
    } else data.priceAmountMinor = null;
    data.featuresJson = rows(features);
    const property = await api<Property>(base, 'PUT', data);
    dirty = false;
    showPublication(property);
    status('Guardado');
    return property;
  }
  async function serialize(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    // Un guardado manual en curso bloquea la edición; no necesita snapshots ni puertos.
    const fields = [...form!.querySelectorAll('input,select,textarea,button')] as (
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
    )[];
    try {
      const promise = work();
      fields.forEach((field) => {
        field.disabled = true;
      });
      publishButton.disabled = true;
      withdrawButton.disabled = true;
      await promise;
    } catch (error) {
      status(message(error));
    } finally {
      busy = false;
      fields.forEach((field) => {
        field.disabled = false;
      });
      publishButton.disabled = false;
      withdrawButton.disabled = false;
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void serialize(async () => {
      await save();
    });
  });
  publishButton.addEventListener(
    'click',
    () =>
      void serialize(async () => {
        await save();
        showPublication(await api<Property>(`${base}/publish`, 'POST'));
        status('Publicada');
      }),
  );
  withdrawButton.addEventListener(
    'click',
    () =>
      void serialize(async () => {
        showPublication(await api<Property>(`${base}/unpublish`, 'POST'));
        status('Retirada a borrador');
      }),
  );
  saveButton.disabled = false;

  const mediaBox = document.getElementById('r2-media')!;
  function renderMedia(files: Media[]) {
    mediaBox.innerHTML = files.length
      ? files
          .map(
            (file) => `<article class="r2-media-card" data-media-id="${file.id}">
      ${file.kind === 'youtube' ? `<a href="https://www.youtube.com/watch?v=${escape(file.youtubeVideoId)}">YouTube</a>` : `<img src="/api/admin/${base}/media/${file.id}/file" alt="${escape(file.altEs)}" loading="lazy">`}
      <p>${file.kind === 'panorama' ? 'Panorama' : file.kind === 'image' ? 'Imagen' : 'YouTube'} ${file.isCover ? '· Portada' : ''}</p>
      <label>Texto alternativo ES<input data-media-key="altEs" value="${escape(file.altEs)}"></label>
      <label>Alternative text EN<input data-media-key="altEn" value="${escape(file.altEn)}"></label>
      <label>Orden<input data-media-key="sortOrder" type="number" min="0" step="1" value="${file.sortOrder}"></label>
      <div class="r2-actions"><button type="button" class="admin-button" data-media-action="save">Guardar imagen</button>
      ${file.kind === 'image' ? '<button type="button" class="admin-button" data-media-action="cover">Usar de portada</button>' : ''}
      <button type="button" class="admin-button" data-media-action="delete">Eliminar</button></div></article>`,
          )
          .join('')
      : '<p>No hay imágenes todavía.</p>';
    // El editor 360 trabaja sobre estos mismos archivos y necesita la lista al día.
    document.dispatchEvent(new CustomEvent('r2-media', { detail: files }));
  }
  const reloadMedia = async () => renderMedia((await api<{ media: Media[] }>(base)).media);
  renderMedia(JSON.parse(document.getElementById('r2-media-data')!.textContent || '[]') as Media[]);
  mediaBox.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      'button[data-media-action]',
    );
    const card = button?.closest<HTMLElement>('[data-media-id]');
    if (!button || !card) return;
    void action(button, async () => {
      const path = `${base}/media/${card.dataset.mediaId}`;
      if (button.dataset.mediaAction === 'delete') {
        if (!confirm('¿Eliminar este recurso de la ficha?')) return;
        await api(path, 'DELETE');
      } else {
        const data =
          button.dataset.mediaAction === 'cover'
            ? { isCover: true }
            : Object.fromEntries(
                [...card.querySelectorAll<HTMLInputElement>('[data-media-key]')].map((input) => [
                  input.dataset.mediaKey,
                  input.dataset.mediaKey === 'sortOrder'
                    ? Number(input.value)
                    : input.value.trim() || null,
                ]),
              );
        await api(path, 'PATCH', data);
      }
      await reloadMedia();
      status('Multimedia guardada');
    });
  });
  for (const formId of ['r2-upload', 'r2-youtube']) {
    const upload = document.getElementById(formId) as HTMLFormElement;
    upload.addEventListener('submit', (event) => {
      event.preventDefault();
      const button = upload.querySelector<HTMLButtonElement>('button')!;
      void action(button, async () => {
        const body =
          formId === 'r2-upload'
            ? new FormData(upload)
            : {
                kind: 'youtube',
                youtubeVideoId: String(new FormData(upload).get('youtubeVideoId') ?? '').trim(),
              };
        await api(`${base}/media`, 'POST', body);
        upload.reset();
        await reloadMedia();
        status('Multimedia añadida');
      });
    });
  }
}

export function initSettings() {
  const form = document.getElementById('r2-settings') as HTMLFormElement;
  const social = document.getElementById('r2-social')!;
  initRows(
    social,
    document.getElementById('r2-social-template') as HTMLTemplateElement,
    document.getElementById('r2-add-social') as HTMLButtonElement,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    void action(button, async () => {
      const data = formValues(form);
      data.socialLinksJson = rows(social);
      await api('settings', 'PUT', data);
      status('Guardado');
    });
  });
  document.querySelectorAll<HTMLFormElement>('[data-site-slot]').forEach((upload) => {
    const slot = upload.dataset.siteSlot!;
    const reload = () => {
      const image = upload.querySelector<HTMLImageElement>('img')!;
      image.src = `/site-media/${slot}?v=${Date.now()}`;
      image.hidden = false;
    };
    upload.addEventListener('submit', (event) => {
      event.preventDefault();
      const button = upload.querySelector<HTMLButtonElement>('[type=submit]')!;
      void action(button, async () => {
        await api(`settings/media/${slot}`, 'PUT', new FormData(upload));
        reload();
        status('Imagen guardada');
      });
    });
    const remove = upload.querySelector<HTMLButtonElement>('[data-remove-slot]')!;
    remove.addEventListener(
      'click',
      () =>
        void action(remove, async () => {
          await api(`settings/media/${slot}`, 'DELETE');
          upload.querySelector('img')!.hidden = true;
          status('Imagen retirada');
        }),
    );
  });
}
export function initContacts() {
  document.querySelectorAll<HTMLButtonElement>('[data-contact-id]').forEach((button) =>
    button.addEventListener(
      'click',
      () =>
        void action(button, async () => {
          const value = button.dataset.status === 'new' ? 'reviewed' : 'new';
          await api(`contacts/${button.dataset.contactId}`, 'PATCH', { status: value });
          button.dataset.status = value;
          button.textContent = value === 'new' ? 'Marcar atendida' : 'Marcar sin atender';
          status('Consulta actualizada');
        }),
    ),
  );
}
