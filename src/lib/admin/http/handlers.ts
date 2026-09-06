/**
 * Handlers HTTP de la API administrativa.
 *
 * Son DELGADOS a proposito: validan acceso, leen la peticion, llaman a la
 * funcion de dominio de la Fase 2B y traducen el resultado a HTTP. No hay
 * aqui ninguna regla de negocio, SQL ni validacion propia.
 *
 * Viven fuera de `src/pages/` para poder probarlos con `Request` reales sin
 * montar el contexto completo de Astro. Los archivos de ruta son envoltorios
 * de tres lineas.
 */

import type { JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

import {
  commercialStatusSchema,
  localeSchema,
  publicationStatusSchema,
} from '../../validation/primitives';
import { archiveProperty } from '../properties/archive-property';
import { createPropertyDraft } from '../properties/create-property';
import { getPropertyForEdit } from '../properties/get-property';
import { listProperties } from '../properties/list-properties';
import { updateProperty } from '../properties/update-property';
import { updatePropertyStatus } from '../properties/update-property-status';
import { upsertPropertyTranslation } from '../properties/update-property-translation';
import {
  createCustomPropertyType,
  listActivePropertyTypes,
} from '../property-types/property-types';
import type { AdminBatchDatabase } from '../types';
import {
  parseRouteId,
  readJsonBody,
  requireAdminAccess,
  requireSameOrigin,
  type AdminHttpEnv,
} from './guard';
import { jsonError, jsonFromResult, jsonInternalError, jsonSuccess } from './responses';

export interface AdminHttpContext {
  request: Request;
  params: Record<string, string | undefined>;
  /*
   * Se pide la variante con `batch` porque la reordenacion necesita escribir
   * todo el orden en una sola transaccion. El resto de handlers la usa como
   * una base normal.
   */
  db: AdminBatchDatabase;
  env: AdminHttpEnv;

  /**
   * Punto de inyeccion para pruebas: permite verificar los JWT contra un JWKS
   * local en vez de descargarlo de Cloudflare. El puente de Astro nunca lo
   * define, asi que en produccion siempre se usa el JWKS remoto real.
   */
  accessKeyResolver?: JWTVerifyGetKey;
}

/**
 * Envoltura comun: autorizacion, comprobacion de origen y captura de errores
 * inesperados, para que ningun handler filtre un fallo de SQL.
 *
 * La autorizacion se resuelve UNA sola vez por peticion y aqui, de modo que
 * ninguno de los nueve endpoints repite la validacion del JWT.
 */
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
    field: 'id',
  });
}

/* -------------------------------------------------------------------------- */
/* /api/admin/properties                                                      */
/* -------------------------------------------------------------------------- */

const listQuerySchema = z.strictObject({
  publicationStatus: publicationStatusSchema.optional(),
  commercialStatus: commercialStatusSchema.optional(),
  propertyTypeId: z.coerce.number().int().positive().optional(),
});

export function handleListProperties(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const url = new URL(ctx.request.url);
    const raw = Object.fromEntries(url.searchParams.entries());

    const parsed = listQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError('validation_failed', 'Parametros de consulta invalidos.', 422, {
        field: parsed.error.issues[0]?.path.join('.') ?? undefined,
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    return jsonSuccess(await listProperties(ctx.db, parsed.data));
  });
}

/**
 * El cliente solo puede sugerir tipo, idioma y titulo. El codigo se genera
 * solo, y el estado inicial lo fijan los defaults del esquema.
 */
const createPropertySchema = z.strictObject({
  propertyTypeId: z.number().int().positive().nullish(),
  locale: localeSchema.optional(),
  title: z.string().max(200).optional(),
});

export function handleCreateProperty(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const body = await readJsonBody(ctx.request, { allowEmpty: true });
    if (!body.ok) return body.response;

    const parsed = createPropertySchema.safeParse(body.value);
    if (!parsed.success) {
      return jsonError('validation_failed', 'Datos de creacion invalidos.', 422, {
        field: parsed.error.issues[0]?.path.join('.') ?? undefined,
      });
    }

    const input = {
      ...(parsed.data.propertyTypeId !== undefined
        ? { propertyTypeId: parsed.data.propertyTypeId }
        : {}),
      ...(parsed.data.locale !== undefined ? { locale: parsed.data.locale } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    };

    return jsonFromResult(await createPropertyDraft(ctx.db, input), 201);
  });
}

