/**
 * Handlers HTTP de multimedia.
 *
 * Igual de delgados que los del nucleo y los de caracteristicas: acceso,
 * cuerpo, funcion de dominio y traduccion a HTTP. La autorizacion, el mismo
 * origen y `Cache-Control: no-store` los aporta la envoltura compartida.
 *
 * La propiedad la define SIEMPRE la URL: el cuerpo no admite `propertyId`.
 *
 * La subida es el unico endpoint que no recibe JSON: los bytes viajan en un
 * `multipart/form-data`, porque meterlos en JSON obligaria a codificarlos en
 * base64 y a cargar un tercio mas de peso en la memoria del Worker.
 */

import { z } from 'zod';

import { getPropertyMedia } from '../media/get-media';
import { createMedia, setMediaRoles, updateMedia } from '../media/media';
import { createMediaGroup, deleteMediaGroup, updateMediaGroup } from '../media/media-groups';
import { deleteMediaWithObject, uploadMedia } from '../media/upload';
import { MEDIA_KINDS, SOURCE_PROVIDERS } from '../../domain/vocabularies';
import {
  parseRouteId,
  readJsonBody,
  readMultipartForm,
  requireAdminAccess,
  requireSameOrigin,
} from './guard';
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

    // Retira la fila y, si la fila se va, tambien el objeto de R2.
    return jsonFromResult(await deleteMediaWithObject(ctx.db, ctx.bucket, propertyId, mediaId));
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

/* -------------------------------------------------------------------------- */
/* POST /api/admin/properties/:id/media/upload                                */
/* -------------------------------------------------------------------------- */

/**
 * Campos del formulario, aparte del archivo.
 *
 * Llegan como texto, asi que `groupId` se convierte aqui; el resto son textos
 * opcionales con el mismo limite que el endpoint JSON.
 */
const uploadFieldsSchema = z.strictObject({
  mediaKind: z.enum(MEDIA_KINDS),
  groupId: z.coerce.number().int().positive().optional(),
  titleEs: z.string().max(500).optional(),
  altTextEs: z.string().max(500).optional(),
  captionEs: z.string().max(500).optional(),
  titleEn: z.string().max(500).optional(),
  altTextEn: z.string().max(500).optional(),
  captionEn: z.string().max(500).optional(),
});

/** Los campos de texto del formulario, sin el archivo. */
function textFields(form: FormData): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [name, value] of form.entries()) {
    if (name === 'file') continue;
    if (typeof value !== 'string') continue;
    // Un campo vacio equivale a no enviarlo.
    if (value.length > 0) fields[name] = value;
  }

  return fields;
}

export function handleUploadMedia(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const propertyId = parseRouteId(ctx.params.id);
    if (propertyId === null) return invalidId('id');

    const body = await readMultipartForm(ctx.request);
    if (!body.ok) return body.response;

    const file = body.form.get('file');
    if (!(file instanceof File)) {
      return jsonError('validation_failed', 'Falta el archivo.', 422, { field: 'file' });
    }

    const parsed = uploadFieldsSchema.safeParse(textFields(body.form));
    if (!parsed.success) return invalidBody(parsed.error.issues[0]?.path.join('.'));

    /*
     * Se carga entero en memoria a proposito: hay que ver los primeros bytes
     * para saber que es de verdad, y el tamano ya esta acotado por tipo.
     */
    const bytes = await file.arrayBuffer();

    return jsonFromResult(
      await uploadMedia(ctx.db, ctx.bucket, propertyId, {
        mediaKind: parsed.data.mediaKind,
        groupId: parsed.data.groupId ?? null,
        fileName: file.name,
        declaredMimeType: file.type,
        bytes,
        titleEs: parsed.data.titleEs,
        altTextEs: parsed.data.altTextEs,
        captionEs: parsed.data.captionEs,
        titleEn: parsed.data.titleEn,
        altTextEn: parsed.data.altTextEn,
        captionEn: parsed.data.captionEn,
      }),
      201,
    );
  });
}
