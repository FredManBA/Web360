/**
 * Tests del formulario publico de contacto.
 *
 * Contra SQLite real con las migraciones del proyecto, y con `Request`
 * reales contra el endpoint: es la unica escritura abierta a internet del
 * proyecto y merece probarse por donde entra de verdad.
 *
 * Ni un solo test sale a la red: el envio de Resend se inyecta.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contacts, properties, siteSettings } from '../../db/schema';
import { createPropertyDraft } from '../admin/properties/create-property';
import { upsertPropertyTranslation } from '../admin/properties/update-property-translation';
import { applySeed, createTestDatabase } from '../admin/test-database';
import type { AdminBatchDatabase } from '../admin/types';
import type { CommercialStatus, PublicationStatus } from '../domain/vocabularies';
import { handleContact, MAX_BODY_BYTES, type ContactContext } from './handler';
import { createLead, MIN_FILL_MS, resolvePublicProperty } from './lead';
import { notificationSubject, notifyNewLead } from './notify';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

async function newProperty(): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');
  return created.data.id;
}

async function setStatus(
  propertyId: number,
  publicationStatus: PublicationStatus,
  commercialStatus: CommercialStatus = 'available',
): Promise<void> {
  await db
    .update(properties)
    .set({ publicationStatus, commercialStatus })
    .where(eq(properties.id, propertyId));
}

/** Propiedad publicada y traducida, que es el caso normal de una ficha. */
async function publishedProperty(slug = 'lote-nosara'): Promise<number> {
  const propertyId = await newProperty();

  const translated = await upsertPropertyTranslation(db, propertyId, {
    locale: 'es',
    slug,
    title: 'Lote con vista al mar',
  });
  if (!translated.ok) throw new Error('setup: traduccion');

  await setStatus(propertyId, 'published');
  return propertyId;
}

/** Consulta valida; cada test cambia lo que quiere probar. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Ana Rojas',
    method: 'whatsapp',
    contactValue: '+506 8888 8888',
    message: 'Me interesa, ¿podemos hablar?',
    locale: 'es',
    consent: true,
    elapsedMs: 9000,
    ...overrides,
  };
}

function post(payload: unknown, init: RequestInit = {}): Request {
  return new Request('https://codeloba.test/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    ...init,
  });
}

function context(request: Request, extra: Partial<ContactContext> = {}): ContactContext {
  return { request, db, env: {}, ...extra };
}

async function storedRows() {
  return db.select().from(contacts);
}

/* -------------------------------------------------------------------------- */
/* Alta general                                                               */
/* -------------------------------------------------------------------------- */

describe('una consulta general', () => {
  it('se guarda con lo justo y en estado pendiente', async () => {
    const result = await createLead(db, body());

    expect(result.ok).toBe(true);

    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Ana Rojas');
    expect(rows[0]?.preferredContactMethod).toBe('whatsapp');
    expect(rows[0]?.contactValue).toBe('+506 8888 8888');
    expect(rows[0]?.status).toBe('new');
    expect(rows[0]?.propertyId).toBeNull();
    // El consentimiento se sella con la hora, que es lo que pide el modelo.
    expect(rows[0]?.consentAcceptedAt).toBeInstanceOf(Date);
  });

  it('el mensaje es opcional', async () => {
    await createLead(db, body({ message: '' }));

    expect((await storedRows())[0]?.message).toBeNull();
  });

  it('recuerda desde que idioma se escribio', async () => {
    await createLead(db, body({ locale: 'en' }));

    expect((await storedRows())[0]?.locale).toBe('en');
  });
});

/* -------------------------------------------------------------------------- */
/* Propiedad asociada                                                         */
/* -------------------------------------------------------------------------- */

