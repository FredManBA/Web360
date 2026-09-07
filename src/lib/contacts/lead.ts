/**
 * Consultas del formulario publico.
 *
 * Vive fuera de `admin/` a proposito: esto lo llama cualquiera desde
 * internet, sin sesion, y no comparte ni una regla con el panel.
 *
 * Dos decisiones que sostienen todo lo demas:
 *
 * - la propiedad se identifica por su SLUG, nunca por un id. El sitio publico
 *   no conoce ningun id de la base —eso se decidio en el read model— y
 *   aceptar uno equivaldria a creerse un numero escrito por el cliente. El
 *   servidor resuelve el slug y comprueba, en la misma consulta, que esa
 *   propiedad es publicamente visible;
 * - lo que se guarda es lo minimo del modelo que ya existia: nombre, medio,
 *   valor, mensaje, idioma, propiedad si la hay y el momento del
 *   consentimiento. Ni IP, ni cabeceras, ni rastro del navegador.
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { contacts, properties, propertyTranslations } from '../../db/schema';
import type { AdminDatabase } from '../admin/types';
import { isPubliclyVisible } from '../domain/visibility';
import type { ContactMethod, Locale } from '../domain/vocabularies';
import { contactMethodSchema, localeSchema } from '../validation/primitives';

/**
 * Limites de tamano.
 *
 * No son una defensa contra el spam por si solos: son el limite de lo que
 * tiene sentido guardar, y evitan que una sola peticion llene la base.
 */
export const LEAD_LIMITS = {
  name: 120,
  contactValue: 200,
  message: 2000,
  slug: 200,
} as const;

/**
 * Cuanto tarda una persona, como minimo, en rellenar el formulario.
 *
 * Es un badén, no una puerta: un bot que se moleste en falsear el campo pasa.
 * Sirve contra el relleno automatico instantaneo, que es la mayoria del ruido,
 * y no cuesta nada.
 */
export const MIN_FILL_MS = 1500;

export const leadSchema = z.strictObject({
  name: z.string().min(1).max(LEAD_LIMITS.name),
  method: contactMethodSchema,
  contactValue: z.string().min(1).max(LEAD_LIMITS.contactValue),
  message: z.string().max(LEAD_LIMITS.message).nullish(),
  locale: localeSchema,

  /** Slug de la propiedad consultada, cuando la consulta sale de una ficha. */
  propertySlug: z.string().max(LEAD_LIMITS.slug).nullish(),

  /** Sin consentimiento no se guarda nada. */
  consent: z.literal(true),

  /**
   * Trampa: un campo que existe en el HTML pero ninguna persona ve ni puede
   * enfocar. Si llega con contenido, quien envia no es una persona.
   */
  website: z.string().max(200).nullish(),

  /** Milisegundos entre abrir el formulario y enviarlo, segun el navegador. */
  elapsedMs: z.number().int().nonnegative().nullish(),
});

export type LeadInput = z.input<typeof leadSchema>;

export type LeadErrorCode =
  'validation_failed' | 'property_not_available' | 'too_fast' | 'storage_failed';

export interface LeadError {
  code: LeadErrorCode;
  /** Campo culpable, cuando se puede senalar uno sin decir de mas. */
  field?: string;
}

export interface LeadStored {
  id: number;
  /** Codigo de la propiedad consultada; hace falta para avisar por email. */
  propertyCode: string | null;
  propertyTitle: string | null;
}

export type LeadResult = { ok: true; stored: LeadStored | null } | { ok: false; error: LeadError };

/* -------------------------------------------------------------------------- */
/* Propiedad consultada                                                       */
/* -------------------------------------------------------------------------- */

export interface PublicPropertyRef {
  id: number;
  code: string;
  title: string;
}

