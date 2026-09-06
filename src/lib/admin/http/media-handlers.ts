/**
 * Handlers HTTP de multimedia.
 *
 * Igual de delgados que los del nucleo y los de caracteristicas: acceso,
 * cuerpo, funcion de dominio y traduccion a HTTP. La autorizacion, el mismo
 * origen y `Cache-Control: no-store` los aporta la envoltura compartida.
 *
 * La propiedad la define SIEMPRE la URL: el cuerpo no admite `propertyId`.
 *
 * Aqui no se sube ningun archivo. El endpoint de subida llegara cuando exista
 * almacenamiento; por ahora todo lo que se escribe son metadatos.
 */

import { z } from 'zod';

import { getPropertyMedia } from '../media/get-media';
import { createMedia, deleteMedia, setMediaRoles, updateMedia } from '../media/media';
import { createMediaGroup, deleteMediaGroup, updateMediaGroup } from '../media/media-groups';
import { MEDIA_KINDS, SOURCE_PROVIDERS } from '../../domain/vocabularies';
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

const optionalText = z.string().max(500).nullish();
const positiveInt = z.number().int().positive();

/** `strictObject`: un `propertyId` en el cuerpo se rechaza, no se ignora. */
const groupBodySchema = z.strictObject({
  nameEs: optionalText,
  nameEn: optionalText,
  sortOrder: z.number().int().optional(),
});

/** Textos por idioma, comunes a crear y actualizar. */
const mediaTexts = {
  titleEs: optionalText,
  altTextEs: optionalText,
  captionEs: optionalText,
  titleEn: optionalText,
  altTextEn: optionalText,
  captionEn: optionalText,
};

/**
 * Metadatos tecnicos.
 *
 * Los limites positivos son los mismos CHECK que ya tiene el esquema; se
 * comprueban aqui para responder 422 con el campo, en vez de un error del
 * driver.
 */
const mediaMetadata = {
  mimeType: z.string().max(255).nullish(),
  fileSizeBytes: positiveInt.nullish(),
  width: positiveInt.nullish(),
  height: positiveInt.nullish(),
  durationSeconds: z.number().positive().nullish(),
};

const createMediaBodySchema = z.strictObject({
  groupId: positiveInt.nullish(),
  mediaKind: z.enum(MEDIA_KINDS),
  sourceProvider: z.enum(SOURCE_PROVIDERS),
  objectKey: z.string().max(1024).nullish(),
  youtubeVideoId: z.string().max(64).nullish(),
  sortOrder: z.number().int().optional(),
  ...mediaTexts,
  ...mediaMetadata,
});

/*
 * `mediaKind` y `sourceProvider` no aparecen: no se pueden cambiar despues de
 * registrar el archivo. Al ser estricto, intentarlo devuelve 422 en lugar de
 * ignorarse en silencio.
 */
const updateMediaBodySchema = z.strictObject({
  groupId: positiveInt.nullish(),
  objectKey: z.string().max(1024).nullish(),
  youtubeVideoId: z.string().max(64).nullish(),
  sortOrder: z.number().int().optional(),
  isHero: z.boolean().optional(),
  isCatalogCover: z.boolean().optional(),
  ...mediaTexts,
  ...mediaMetadata,
});

const rolesBodySchema = z.strictObject({
  isHero: z.boolean().optional(),
  isCatalogCover: z.boolean().optional(),
});

/* -------------------------------------------------------------------------- */
/* GET /api/admin/properties/:id/media                                        */
/* -------------------------------------------------------------------------- */

export function handleGetMedia(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    return jsonFromResult(await getPropertyMedia(ctx.db, propertyId));
  });
}

/* -------------------------------------------------------------------------- */
/* Grupos                                                                     */
/* -------------------------------------------------------------------------- */

export function handleCreateMediaGroup(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const body = await readJsonBody(ctx.request, { allowEmpty: true });
    if (!body.ok) return body.response;

    const parsed = groupBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await createMediaGroup(ctx.db, propertyId, parsed.data), 201);
  });
}

export function handleUpdateMediaGroup(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const groupId = parseRouteId(ctx.params.groupId);
    if (groupId === null) return invalidId('groupId');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = groupBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await updateMediaGroup(ctx.db, propertyId, groupId, parsed.data));
  });
}

export function handleDeleteMediaGroup(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const groupId = parseRouteId(ctx.params.groupId);
    if (groupId === null) return invalidId('groupId');

    // DELETE no exige cuerpo.
    return jsonFromResult(await deleteMediaGroup(ctx.db, propertyId, groupId));
  });
}

/* -------------------------------------------------------------------------- */
/* Archivos                                                                   */
/* -------------------------------------------------------------------------- */

export function handleCreateMedia(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = createMediaBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await createMedia(ctx.db, propertyId, parsed.data), 201);
  });
}

export function handleUpdateMedia(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const mediaId = parseRouteId(ctx.params.mediaId);
    if (mediaId === null) return invalidId('mediaId');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = updateMediaBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await updateMedia(ctx.db, propertyId, mediaId, parsed.data));
  });
}

export function handleDeleteMedia(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const mediaId = parseRouteId(ctx.params.mediaId);
    if (mediaId === null) return invalidId('mediaId');

    return jsonFromResult(await deleteMedia(ctx.db, propertyId, mediaId));
  });
}

/**
 * PUT /api/admin/properties/:id/media/:mediaId/roles
 *
 * Ruta propia porque el intercambio tiene que ser atomico: retirar el rol al
 * anterior y darselo al nuevo en el mismo lote. Con un PATCH suelto por cada
 * archivo, un fallo entre medias dejaria la propiedad sin hero.
 */
export function handleSetMediaRoles(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const mediaId = parseRouteId(ctx.params.mediaId);
    if (mediaId === null) return invalidId('mediaId');

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = rolesBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    return jsonFromResult(await setMediaRoles(ctx.db, propertyId, mediaId, parsed.data));
  });
}
