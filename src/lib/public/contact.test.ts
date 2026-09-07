/**
 * Tests del contacto publico.
 *
 * El enlace de WhatsApp y la eleccion de canales son funciones puras y se
 * prueban como tales. Lo que solo existe como plantilla se comprueba sobre el
 * fuente, como en el resto del proyecto.
 *
 * Hay un bloque dedicado a que ningun secreto pueda acabar en el HTML: es la
 * primera fase con claves de por medio.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  availableChannels,
  hasChannels,
  normalizeWhatsappNumber,
  readContactResponse,
  whatsappHref,
  whatsappMessage,
} from './contact';
import { labelsFor } from './labels';
import { contactHref, navigationFor } from './navigation';
import { EMPTY_CONTACT, type PublicContactChannels } from './read-model';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const FORM = 'src/components/public/ContactForm.astro';
const CHANNELS = 'src/components/public/ContactChannels.astro';
const PROPERTY_CONTACT = 'src/components/public/PropertyContact.astro';
const CONTACT_ES = 'src/pages/es/contacto.astro';
const CONTACT_EN = 'src/pages/en/contact.astro';
const API_ROUTE = 'src/pages/api/contact.ts';
const HANDLER = 'src/lib/contacts/handler.ts';
const LEAD = 'src/lib/contacts/lead.ts';
const NOTIFY = 'src/lib/contacts/notify.ts';
const FORM_MODULE = 'src/lib/public/contact-form.ts';
const DETAIL = 'src/components/public/PropertyDetail.astro';
const CSS = 'src/styles/global.css';

function channels(overrides: Partial<PublicContactChannels> = {}): PublicContactChannels {
  return { ...EMPTY_CONTACT, ...overrides };
}

const SUBJECT = { code: 'LOBA-001', title: 'Lote con vista al mar' };

/* -------------------------------------------------------------------------- */
/* WhatsApp                                                                   */
/* -------------------------------------------------------------------------- */

describe('el numero de WhatsApp', () => {
  it('se limpia de todo lo que no sea un digito', () => {
    // La configuracion lo guarda como lo escriba una persona.
    expect(normalizeWhatsappNumber('+506 8888 8888')).toBe('50688888888');
    expect(normalizeWhatsappNumber('(506) 8888-8888')).toBe('50688888888');
  });

  it('uno que no puede ser un numero real no se usa', () => {
    expect(normalizeWhatsappNumber('123')).toBeNull();
    expect(normalizeWhatsappNumber('1'.repeat(16))).toBeNull();
    expect(normalizeWhatsappNumber('sin numero')).toBeNull();
  });

  it('sin numero utilizable no se ofrece el canal', () => {
    // Un enlace que no abre nada es peor que no ensenar el canal.
    expect(whatsappHref('123', 'es', null)).toBeNull();
    expect(whatsappHref(null, 'es', null)).toBeNull();
  });
});

describe('el mensaje prellenado', () => {
  it('identifica la propiedad por codigo y nombre, en espanol', () => {
    const message = whatsappMessage('es', SUBJECT);

    expect(message).toContain('LOBA-001');
    expect(message).toContain('Lote con vista al mar');
    expect(message).toContain('me interesa la propiedad');
  });

  it('y en ingles', () => {
    const message = whatsappMessage('en', SUBJECT);

    expect(message).toContain('LOBA-001');
    expect(message).toContain('interested in the property');
    expect(message).not.toContain('me interesa');
  });

  it('sin propiedad es un saludo general, tambien en los dos idiomas', () => {
    expect(whatsappMessage('es', null)).toContain('información');
    expect(whatsappMessage('en', null)).toContain('information');
  });

  it('anade el enlace de la ficha solo cuando se conoce', () => {
    const withUrl = whatsappMessage('es', { ...SUBJECT, href: 'https://codeloba.test/x' });

    expect(withUrl).toContain('https://codeloba.test/x');
    expect(whatsappMessage('es', { ...SUBJECT, href: null })).not.toContain('http');
  });

  it('viaja codificado dentro del enlace', () => {
    const href = whatsappHref('+506 8888 8888', 'es', SUBJECT);

    expect(href).toContain('https://wa.me/50688888888?text=');
    expect(href).toContain(encodeURIComponent('LOBA-001'));
    // Sin espacios crudos: romperian la URL.
    expect(href).not.toContain(' ');
  });
});

/* -------------------------------------------------------------------------- */
/* Canales                                                                    */
/* -------------------------------------------------------------------------- */

