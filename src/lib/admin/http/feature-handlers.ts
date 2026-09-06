/**
 * Handlers HTTP de caracteristicas.
 *
 * Igual de delgados que los del nucleo: acceso, cuerpo, funcion de dominio y
 * traduccion a HTTP. La autorizacion, el mismo origen y `Cache-Control:
 * no-store` los aporta la envoltura compartida; aqui no se repite nada.
 *
 * La propiedad la define SIEMPRE la URL: el cuerpo no admite `propertyId`.
 */

import { z } from 'zod';

import { createFeature, deleteFeature, updateFeature } from '../features/features';
import {
  createFeatureGroup,
  deleteFeatureGroup,
  updateFeatureGroup,
} from '../features/feature-groups';
import { getPropertyFeatures } from '../features/get-features';
import { parseRouteId, readJsonBody, requireAdminAccess, requireSameOrigin } from './guard';
import { jsonError, jsonFromResult, jsonInternalError } from './responses';
import type { AdminHttpContext } from './handlers';

/** Misma envoltura que los handlers del nucleo. */
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

function invalidId(field: string): Response {
  return jsonError('validation_failed', 'El identificador debe ser un entero positivo.', 422, {
    field,
  });
}

const optionalText = z.string().max(500).nullish();

/** `strictObject`: un `propertyId` en el cuerpo se rechaza, no se ignora. */
const groupBodySchema = z.strictObject({
  nameEs: optionalText,
  nameEn: optionalText,
  sortOrder: z.number().int().optional(),
});

const featureBodySchema = z.strictObject({
  groupId: z.number().int().positive().nullish(),
  labelEs: optionalText,
  valueEs: optionalText,
  labelEn: optionalText,
  valueEn: optionalText,
  sortOrder: z.number().int().optional(),
});

function invalidBody(issue: string | undefined): Response {
  return jsonError('validation_failed', 'Datos inválidos.', 422, {
    ...(issue === undefined ? {} : { field: issue }),
  });
}

/* -------------------------------------------------------------------------- */
/* GET /api/admin/properties/:id/features                                     */
/* -------------------------------------------------------------------------- */

export function handleGetFeatures(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    return jsonFromResult(await getPropertyFeatures(ctx.db, propertyId));
  });
}

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

export function handleCreateFeatureGroup(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const body = await readJsonBody(ctx.request, { allowEmpty: true });
    if (!body.ok) return body.response;

    const parsed = groupBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await createFeatureGroup(ctx.db, propertyId, parsed.data), 201);
  });
}

export function handleUpdateFeatureGroup(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const groupId = parseRouteId(ctx.params.groupId);
    if (groupId === null) return invalidId('groupId');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = groupBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await updateFeatureGroup(ctx.db, propertyId, groupId, parsed.data));
  });
}

export function handleDeleteFeatureGroup(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const groupId = parseRouteId(ctx.params.groupId);
    if (groupId === null) return invalidId('groupId');

    // DELETE no exige cuerpo.
    return jsonFromResult(await deleteFeatureGroup(ctx.db, propertyId, groupId));
  });
}

/* -------------------------------------------------------------------------- */
/* Caracteristicas                                                            */
/* -------------------------------------------------------------------------- */

export function handleCreateFeature(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const body = await readJsonBody(ctx.request, { allowEmpty: true });
    if (!body.ok) return body.response;

    const parsed = featureBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await createFeature(ctx.db, propertyId, parsed.data), 201);
  });
}

export function handleUpdateFeature(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const featureId = parseRouteId(ctx.params.featureId);
    if (featureId === null) return invalidId('featureId');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = featureBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await updateFeature(ctx.db, propertyId, featureId, parsed.data));
  });
}

export function handleDeleteFeature(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const featureId = parseRouteId(ctx.params.featureId);
    if (featureId === null) return invalidId('featureId');

    return jsonFromResult(await deleteFeature(ctx.db, propertyId, featureId));
  });
}
