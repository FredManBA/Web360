/**
 * Endpoint publico de contacto.
 *
 * Es el unico camino de escritura abierto a internet en todo el proyecto, asi
 * que se parece poco al resto: no hay sesion que comprobar, y a cambio todo
 * lo que llega es sospechoso hasta que se valida.
 *
 * Deliberadamente separado de `admin/http`: comparte el estilo, no el codigo.
 * Aquel responde con codigos de dominio detallados porque quien los lee es el
 * panel; este responde con cuatro codigos y ni una pista mas.
 *
 * El orden importa: primero se guarda la consulta, despues se intenta avisar.
 * Si el aviso falla, la consulta ya esta en la base y quien la envio recibe su
 * confirmacion. Perder un cliente porque Resend tuvo un mal dia seria absurdo.
 */

import { eq } from 'drizzle-orm';

import { siteSettings } from '../../db/schema';
import type { AdminDatabase } from '../admin/types';
import { createLead, type LeadErrorCode } from './lead';
import { notifyNewLead, type NotifyDeps, type NotifyOutcome } from './notify';

/** Mas de esto no es un formulario de contacto, es otra cosa. */
export const MAX_BODY_BYTES = 16 * 1024;

export interface ContactEnv {
  RESEND_API_KEY?: string | undefined;
  /** Remitente verificado en Resend. */
  CONTACT_FROM_EMAIL?: string | undefined;
}

export interface ContactContext {
  request: Request;
  db: AdminDatabase;
  env: ContactEnv;
  /** Se inyecta en los tests para no salir a la red. */
  fetch?: typeof globalThis.fetch;
  now?: Date;
}

/** Lo unico que puede saber quien llama desde fuera. */
export type PublicErrorCode =
  'invalid_request' | 'property_not_available' | 'too_fast' | 'server_error';

const HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  // Una respuesta a un formulario no se cachea en ningun sitio.
  'cache-control': 'no-store',
};

function success(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: HEADERS });
}

/**
 * Error publico.
 *
 * El `message` es generico a proposito: el texto que ve la persona lo pone la
 * pagina, que ya esta traducida. Lo que viaja es el codigo.
 */
function failure(code: PublicErrorCode, status: number, field?: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message: 'La consulta no se pudo enviar.', ...(field ? { field } : {}) },
    }),
    { status, headers: HEADERS },
  );
}

const STATUS_BY_CODE: Record<LeadErrorCode, { status: number; code: PublicErrorCode }> = {
  validation_failed: { status: 422, code: 'invalid_request' },
  property_not_available: { status: 422, code: 'property_not_available' },
  too_fast: { status: 429, code: 'too_fast' },
  storage_failed: { status: 500, code: 'server_error' },
};

/** Destinatario de los avisos, que sale de la configuracion del sitio. */
async function notificationsRecipient(db: AdminDatabase): Promise<string | null> {
  const rows = await db
    .select({ email: siteSettings.notificationsEmail })
    .from(siteSettings)
    .where(eq(siteSettings.id, 1))
    .limit(1);

  const email = rows[0]?.email?.trim();
  return email === undefined || email.length === 0 ? null : email;
}

/**
 * Rechaza escrituras cross-origin evidentes.
 *
 * El formulario es de la propia web. Si el navegador manda `Origin`, tiene que
 * coincidir; cuando no la manda (curl, tests) no hay nada que comprobar. No se
 * emite ninguna cabecera CORS: este endpoint no esta pensado para terceros.
 */
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;

  return origin !== new URL(request.url).origin;
}

export async function handleContact(ctx: ContactContext): Promise<Response> {
  const { request } = ctx;

  if (request.method !== 'POST') return failure('invalid_request', 405);
  if (crossOrigin(request)) return failure('invalid_request', 403);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return failure('invalid_request', 415);
  }

  /*
   * El tamano se corta antes de mirar el contenido: analizar un JSON de varios
   * megabytes para descubrir que sobra es trabajo regalado a quien lo envia.
   */
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return failure('invalid_request', 413);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return failure('invalid_request', 400);
  }

  if (raw.length > MAX_BODY_BYTES) return failure('invalid_request', 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return failure('invalid_request', 400);
  }

  let result;
  try {
    result = await createLead(ctx.db, body, ctx.now);
  } catch (error) {
    /*
     * Nunca se filtra el detalle: un mensaje de SQLite revelaria nombres de
     * tablas. Se registra en el servidor y se responde generico.
     */
    console.error('[contacto] no se pudo guardar la consulta:', error);
    return failure('server_error', 500);
  }

  if (!result.ok) {
    const mapped = STATUS_BY_CODE[result.error.code];
    return failure(mapped.code, mapped.status, result.error.field);
  }

  // La trampa se activo: misma respuesta que un envio bueno, y nada guardado.
  if (result.stored === null) return success();

  await notify(ctx, result.stored);

  return success();
}

/**
 * Intenta avisar, y pase lo que pase deja la respuesta en exito.
 *
 * La consulta ya esta guardada: el aviso es una comodidad para el
 * administrador, no parte del trato con quien escribio.
 */
async function notify(
  ctx: ContactContext,
  stored: { id: number; propertyCode: string | null; propertyTitle: string | null },
): Promise<NotifyOutcome> {
  const body = await ctx.db.query.contacts.findFirst({
    where: (row, { eq: is }) => is(row.id, stored.id),
  });

  const deps: NotifyDeps = {
    apiKey: ctx.env.RESEND_API_KEY ?? null,
    from: ctx.env.CONTACT_FROM_EMAIL ?? null,
    to: await notificationsRecipient(ctx.db),
    ...(ctx.fetch === undefined ? {} : { fetch: ctx.fetch }),
  };

  const outcome = await notifyNewLead(deps, {
    id: stored.id,
    name: body?.name ?? '',
    method: body?.preferredContactMethod ?? 'other',
    contactValue: body?.contactValue ?? '',
    message: body?.message ?? null,
    locale: body?.locale ?? 'es',
    propertyCode: stored.propertyCode,
    propertyTitle: stored.propertyTitle,
  });

  /*
   * Queda registrado, que es lo que pide poder auditarlo mas adelante. No se
   * reintenta: un reintento en linea alargaria la espera de quien envio el
   * formulario para arreglar un problema que no es suyo.
   */
  if (outcome.status === 'failed') {
    console.error(`[contacto] consulta ${stored.id} guardada, aviso fallido: ${outcome.reason}`);
  }

  return outcome;
}
