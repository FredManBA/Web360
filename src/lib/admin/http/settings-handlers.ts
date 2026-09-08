/**
 * Handlers HTTP de la configuracion del sitio.
 *
 * Misma envoltura que el resto del panel: acceso de Access, mismo origen y
 * `Cache-Control: no-store`. Aqui se leen y se escriben los buzones internos
 * —revision y avisos—, asi que estos endpoints no pueden verse sin sesion ni
 * quedarse cacheados en ningun sitio.
 *
 * El idioma lo define SIEMPRE la URL; el cuerpo no admite `locale`.
 */

import {
  createSocialLink,
  deleteSocialLink,
  getSiteConfig,
  reorderSocialLinks,
  updateSiteSettings,
  updateSocialLink,
  upsertSiteTranslation,
} from '../settings/settings';
import { localeSchema } from '../../validation/primitives';
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
    field: 'linkId',
  });
}

export function handleGetSettings(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => jsonSuccess(await getSiteConfig(ctx.db)));
}

export function handleUpdateSettings(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    return jsonFromResult(await updateSiteSettings(ctx.db, body.value));
  });
}

export function handleUpdateSettingsTranslation(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const locale = localeSchema.safeParse(ctx.params.locale);
    if (!locale.success) {
      return jsonError('validation_failed', 'Idioma no soportado.', 422, { field: 'locale' });
    }

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    return jsonFromResult(await upsertSiteTranslation(ctx.db, locale.data, body.value));
  });
}

/* -------------------------------------------------------------------------- */
/* Redes sociales                                                             */
/* -------------------------------------------------------------------------- */

export function handleCreateSocialLink(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    return jsonFromResult(await createSocialLink(ctx.db, body.value), 201);
  });
}

export function handleUpdateSocialLink(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.linkId);
    if (id === null) return invalidId();

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    return jsonFromResult(await updateSocialLink(ctx.db, id, body.value));
  });
}

export function handleDeleteSocialLink(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.linkId);
    if (id === null) return invalidId();

    const result = await deleteSocialLink(ctx.db, id);
    return result.ok ? new Response(null, { status: 204 }) : jsonFromResult(result);
  });
}

export function handleReorderSocialLinks(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    return jsonFromResult(await reorderSocialLinks(ctx.db, body.value));
  });
}
