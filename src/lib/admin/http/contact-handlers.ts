/**
 * Handlers HTTP de la bandeja de consultas.
 *
 * Misma envoltura que el resto del panel: acceso de Access, mismo origen y
 * `Cache-Control: no-store`. Estos endpoints devuelven nombres, telefonos y
 * correos de personas que escribieron: no pueden cachearse ni verse sin
 * sesion.
 *
 * Nada que ver con `/api/contact`, que es publico y solo escribe.
 */

import { z } from 'zod';

import { deleteContact, getContact, listContacts, setContactStatus } from '../contacts/contacts';
import { contactStatusSchema } from '../../validation/primitives';
import { parseRouteId, readJsonBody, requireAdminAccess, requireSameOrigin } from './guard';
import { jsonError, jsonFromResult, jsonInternalError, jsonSuccess } from './responses';
import type { AdminHttpContext } from './handlers';

/** Misma envoltura que el resto de handlers administrativos. */
async function handle(ctx: AdminHttpContext, run: () => Promise<Response>): Promise<Response> {
  try {
    const auth = await requireAdminAccess(
      ctx.request,
      ctx.env,
      ctx.accessKeyResolver === undefined ? {} : { keyResolver: ctx.accessKeyResolver },
    );
    if (auth.denied !== null) return auth.denied;

    const crossOrigin = requireSameOrigin(ctx.request);
    if (crossOrigin !== null) return crossOrigin;

    return await run();
  } catch (error) {
    return jsonInternalError(error);
  }
}

function invalidId(): Response {
  return jsonError('validation_failed', 'El identificador debe ser un entero positivo.', 422, {
    field: 'contactId',
  });
}

const listQuerySchema = z.strictObject({ status: contactStatusSchema.optional() });
const statusSchema = z.strictObject({ status: contactStatusSchema });

export function handleListContacts(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const url = new URL(ctx.request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));

    if (!parsed.success) {
      return jsonError('validation_failed', 'Parametros de consulta invalidos.', 422, {
        field: parsed.error.issues[0]?.path.join('.') ?? undefined,
      });
    }

    return jsonSuccess(await listContacts(ctx.db, parsed.data));
  });
}

export function handleGetContact(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.contactId);
    if (id === null) return invalidId();

    return jsonFromResult(await getContact(ctx.db, id));
  });
}

export function handleUpdateContactStatus(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.contactId);
    if (id === null) return invalidId();

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = statusSchema.safeParse(body.value);
    if (!parsed.success) {
      return jsonError('validation_failed', 'Estado invalido.', 422, { field: 'status' });
    }

    return jsonFromResult(await setContactStatus(ctx.db, id, parsed.data.status));
  });
}

export function handleDeleteContact(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.contactId);
    if (id === null) return invalidId();

    const result = await deleteContact(ctx.db, id);
    return result.ok ? new Response(null, { status: 204 }) : jsonFromResult(result);
  });
}