describe('una consulta desde una ficha', () => {
  it('se asocia a la propiedad, resolviendo su slug', async () => {
    const propertyId = await publishedProperty();

    const result = await createLead(db, body({ propertySlug: 'lote-nosara' }));

    expect(result.ok).toBe(true);
    expect((await storedRows())[0]?.propertyId).toBe(propertyId);
    if (result.ok) expect(result.stored?.propertyCode).toMatch(/^LOBA-/);
  });

  it('una propiedad no publica se rechaza y no guarda nada', async () => {
    const propertyId = await publishedProperty();
    await setStatus(propertyId, 'draft');

    const result = await createLead(db, body({ propertySlug: 'lote-nosara' }));

    expect(result).toEqual({
      ok: false,
      error: { code: 'property_not_available', field: 'propertySlug' },
    });
    expect(await storedRows()).toHaveLength(0);
  });

  it('una vendida y oculta tampoco acepta consultas', async () => {
    const propertyId = await publishedProperty();
    await setStatus(propertyId, 'published', 'sold');

    const result = await createLead(db, body({ propertySlug: 'lote-nosara' }));

    expect(result.ok).toBe(false);
  });

  it('un slug inventado se rechaza igual que uno no publico', async () => {
    await publishedProperty();

    // No se distingue "no existe" de "no es publica": decirlo permitiria
    // sondear el catalogo sin publicar.
    const result = await createLead(db, body({ propertySlug: 'no-existe' }));

    expect(result).toEqual({
      ok: false,
      error: { code: 'property_not_available', field: 'propertySlug' },
    });
  });

  it('el slug se resuelve en el idioma en que se escribio', async () => {
    const propertyId = await publishedProperty();
    await upsertPropertyTranslation(db, propertyId, {
      locale: 'en',
      slug: 'ocean-view-lot',
      title: 'Ocean view lot',
    });

    expect(await resolvePublicProperty(db, 'en', 'ocean-view-lot')).not.toBeNull();
    // El slug ingles no vale desde el formulario en espanol.
    expect(await resolvePublicProperty(db, 'es', 'ocean-view-lot')).toBeNull();
  });

  it('no se acepta un id de la base: el campo no existe', async () => {
    const propertyId = await publishedProperty();

    const result = await createLead(db, body({ propertyId }));

    // `strictObject`: una clave de mas es motivo de rechazo.
    expect(result.ok).toBe(false);
    expect(await storedRows()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Validacion                                                                 */
/* -------------------------------------------------------------------------- */

describe('validacion', () => {
  it('el nombre no puede faltar ni quedar en blanco', async () => {
    expect((await createLead(db, body({ name: '' }))).ok).toBe(false);
    expect((await createLead(db, body({ name: '   ' }))).ok).toBe(false);
  });

  it('el valor de contacto no puede quedar en blanco', async () => {
    expect((await createLead(db, body({ contactValue: '  ' }))).ok).toBe(false);
  });

  it('el medio tiene que ser uno de los previstos', async () => {
    expect((await createLead(db, body({ method: 'paloma' }))).ok).toBe(false);
  });

  it('sin consentimiento no se guarda nada', async () => {
    expect((await createLead(db, body({ consent: false }))).ok).toBe(false);
    expect(await storedRows()).toHaveLength(0);
  });

  it('el idioma tiene que ser uno de los del sitio', async () => {
    expect((await createLead(db, body({ locale: 'fr' }))).ok).toBe(false);
  });

  it('los textos largos se rechazan, no se recortan', async () => {
    expect((await createLead(db, body({ name: 'a'.repeat(121) }))).ok).toBe(false);
    expect((await createLead(db, body({ contactValue: 'a'.repeat(201) }))).ok).toBe(false);
    expect((await createLead(db, body({ message: 'a'.repeat(2001) }))).ok).toBe(false);
    expect(await storedRows()).toHaveLength(0);
  });

  it('un campo de mas se rechaza', async () => {
    expect((await createLead(db, body({ sorpresa: 'hola' }))).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Spam                                                                       */
/* -------------------------------------------------------------------------- */

describe('defensas contra el ruido automatico', () => {
  it('la trampa no guarda nada, y responde como si todo fuera bien', async () => {
    const result = await createLead(db, body({ website: 'http://spam.example' }));

    // Decirle al robot que se le ha detectado solo sirve para que lo afine.
    expect(result).toEqual({ ok: true, stored: null });
    expect(await storedRows()).toHaveLength(0);
  });

  it('un envio instantaneo se rechaza', async () => {
    const result = await createLead(db, body({ elapsedMs: MIN_FILL_MS - 1 }));

    expect(result).toEqual({ ok: false, error: { code: 'too_fast' } });
    expect(await storedRows()).toHaveLength(0);
  });

  it('sin ese dato la consulta pasa: no es obligatorio', async () => {
    // Sin JavaScript no hay forma de medirlo, y eso no puede bloquear a nadie.
    expect((await createLead(db, body({ elapsedMs: null }))).ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Endpoint                                                                   */
/* -------------------------------------------------------------------------- */

describe('el endpoint publico', () => {
  it('acepta una consulta y responde sin cachear', async () => {
    const response = await handleContact(context(post(body())));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
    expect(await storedRows()).toHaveLength(1);
  });

  it('no necesita sesion: no hay guardia de Access', async () => {
    const response = await handleContact(context(post(body())));

    expect(response.status).toBe(200);
  });

  it('solo acepta JSON', async () => {
    const request = new Request('https://codeloba.test/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=Ana',
    });

    expect((await handleContact(context(request))).status).toBe(415);
  });

  it('un JSON roto no revienta nada', async () => {
    expect((await handleContact(context(post('{ no es json')))).status).toBe(400);
  });

  it('un cuerpo enorme se corta antes de mirarlo', async () => {
    const huge = JSON.stringify(body({ message: 'a'.repeat(MAX_BODY_BYTES) }));
    const response = await handleContact(context(post(huge)));

    expect(response.status).toBe(413);
    expect(await storedRows()).toHaveLength(0);
  });

  it('rechaza escrituras de otro origen', async () => {
    const request = post(body(), { headers: { 'content-type': 'application/json' } });
    request.headers.set('origin', 'https://otro.example');

    expect((await handleContact(context(request))).status).toBe(403);
  });

  it('nunca cuenta por que fallo mas alla del codigo', async () => {
    const response = await handleContact(context(post(body({ name: '' }))));
    const payload = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe('invalid_request');
    // Un mensaje generico: el texto que ve la persona lo pone la pagina.
    expect(payload.error.message).not.toContain('name');
  });

  it('una propiedad no publica se distingue, para poder explicarlo', async () => {
    const propertyId = await publishedProperty();
    await setStatus(propertyId, 'archived');

    const response = await handleContact(context(post(body({ propertySlug: 'lote-nosara' }))));
    const payload = (await response.json()) as { error: { code: string } };

    expect(payload.error.code).toBe('property_not_available');
  });

  it('la trampa recibe la misma respuesta que un envio bueno', async () => {
    const response = await handleContact(context(post(body({ website: 'x' }))));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await storedRows()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Aviso por email                                                            */
/* -------------------------------------------------------------------------- */

describe('el aviso al administrador', () => {
  async function configureRecipient(): Promise<void> {
    await db.insert(siteSettings).values({ id: 1, notificationsEmail: 'avisos@codeloba.test' });
  }

  it('sin credenciales no se intenta nada, y la consulta se guarda igual', async () => {
    const send = vi.fn();

    const response = await handleContact(context(post(body()), { fetch: send }));

    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(await storedRows()).toHaveLength(1);
  });

  it('con todo configurado, se manda a quien dice la configuracion', async () => {
    await configureRecipient();

    const send = vi.fn(async () => new Response('{}', { status: 200 }));

    await handleContact(
      context(post(body()), {
        env: { RESEND_API_KEY: 'clave', CONTACT_FROM_EMAIL: 'web@codeloba.test' },
        fetch: send as unknown as typeof globalThis.fetch,
      }),
    );

    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(String(init.body)).toContain('avisos@codeloba.test');
  });

  it('SI RESEND FALLA, la consulta ya guardada no se pierde', async () => {
    await configureRecipient();

    const send = vi.fn(async () => new Response('nope', { status: 500 }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await handleContact(
      context(post(body()), {
        env: { RESEND_API_KEY: 'clave', CONTACT_FROM_EMAIL: 'web@codeloba.test' },
        fetch: send as unknown as typeof globalThis.fetch,
      }),
    );

    // Quien escribio recibe su confirmacion: el problema no es suyo.
    expect(response.status).toBe(200);
    expect(await storedRows()).toHaveLength(1);
    // Y queda registrado, que es lo que permite enterarse.
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });

  it('si la red se cae a mitad, tampoco se pierde', async () => {
    await configureRecipient();

    const send = vi.fn(async () => {
      throw new Error('sin red');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await handleContact(
      context(post(body()), {
        env: { RESEND_API_KEY: 'clave', CONTACT_FROM_EMAIL: 'web@codeloba.test' },
        fetch: send as unknown as typeof globalThis.fetch,
      }),
    );

    expect(response.status).toBe(200);
    expect(await storedRows()).toHaveLength(1);

    logged.mockRestore();
  });

  it('sin destinatario configurado no se intenta enviar', async () => {
    const send = vi.fn();

    await handleContact(
      context(post(body()), {
        env: { RESEND_API_KEY: 'clave', CONTACT_FROM_EMAIL: 'web@codeloba.test' },
        fetch: send as unknown as typeof globalThis.fetch,
      }),
    );

    expect(send).not.toHaveBeenCalled();
  });

  it('el asunto dice de que propiedad se habla', () => {
    const base = {
      id: 1,
      name: 'Ana',
      method: 'whatsapp',
      contactValue: '+506',
      message: null,
      locale: 'es',
      propertyTitle: 'Lote',
    };

    expect(notificationSubject({ ...base, propertyCode: 'LOBA-001' })).toContain('LOBA-001');
    expect(notificationSubject({ ...base, propertyCode: null })).toContain('Ana');
  });

  it('nunca lanza, pase lo que pase', async () => {
    const outcome = await notifyNewLead(
      {
        apiKey: 'clave',
        from: 'web@codeloba.test',
        to: 'avisos@codeloba.test',
        fetch: (async () => {
          throw new Error('boom');
        }) as unknown as typeof globalThis.fetch,
      },
      {
        id: 1,
        name: 'Ana',
        method: 'email',
        contactValue: 'ana@example.com',
        message: null,
        locale: 'es',
        propertyCode: null,
        propertyTitle: null,
      },
    );

    expect(outcome.status).toBe('failed');
  });
});
