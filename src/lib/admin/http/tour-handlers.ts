/**
 * Handlers HTTP del recorrido 360.
 *
 * Igual de delgados que los del resto del panel: acceso, cuerpo, funcion de
 * dominio y traduccion a HTTP. La autorizacion, el mismo origen y
 * `Cache-Control: no-store` los aporta la envoltura compartida.
 *
 * La propiedad la define SIEMPRE la URL: el cuerpo no admite `propertyId`.
 */

import { z } from 'zod';

import { createTourLink, deleteTourLink, updateTourLink } from '../tour/links';
import { getPropertyTour } from '../tour/get-tour';
import { createTourNode, deleteTourNode, setStartNode, updateTourNode } from '../tour/nodes';
import { parseRouteId, readJsonBody, requireAdminAccess, requireSameOrigin } from './guard';
import { jsonError, jsonFromResult, jsonInternalError } from './responses';
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

function invalidId(field: string): Response {
  return jsonError('validation_failed', 'El identificador debe ser un entero positivo.', 422, {
    field,
  });
}

function invalidBody(issue: string | undefined): Response {
  return jsonError('validation_failed', 'Datos inválidos.', 422, {
    ...(issue === undefined ? {} : { field: issue }),
  });
}

/* -------------------------------------------------------------------------- */
/* Esquemas                                                                   */
/* -------------------------------------------------------------------------- */

const positiveInt = z.number().int().positive();
const optionalName = z.string().max(200).nullish();

/**
 * Camara inicial del nodo.
 *
 * La convencion de unidades la fijara el visor; el esquema solo exige que el
 * FOV sea positivo, y eso mismo se comprueba aqui.
 */
const camera = {
  initialYaw: z.number().nullish(),
  initialPitch: z.number().nullish(),
  initialFov: z.number().positive().nullish(),
};

/** `strictObject`: un `propertyId` en el cuerpo se rechaza, no se ignora. */
const createNodeSchema = z.strictObject({
  propertyMediaId: positiveInt,
  sortOrder: z.number().int().optional(),
  nameEs: optionalName,
  nameEn: optionalName,
  ...camera,
});

/*
 * `propertyMediaId` no aparece: cambiar el panorama de un nodo equivale a otro
 * nodo. Al ser estricto, intentarlo devuelve 422 en lugar de ignorarse.
 */
const updateNodeSchema = z.strictObject({
  sortOrder: z.number().int().optional(),
  nameEs: optionalName,
  nameEn: optionalName,
  ...camera,
});

const startNodeSchema = z.strictObject({ isStart: z.boolean() });

const createLinkSchema = z.strictObject({
  fromNodeId: positiveInt,
  toNodeId: positiveInt,
  yaw: z.number().optional(),
  pitch: z.number().optional(),
  sortOrder: z.number().int().optional(),
});

/** Los extremos no se editan: mover un enlace es borrarlo y crear otro. */
const updateLinkSchema = z.strictObject({
  yaw: z.number().optional(),
  pitch: z.number().optional(),
  sortOrder: z.number().int().optional(),
});

/* -------------------------------------------------------------------------- */
/* GET /api/admin/properties/:id/tour                                         */
/* -------------------------------------------------------------------------- */

export function handleGetTour(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    return jsonFromResult(await getPropertyTour(ctx.db, propertyId));
  });
}

/* -------------------------------------------------------------------------- */
/* Nodos                                                                      */
/* -------------------------------------------------------------------------- */

export function handleCreateTourNode(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = createNodeSchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await createTourNode(ctx.db, propertyId, parsed.data), 201);
  });
}

export function handleUpdateTourNode(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const nodeId = parseRouteId(ctx.params.nodeId);
    if (nodeId === null) return invalidId('nodeId');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = updateNodeSchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await updateTourNode(ctx.db, propertyId, nodeId, parsed.data));
  });
}

export function handleDeleteTourNode(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const nodeId = parseRouteId(ctx.params.nodeId);
    if (nodeId === null) return invalidId('nodeId');

    // DELETE no exige cuerpo.
    return jsonFromResult(await deleteTourNode(ctx.db, propertyId, nodeId));
  });
}

/**
 * PUT /api/admin/properties/:id/tour/nodes/:nodeId/start
 *
 * Ruta propia porque el cambio tiene que ser atomico: retirar el inicial
 * anterior y marcar el nuevo en el mismo lote. Con dos PATCH sueltos, un fallo
 * entre medias dejaria el recorrido sin punto de partida.
 */
export function handleSetStartNode(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const nodeId = parseRouteId(ctx.params.nodeId);
    if (nodeId === null) return invalidId('nodeId');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = startNodeSchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await setStartNode(ctx.db, propertyId, nodeId, parsed.data.isStart));
  });
}

/* -------------------------------------------------------------------------- */
/* Enlaces                                                                    */
/* -------------------------------------------------------------------------- */

export function handleCreateTourLink(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = createLinkSchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await createTourLink(ctx.db, propertyId, parsed.data), 201);
  });
}

export function handleUpdateTourLink(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const linkId = parseRouteId(ctx.params.linkId);
    if (linkId === null) return invalidId('linkId');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = updateLinkSchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await updateTourLink(ctx.db, propertyId, linkId, parsed.data));
  });
}

export function handleDeleteTourLink(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const linkId = parseRouteId(ctx.params.linkId);
    if (linkId === null) return invalidId('linkId');

    return jsonFromResult(await deleteTourLink(ctx.db, propertyId, linkId));
  });
}