describe('que canales se ensenan', () => {
  it('solo los que estan configurados', () => {
    const list = availableChannels(channels({ phone: '+506 2222 2222' }), 'es');

    expect(list.map((item) => item.kind)).toEqual(['phone']);
  });

  it('el telefono enlaza sin espacios y se lee con ellos', () => {
    const [phone] = availableChannels(channels({ phone: '+506 2222 2222' }), 'es');

    expect(phone?.href).toBe('tel:+50622222222');
    expect(phone?.value).toBe('+506 2222 2222');
  });

  it('el correo enlaza como correo', () => {
    const [email] = availableChannels(channels({ email: 'hola@codeloba.test' }), 'es');

    expect(email?.href).toBe('mailto:hola@codeloba.test');
  });

  it('sin nada configurado no se ensena ningun bloque', () => {
    expect(availableChannels(EMPTY_CONTACT, 'es')).toEqual([]);
    expect(hasChannels(EMPTY_CONTACT)).toBe(false);
  });

  it('una red social sola ya es motivo para ensenar el bloque', () => {
    expect(
      hasChannels(channels({ social: [{ platform: 'Instagram', url: 'https://x.test' }] })),
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Respuesta del servidor                                                     */
/* -------------------------------------------------------------------------- */

describe('la respuesta del envio', () => {
  it('200 es exito', () => {
    expect(readContactResponse(200, '')).toEqual({ ok: true, code: null, field: null });
  });

  it('un codigo conocido llega tal cual, con su campo', () => {
    const body = JSON.stringify({
      error: { code: 'property_not_available', field: 'propertySlug' },
    });

    expect(readContactResponse(422, body)).toEqual({
      ok: false,
      code: 'property_not_available',
      field: 'propertySlug',
    });
  });

  it('cualquier cosa rara se trata como un error recuperable', () => {
    // El HTML de un proxy, un cuerpo vacio, un codigo que no conocemos.
    expect(readContactResponse(502, '<html>502</html>').code).toBe('server_error');
    expect(readContactResponse(500, '').code).toBe('server_error');
    expect(readContactResponse(422, JSON.stringify({ error: { code: 'raro' } })).code).toBe(
      'server_error',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Nada de secretos en el cliente                                             */
/* -------------------------------------------------------------------------- */

describe('ningun secreto llega al navegador', () => {
  it('las claves solo se nombran donde se ejecutan en el servidor', () => {
    // El endpoint y su handler; ninguna plantilla ni modulo de navegador.
    expect(read(API_ROUTE)).toContain('RESEND_API_KEY');
    expect(read(HANDLER)).toContain('RESEND_API_KEY');

    for (const file of [FORM, CHANNELS, PROPERTY_CONTACT, CONTACT_ES, CONTACT_EN, FORM_MODULE]) {
      expect(read(file)).not.toContain('RESEND_API_KEY');
      expect(read(file)).not.toContain('CONTACT_FROM_EMAIL');
      expect(read(file)).not.toContain('notificationsEmail');
      expect(read(file)).not.toContain('reviewerEmail');
    }
  });

  it('no hay ninguna clave escrita en el repositorio', () => {
    for (const file of [API_ROUTE, HANDLER, NOTIFY, LEAD, FORM, CONTACT_ES]) {
      // Una clave de Resend empieza por `re_`.
      expect(read(file)).not.toMatch(/\bre_[A-Za-z0-9]{8}/);
    }
  });

  it('los buzones internos ni se leen al construir el snapshot', () => {
    const readModel = read('src/lib/public/read-model.ts');

    expect(readModel).toContain('siteSettings.whatsapp');
    expect(readModel).not.toContain('siteSettings.notificationsEmail');
    expect(readModel).not.toContain('siteSettings.reviewerEmail');
  });

  it('esta documentado donde va cada variable', () => {
    const example = read('.dev.vars.example');

    expect(example).toContain('RESEND_API_KEY');
    expect(read('.gitignore')).toContain('.dev.vars');
  });
});

/* -------------------------------------------------------------------------- */
/* Estructura                                                                 */
/* -------------------------------------------------------------------------- */

describe('la pagina de contacto', () => {
  it('existe en los dos idiomas, con su arbol y su alternate', () => {
    expect(contactHref('es')).toBe('/es/contacto');
    expect(contactHref('en')).toBe('/en/contact');

    expect(read(CONTACT_ES)).toContain("const locale = 'es' as const");
    expect(read(CONTACT_ES)).toContain("contactHref('en')");
    expect(read(CONTACT_EN)).toContain("const locale = 'en' as const");
    expect(read(CONTACT_EN)).toContain("contactHref('es')");
  });

  it('el menu ya lleva a Contacto: se acabo el «Próximamente»', () => {
    const items = navigationFor('es');

    expect(items[2]?.available).toBe(true);
    expect(items[2]?.href).toBe('/es/contacto');
    expect(items.every((item) => item.available)).toBe(true);
  });

  it('los canales salen de la configuracion, no del codigo', () => {
    const page = read(CONTACT_ES);

    expect(page).toContain('loadPublicSnapshot().contact');
    // Ni un telefono ni un correo escritos a mano en la plantilla.
    expect(read(CHANNELS)).not.toMatch(/\+\d{3}\s?\d{4}/);
    expect(read(CHANNELS)).not.toMatch(/@[a-z]+\.(com|test|cr)/);
  });

  it('sin canales configurados se dice, y el formulario sigue', () => {
    expect(read(CONTACT_ES)).toContain('hasChannels(channels)');
    expect(read(CONTACT_ES)).toContain('labels.contactNoChannels');
  });
});

describe('el formulario', () => {
  it('es un formulario de verdad, no solo JavaScript', () => {
    const form = read(FORM);

    // Sin script, el navegador sabe enviarlo.
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/api/contact"');
  });

  it('cada campo tiene su etiqueta real', () => {
    const form = read(FORM);

    for (const id of ['contact-name', 'contact-value', 'contact-message', 'contact-consent']) {
      expect(form).toContain(`id="${id}"`);
    }
    expect(form).toContain('for="contact-name"');
    expect(form).toContain('for="contact-message"');
  });

  it('los limites del navegador coinciden con los del servidor', () => {
    const form = read(FORM);

    expect(form).toContain('maxlength="120"');
    expect(form).toContain('maxlength="200"');
    expect(form).toContain('maxlength="2000"');
  });

  it('lleva la trampa antispam, fuera del alcance de una persona', () => {
    const form = read(FORM);

    expect(form).toContain('name="website"');
    expect(form).toContain('tabindex="-1"');
    expect(form).toContain('aria-hidden="true"');
    // Fuera de pantalla, no `display: none`: hay robots que lo ignoran.
    expect(read(CSS)).toContain('.honeypot {');
    expect(read(CSS)).toContain('left: -9999px');
  });

  it('la marca de obligatorio no se pega a la etiqueta', () => {
    // Astro se come el espacio entre una expresion y la etiqueta siguiente:
    // sin esto se lee "NOMBRE(obligatorio)".
    expect(read(CSS)).toMatch(/\.field-required,\s+\.field-optional \{\s+margin-left:/);
  });

  it('el resultado se anuncia, no solo se pinta', () => {
    const form = read(FORM);

    expect(form).toContain('role="status"');
    expect(form).toContain('aria-live="polite"');
  });

  it('tiene los tres estados: enviando, enviado y error', () => {
    const module = read(FORM_MODULE);

    expect(module).toContain('texts.sending');
    expect(module).toContain('texts.sent');
    expect(module).toContain("say(texts.server_error, 'error')");
  });

  it('no manda ningun id de la base: la propiedad viaja por su slug', () => {
    expect(read(FORM)).toContain('data-property-slug={property?.slug}');
    expect(read(FORM_MODULE)).toContain('propertySlug');
    expect(read(FORM_MODULE)).not.toContain('propertyId');
  });
});

describe('el contacto desde una ficha', () => {
  it('sustituye al hueco anunciado', () => {
    const detail = read(DETAIL);

    expect(detail).toContain('<PropertyContact');
    expect(detail).not.toContain('contactComingSoon');
  });

  it('WhatsApp va destacado y con la propiedad dentro del mensaje', () => {
    const contact = read(PROPERTY_CONTACT);

    expect(contact).toContain('whatsapp-cta');
    expect(contact).toContain('whatsappHref(channels.whatsapp, locale, subject)');
    expect(contact).toContain('code: property.code');
  });

  it('abrir WhatsApp no guarda ninguna consulta', () => {
    const contact = read(PROPERTY_CONTACT);

    // Es un enlace: no hay fetch ni formulario detras.
    expect(contact).not.toContain('fetch(');
    expect(contact).toContain('rel="noopener noreferrer"');
  });

  it('el formulario llega con la propiedad puesta', () => {
    const contact = read(PROPERTY_CONTACT);

    // Nadie tiene que copiar un codigo a mano.
    expect(contact).toContain('slug: property.slug');
    expect(contact).toContain('code: property.code');
    expect(contact).toContain('title: property.title');
  });

  it('y no se repite WhatsApp en la lista de canales', () => {
    expect(read(PROPERTY_CONTACT)).toContain('{ ...channels, whatsapp: null }');
  });
});

describe('idiomas', () => {
  it('todo el contacto esta en los dos', () => {
    const es = labelsFor('es');
    const en = labelsFor('en');

    expect(es.contactTitle).toBe('Contacto');
    expect(en.contactTitle).toBe('Contact');
    expect(es.formSubmit).not.toBe(en.formSubmit);
    expect(es.errorTooFast).not.toBe(en.errorTooFast);
  });
});
