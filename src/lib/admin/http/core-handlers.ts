import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { JWTVerifyGetKey } from 'jose';
import { media, contacts } from '../../../db/schema';
import type { AdminBatchDatabase } from '../types';
import { fromZodError } from '../types';
import type { MediaBucket } from '../media/bucket';
import {
  addYoutube,
  changeMedia,
  createProperty,
  getProperty,
  getSettings,
  listContacts,
  listProperties,
  propertyMedia,
  removeMedia,
  saveProperty,
  saveSettings,
  saveTour,
  setPublication,
  uploadMedia,
} from '../core';
import {
  parseRouteId,
  readJsonBody,
  readMultipartForm,
  requireAdminAccess,
  requireSameOrigin,
  type AdminHttpEnv,
} from './guard';
import { jsonError, jsonFromResult, jsonInternalError, jsonSuccess } from './responses';
import { changeSiteImage } from '../settings/site-media';
import { isSiteMediaSlot, SITE_MEDIA_RULES } from '../../domain/site-media';
import { MEDIA_SIZE_LIMITS } from '../../domain/media-upload';

export interface AdminHttpContext {
  request: Request;
  params: Record<string, string | undefined>;
  db: AdminBatchDatabase;
  bucket: MediaBucket;
  env: AdminHttpEnv;
  accessKeyResolver?: JWTVerifyGetKey;
}
const notFound = () => jsonError('not_found', 'No existe ese recurso.', 404);
const methodNotAllowed = () => jsonError('validation_failed', 'Método no permitido.', 405);