/* -------------------------------------------------------------------------- */
/* /api/admin/properties/:id                                                  */
/* -------------------------------------------------------------------------- */

export function handleGetProperty(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    return jsonFromResult(await getPropertyForEdit(ctx.db, id));
  });
}

export function handleUpdateProperty(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    // El esquema estricto de la Fase 2B rechaza los campos no editables
    // (publicationStatus, id, createdAt, publishedAt); no se repite aqui.
    return jsonFromResult(await updateProperty(ctx.db, id, body.value as never));
  });
}

/* -------------------------------------------------------------------------- */
/* /api/admin/properties/:id/translations/:locale                             */
/* -------------------------------------------------------------------------- */

const translationBodySchema = z.strictObject({
  slug: z.string().nullish(),
  title: z.string().nullish(),
  marketingDescription: z.string().nullish(),
  technicalDescription: z.string().nullish(),
});

export function handleUpsertTranslation(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    const locale = localeSchema.safeParse(ctx.params.locale);
    if (!locale.success) {
      return jsonError('validation_failed', 'Idioma no soportado.', 422, { field: 'locale' });
    }

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = translationBodySchema.safeParse(body.value);
    if (!parsed.success) {
      return jsonError('validation_failed', 'Datos de traduccion invalidos.', 422, {
        field: parsed.error.issues[0]?.path.join('.') ?? undefined,
      });
    }

    return jsonFromResult(
      await upsertPropertyTranslation(ctx.db, id, { ...parsed.data, locale: locale.data }),
    );
  });
}

/* -------------------------------------------------------------------------- */
/* /api/admin/properties/:id/status                                           */
/* -------------------------------------------------------------------------- */

/** Solo el estado EDITORIAL. El comercial se cambia con PATCH normal. */
const statusBodySchema = z.strictObject({
  publicationStatus: publicationStatusSchema,
});

export function handleUpdateStatus(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = statusBodySchema.safeParse(body.value);
    if (!parsed.success) {
      return jsonError('validation_failed', 'Estado de publicacion invalido.', 422, {
        field: 'publicationStatus',
      });
    }

    // `updatePropertyStatus` es quien decide que transiciones existen; llegar
    // a `published` sigue prohibido mientras la publicacion real no exista.
    return jsonFromResult(await updatePropertyStatus(ctx.db, id, parsed.data.publicationStatus));
  });
}

/* -------------------------------------------------------------------------- */
/* /api/admin/properties/:id/archive                                          */
/* -------------------------------------------------------------------------- */

export function handleArchiveProperty(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    /*
     * Sin cuerpo obligatorio. Archivar algo ya archivado devuelve 200 con la
     * fila sin cambios: es la conducta que ya tenia `updatePropertyStatus`.
     *
     * Nota para quien consuma la API: aunque este handler no necesita cuerpo,
     * Astro protege por su cuenta las peticiones que modifican datos y
     * rechaza un POST sin `content-type` tratandolo como envio de formulario
     * cross-site. Envia siempre `content-type: application/json` (con `{}`
     * como cuerpo si no hay nada que mandar).
     */
    return jsonFromResult(await archiveProperty(ctx.db, id));
  });
}

/* -------------------------------------------------------------------------- */
/* /api/admin/property-types                                                  */
/* -------------------------------------------------------------------------- */

export function handleListPropertyTypes(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => jsonSuccess(await listActivePropertyTypes(ctx.db)));
}

const createPropertyTypeSchema = z.strictObject({
  nameEs: z.string(),
  nameEn: z.string().nullish(),
});

export function handleCreatePropertyType(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const body = await readJsonBody(ctx.request);
    if (!body.ok) return body.response;

    const parsed = createPropertyTypeSchema.safeParse(body.value);
    if (!parsed.success) {
      return jsonError('validation_failed', 'Datos del tipo invalidos.', 422, {
        field: parsed.error.issues[0]?.path.join('.') ?? undefined,
      });
    }

    return jsonFromResult(
      await createCustomPropertyType(ctx.db, {
        nameEs: parsed.data.nameEs,
        ...(parsed.data.nameEn !== undefined && parsed.data.nameEn !== null
          ? { nameEn: parsed.data.nameEn }
          : {}),
      }),
      201,
    );
  });
}