/**
 * Resuelve el slug de una ficha publica.
 *
 * La visibilidad se comprueba en la MISMA consulta que resuelve el slug, con
 * la misma regla que decide el catalogo: asi no hay forma de asociar una
 * consulta a un borrador, a una archivada o a una vendida y oculta.
 *
 * Devuelve `null` tanto si no existe como si no es publica: por fuera son el
 * mismo caso, y distinguirlos permitiria sondear el catalogo no publicado.
 */
export async function resolvePublicProperty(
  db: AdminDatabase,
  locale: Locale,
  slug: string,
): Promise<PublicPropertyRef | null> {
  const rows = await db
    .select({
      id: properties.id,
      code: properties.code,
      title: propertyTranslations.title,
      publicationStatus: properties.publicationStatus,
      commercialStatus: properties.commercialStatus,
      showWhenSold: properties.showWhenSold,
    })
    .from(propertyTranslations)
    .innerJoin(properties, eq(propertyTranslations.propertyId, properties.id))
    .where(and(eq(propertyTranslations.locale, locale), eq(propertyTranslations.slug, slug)))
    .limit(1);

  const row = rows[0];
  if (row === undefined || row.title === null) return null;

  if (
    !isPubliclyVisible({
      publicationStatus: row.publicationStatus,
      commercialStatus: row.commercialStatus,
      showWhenSold: row.showWhenSold,
    })
  ) {
    return null;
  }

  return { id: row.id, code: row.code, title: row.title };
}

/* -------------------------------------------------------------------------- */
/* Alta                                                                       */
/* -------------------------------------------------------------------------- */

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

/**
 * Guarda una consulta.
 *
 * Lo que devuelve cuando la trampa se activa merece explicacion: el resultado
 * es `ok` con `stored: null`. Quien envia recibe la misma respuesta que si
 * hubiera funcionado, porque decirle "te he detectado" solo sirve para que
 * afine el siguiente intento. No se guarda nada y no se avisa a nadie.
 */
export async function createLead(
  db: AdminDatabase,
  input: unknown,
  now: Date = new Date(),
): Promise<LeadResult> {
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];

    return {
      ok: false,
      error: {
        code: 'validation_failed',
        ...(typeof field === 'string' ? { field } : {}),
      },
    };
  }

  const data = parsed.data;

  // La trampa: silencio y respuesta normal.
  if (blank(data.website) !== null) return { ok: true, stored: null };

  /*
   * Demasiado rapido para ser humano. Aqui SI se responde con error, y no en
   * silencio: una persona con el navegador rellenando por ella puede caer, y
   * merece saber que vuelva a intentarlo.
   */
  if (data.elapsedMs !== null && data.elapsedMs !== undefined && data.elapsedMs < MIN_FILL_MS) {
    return { ok: false, error: { code: 'too_fast' } };
  }

  const name = blank(data.name);
  const contactValue = blank(data.contactValue);
  if (name === null) return { ok: false, error: { code: 'validation_failed', field: 'name' } };
  if (contactValue === null) {
    return { ok: false, error: { code: 'validation_failed', field: 'contactValue' } };
  }

  let property: PublicPropertyRef | null = null;
  const slug = blank(data.propertySlug);

  if (slug !== null) {
    property = await resolvePublicProperty(db, data.locale, slug);

    // Se rechaza en vez de guardar la consulta suelta: quien pregunta por una
    // propiedad concreta espera que se sepa cual.
    if (property === null) {
      return { ok: false, error: { code: 'property_not_available', field: 'propertySlug' } };
    }
  }

  const inserted = await db
    .insert(contacts)
    .values({
      propertyId: property?.id ?? null,
      name,
      preferredContactMethod: data.method as ContactMethod,
      contactValue,
      message: blank(data.message),
      locale: data.locale,
      status: 'new',
      consentAcceptedAt: now,
    })
    .returning({ id: contacts.id });

  const id = inserted[0]?.id;
  if (id === undefined) return { ok: false, error: { code: 'storage_failed' } };

  return {
    ok: true,
    stored: {
      id,
      propertyCode: property?.code ?? null,
      propertyTitle: property?.title ?? null,
    },
  };
}
