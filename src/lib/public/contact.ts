/**
 * Contacto publico: lo que se decide sin tocar el DOM.
 *
 * Construir el enlace de WhatsApp con su mensaje ya escrito, decidir que
 * canales hay que ensenar y como se llama cada medio son preguntas de datos.
 * Viven aqui para poder probarlas, y para que el modulo de navegador se quede
 * solo con el envio del formulario.
 *
 * Nada de esto guarda nada: abrir WhatsApp no crea una consulta. Una consulta
 * se crea cuando alguien envia el formulario, y solo entonces.
 */

import type { Locale } from '../domain/vocabularies';
import type { PublicContactChannels } from './read-model';

/* -------------------------------------------------------------------------- */
/* WhatsApp                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Deja el numero como lo quiere `wa.me`: solo digitos.
 *
 * La configuracion lo guarda como lo escriba una persona —con espacios,
 * guiones, parentesis o un `+` delante— y todo eso rompe el enlace.
 */
export function normalizeWhatsappNumber(raw: string): string | null {
  const digits = [...raw].filter((character) => character >= '0' && character <= '9').join('');

  // Un numero internacional util no baja de 8 digitos ni pasa de 15 (E.164).
  return digits.length < 8 || digits.length > 15 ? null : digits;
}

export interface WhatsappSubject {
  code: string;
  title: string;
  /** URL absoluta de la ficha, cuando se conoce. */
  href?: string | null;
}

const GREETING: Record<Locale, string> = {
  es: 'Hola, me interesa la propiedad',
  en: 'Hello, I am interested in the property',
};

const GENERAL_GREETING: Record<Locale, string> = {
  es: 'Hola, me gustaría recibir información.',
  en: 'Hello, I would like to receive information.',
};

/**
 * Mensaje con el que se abre WhatsApp.
 *
 * Identifica la propiedad por CODIGO y nombre. El codigo es lo que permite a
 * quien atiende encontrarla sin preguntar, y no obliga a nadie a copiar nada.
 */
export function whatsappMessage(locale: Locale, subject: WhatsappSubject | null): string {
  if (subject === null) return GENERAL_GREETING[locale];

  const base = `${GREETING[locale]} ${subject.code} — ${subject.title}`;
  return subject.href === null || subject.href === undefined
    ? `${base}.`
    : `${base}.\n${subject.href}`;
}

/**
 * Enlace de WhatsApp con el mensaje ya escrito.
 *
 * `null` si el numero configurado no sirve: mejor no ensenar el canal que
 * ensenar un enlace que no abre nada.
 */
export function whatsappHref(
  whatsapp: string | null,
  locale: Locale,
  subject: WhatsappSubject | null,
): string | null {
  if (whatsapp === null) return null;

  const number = normalizeWhatsappNumber(whatsapp);
  if (number === null) return null;

  return `https://wa.me/${number}?text=${encodeURIComponent(whatsappMessage(locale, subject))}`;
}

/* -------------------------------------------------------------------------- */
/* Canales                                                                    */
/* -------------------------------------------------------------------------- */

export interface ContactChannel {
  kind: 'whatsapp' | 'phone' | 'email';
  href: string;
  /** El dato tal cual, para poder leerlo y copiarlo. */
  value: string;
}

/**
 * Los canales que de verdad se pueden ofrecer.
 *
 * Solo sale lo que esta configurado y es utilizable. Un telefono a medias no
 * se ensena "por si acaso": un enlace que no funciona es peor que la ausencia
 * del canal.
 */
export function availableChannels(
  channels: PublicContactChannels,
  locale: Locale,
  subject: WhatsappSubject | null = null,
): ContactChannel[] {
  const list: ContactChannel[] = [];

  const whatsapp = whatsappHref(channels.whatsapp, locale, subject);
  if (whatsapp !== null && channels.whatsapp !== null) {
    list.push({ kind: 'whatsapp', href: whatsapp, value: channels.whatsapp });
  }

  if (channels.phone !== null) {
    // `tel:` sin espacios; el texto visible conserva el formato legible.
    list.push({
      kind: 'phone',
      href: `tel:${channels.phone.replace(/\s+/g, '')}`,
      value: channels.phone,
    });
  }

  if (channels.email !== null) {
    list.push({ kind: 'email', href: `mailto:${channels.email}`, value: channels.email });
  }

  return list;
}

/** Hay algo que ensenar, aunque sea un solo canal. */
export function hasChannels(channels: PublicContactChannels): boolean {
  return (
    channels.whatsapp !== null ||
    channels.phone !== null ||
    channels.email !== null ||
    channels.social.length > 0
  );
}

/* -------------------------------------------------------------------------- */
/* Respuesta del envio                                                        */
/* -------------------------------------------------------------------------- */

/** Los codigos que puede devolver el endpoint publico. */
export const CONTACT_ERROR_CODES = [
  'invalid_request',
  'property_not_available',
  'too_fast',
  'server_error',
] as const;

export type ContactErrorCode = (typeof CONTACT_ERROR_CODES)[number];

export interface ContactResponse {
  ok: boolean;
  code: ContactErrorCode | null;
  field: string | null;
}

/**
 * Interpreta lo que respondio el servidor.
 *
 * Cualquier cosa rara —HTML de un proxy, un cuerpo vacio, un codigo que no
 * conocemos— se trata como un error generico y recuperable: la persona puede
 * volver a intentarlo, que es lo unico que necesita saber.
 */
export function readContactResponse(status: number, raw: string): ContactResponse {
  if (status === 200) return { ok: true, code: null, field: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'server_error', field: null };
  }

  const error = (parsed as { error?: { code?: unknown; field?: unknown } })?.error;
  const code = CONTACT_ERROR_CODES.find((candidate) => candidate === error?.code);

  return {
    ok: false,
    code: code ?? 'server_error',
    field: typeof error?.field === 'string' ? error.field : null,
  };
}