/** Una entrada HTTP; las operaciones y validaciones permanecen en funciones concretas. */
export async function handleAdmin(ctx: AdminHttpContext): Promise<Response> {
  try {
    const auth = await requireAdminAccess(
      ctx.request,
      ctx.env,
      ctx.accessKeyResolver ? { keyResolver: ctx.accessKeyResolver } : {},
    );
    if (auth.denied) return auth.denied;
    const crossOrigin = requireSameOrigin(ctx.request);
    if (crossOrigin) return crossOrigin;
    const { request, db, bucket } = ctx;
    const path = (ctx.params.path ?? '').replace(/\/$/, '');
    const method = request.method;
    if (path === 'properties') {
      if (method === 'GET') return jsonSuccess(await listProperties(db));
      if (method === 'POST') {
        const body = await readJsonBody(request, { allowEmpty: true });
        if (!body.ok) return body.response;
        const empty = z.strictObject({}).safeParse(body.value);
        if (!empty.success) return jsonFromResult(fromZodError(empty.error));
        return jsonFromResult(await createProperty(db), 201);
      }
      return methodNotAllowed();
    }
    const property =
      /^properties\/([^/]+)(?:\/(publish|unpublish|media|tour)(?:\/([^/]+)(?:\/(file))?)?)?$/.exec(
        path,
      );
    if (property) {
      const id = parseRouteId(property[1]);
      if (id === null) return jsonError('validation_failed', 'Identificador inválido.', 422);
      const action = property[2];
      const mediaId = property[3] === undefined ? null : parseRouteId(property[3]);
      if (property[3] !== undefined && mediaId === null)
        return jsonError('validation_failed', 'Identificador inválido.', 422);
      if (!action) {
        if (method === 'GET') {
          const row = await getProperty(db, id);
          return row
            ? jsonSuccess({ property: row, media: await propertyMedia(db, id) })
            : notFound();
        }
        if (method === 'PUT') {
          const body = await readJsonBody(request);
          return body.ok ? jsonFromResult(await saveProperty(db, id, body.value)) : body.response;
        }
        return methodNotAllowed();
      }
      if (action === 'tour') {
        if (mediaId !== null) return notFound();
        if (method !== 'PUT') return methodNotAllowed();
        const body = await readJsonBody(request);
        return body.ok ? jsonFromResult(await saveTour(db, id, body.value)) : body.response;
      }
      if (action === 'publish' || action === 'unpublish') {
        if (mediaId !== null) return notFound();
        if (method !== 'POST') return methodNotAllowed();
        return jsonFromResult(await setPublication(db, id, action === 'publish'));
      }
      if (property[4] === 'file') {
        if (method !== 'GET') return methodNotAllowed();
        const [row] = await db
          .select()
          .from(media)
          .where(and(eq(media.id, mediaId!), eq(media.propertyId, id)))
          .limit(1);
        const object = row?.objectKey ? await bucket.get(row.objectKey) : null;
        return object?.body
          ? new Response(object.body, {
              headers: {
                'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
                'cache-control': 'no-store',
                'x-content-type-options': 'nosniff',
              },
            })
          : notFound();
      }
      if (mediaId !== null) {
        if (method === 'DELETE') return jsonFromResult(await removeMedia(db, id, mediaId));
        if (method === 'PATCH') {
          const body = await readJsonBody(request);
          return body.ok
            ? jsonFromResult(await changeMedia(db, id, mediaId, body.value))
            : body.response;
        }
        return methodNotAllowed();
      }
      if (method !== 'POST') return methodNotAllowed();
      if (request.headers.get('content-type')?.includes('application/json')) {
        const body = await readJsonBody(request);
        return body.ok ? jsonFromResult(await addYoutube(db, id, body.value), 201) : body.response;
      }
      if (Number(request.headers.get('content-length')) > 32 * 1024 * 1024)
        return jsonError('media_upload_rejected', 'Archivo demasiado grande.', 413);
      const multipart = await readMultipartForm(request);
      if (!multipart.ok) return multipart.response;
      const kind = multipart.form.get('kind');
      const file = multipart.form.get('file');
      if ((kind !== 'image' && kind !== 'panorama') || !(file instanceof File))
        return jsonError('validation_failed', 'Elige una imagen o panorama.', 422);
      if (file.size > MEDIA_SIZE_LIMITS[kind])
        return jsonError('media_upload_rejected', 'Archivo demasiado grande.', 413);
      return jsonFromResult(await uploadMedia(db, bucket, id, kind, file), 201);
    }
    if (path === 'settings') {
      if (method === 'GET') return jsonSuccess(await getSettings(db));
      if (method === 'PUT') {
        const body = await readJsonBody(request);
        return body.ok ? jsonFromResult(await saveSettings(db, body.value)) : body.response;
      }
      return methodNotAllowed();
    }
    const image = /^settings\/media\/([^/]+)$/.exec(path);
    if (image) {
      const slot = image[1]!;
      if (!isSiteMediaSlot(slot)) return notFound();
      if (method === 'DELETE') return jsonFromResult(await changeSiteImage(db, bucket, slot, null));
      if (method !== 'PUT') return methodNotAllowed();
      // El limite es el del hueco, mas un margen para el envoltorio multipart.
      if (
        Number(request.headers.get('content-length')) >
        SITE_MEDIA_RULES[slot].maxBytes + 1024 * 1024
      )
        return jsonError('media_upload_rejected', 'Archivo demasiado grande.', 413);
      const form = await readMultipartForm(request);
      if (!form.ok) return form.response;
      const file = form.form.get('file');
      if (!(file instanceof File)) return jsonError('validation_failed', 'Falta el archivo.', 422);
      return jsonFromResult(await changeSiteImage(db, bucket, slot, file));
    }
    if (path === 'contacts')
      return method === 'GET' ? jsonSuccess(await listContacts(db)) : methodNotAllowed();
    const contact = /^contacts\/([^/]+)$/.exec(path);
    if (contact) {
      const id = parseRouteId(contact[1]);
      if (id === null) return jsonError('validation_failed', 'Identificador inválido.', 422);
      if (method !== 'PATCH') return methodNotAllowed();
      const body = await readJsonBody(request);
      if (!body.ok) return body.response;
      const parsed = z.strictObject({ status: z.enum(['new', 'reviewed']) }).safeParse(body.value);
      if (!parsed.success) return jsonFromResult(fromZodError(parsed.error));
      const [row] = await db
        .update(contacts)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(contacts.id, id))
        .returning();
      return row ? jsonSuccess(row) : notFound();
    }
    return notFound();
  } catch (error) {
    return jsonInternalError(error);
  }
}
