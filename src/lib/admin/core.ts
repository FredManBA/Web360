import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { properties, media, siteSettings, contacts } from '../../db/schema';
import { propertyInput, settingsInput, mediaPatch, tourInput, youtubeInput } from './validation';
import {
  fail,
  fromZodError,
  isUniqueViolation,
  ok,
  type AdminBatchDatabase,
  type AdminDatabase,
  type AdminResult,
  type FieldIssue,
} from './types';
import { validatePrice } from '../domain/money';
import { isValidSlug } from '../domain/slug';
import { checkUpload, buildObjectKey } from '../domain/media-upload';
import { removeTourNode, tourUsesMedia } from '../domain/tour';
import type { MediaBucket } from './media/bucket';

export const listProperties = (db: AdminDatabase) =>
  db.select().from(properties).orderBy(desc(properties.updatedAt), desc(properties.id));
export const getProperty = async (db: AdminDatabase, id: number) =>
  (await db.select().from(properties).where(eq(properties.id, id)).limit(1))[0];
export const propertyMedia = (db: AdminDatabase, id: number) =>
  db
    .select()
    .from(media)
    .where(eq(media.propertyId, id))
    .orderBy(asc(media.sortOrder), asc(media.id));
export const getSettings = async (db: AdminDatabase) =>
  (await db.select().from(siteSettings).where(eq(siteSettings.id, 1)).limit(1))[0];

export async function createProperty(db: AdminDatabase) {
  const settings = await getSettings(db);
  for (let attempt = 0; attempt < 5; attempt++) {
    const codes = await db.select({ code: properties.code }).from(properties);
    const next =
      1 +
      Math.max(
        0,
        ...codes
          .map((p) => /^CR360-(\d+)$/.exec(p.code)?.[1])
          .map((n) => (n === undefined ? 0 : Number(n))),
      );
    try {
      return ok(
        (
          await db
            .insert(properties)
            .values({
              code: `CR360-${String(next).padStart(3, '0')}`,
              currencyCode: settings?.defaultCurrencyCode ?? 'USD',
            })
            .returning()
        )[0]!,
      );
    } catch (error) {
      if (!isUniqueViolation(error, 'properties.code')) throw error;
    }
  }
  return fail({
    code: 'code_generation_failed',
    message: 'No se pudo asignar el código. Vuelve a intentarlo.',
  });
}

export function publicationIssues(
  p: typeof properties.$inferSelect,
  files: (typeof media.$inferSelect)[],
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const need = (condition: boolean, path: string, message: string) => {
    if (!condition) issues.push({ path, message });
  };
  need(!!p.type, 'type', 'Elige el tipo de propiedad.');
  need(!!p.titleEs?.trim(), 'titleEs', 'Falta el título en español.');
  need(!!p.slugEs && isValidSlug(p.slugEs), 'slugEs', 'Falta un slug válido en español.');
  need(
    validatePrice(p).length === 0,
    'priceAmountMinor',
    'Completa un precio y una moneda coherentes con el modo elegido.',
  );
  need(
    p.areaSquareMeters !== null && p.areaSquareMeters > 0,
    'areaSquareMeters',
    'La superficie debe ser mayor que cero.',
  );
  need(
    p.mapLatitude !== null &&
      p.mapLongitude !== null &&
      Math.abs(p.mapLatitude) <= 90 &&
      Math.abs(p.mapLongitude) <= 180,
    'mapLatitude',
    'Indica una latitud y longitud válidas.',
  );
  need(
    files.some((m) => m.kind === 'image'),
    'media',
    'Sube al menos una imagen.',
  );
  need(
    files.some((m) => m.kind === 'image' && m.isCover),
    'media',
    'Elige una imagen de portada.',
  );
  return issues;
}

export async function saveProperty(db: AdminDatabase, id: number, input: unknown) {
  const parsed = propertyInput.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const property = await getProperty(db, id);
  if (!property) return fail({ code: 'not_found', message: 'La propiedad no existe.' });
  if (property.status === 'published') {
    const issues = publicationIssues({ ...property, ...parsed.data }, await propertyMedia(db, id));
    if (issues.length)
      return fail({
        code: 'publication_incomplete',
        message:
          'No se puede guardar: la propiedad publicada debe conservar los mínimos de publicación.',
        issues,
      });
  }
  try {
    // ES, EN y características forman parte del mismo UPDATE atómico. El tour se conserva.
    const [row] = await db
      .update(properties)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(properties.id, id))
      .returning();
    return ok(row!);
  } catch (error) {
    if (isUniqueViolation(error))
      return fail({ code: 'slug_taken', message: 'Ese slug ya pertenece a otra propiedad.' });
    throw error;
  }
}

/**
 * Guarda el recorrido completo en una sola escritura.
 *
 * El tour no es un mínimo de publicación: una propiedad publicada puede
 * cambiarlo o quitarlo sin tocar su estado, y el cambio se ve en público al
 * instante porque el sitio lee D1 en cada visita.
 */
export async function saveTour(db: AdminDatabase, id: number, input: unknown) {
  const parsed = tourInput.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  if (!(await getProperty(db, id)))
    return fail({ code: 'not_found', message: 'La propiedad no existe.' });
  const tour = parsed.data.tour;
  if (tour) {
    // La base no puede garantizar que el panorama sea de ESTA propiedad.
    const panoramas = new Set(
      (await propertyMedia(db, id)).filter((m) => m.kind === 'panorama').map((m) => m.id),
    );
    if (tour.nodes.some((node) => !panoramas.has(node.mediaId)))
      return fail({
        code: 'validation_failed',
        message: 'El recorrido solo admite panoramas de esta propiedad.',
        field: 'nodes',
      });
  }
  const [row] = await db
    .update(properties)
    .set({ tourJson: tour, updatedAt: new Date() })
    .where(eq(properties.id, id))
    .returning();
  return ok(row!.tourJson ?? null);
}

export async function setPublication(db: AdminDatabase, id: number, publish: boolean) {
  const property = await getProperty(db, id);
  if (!property) return fail({ code: 'not_found', message: 'La propiedad no existe.' });
  if (publish) {
    const issues = publicationIssues(property, await propertyMedia(db, id));
    if (issues.length)
      return fail({
        code: 'publication_incomplete',
        message: 'Completa los datos para publicar.',
        issues,
      });
  }
  const [row] = await db
    .update(properties)
    .set({
      status: publish ? 'published' : 'draft',
      publishedAt: publish ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(properties.id, id))
    .returning();
  return ok(row!);
}

export async function saveSettings(db: AdminDatabase, input: unknown) {
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const data = { ...parsed.data, updatedAt: new Date() };
  return ok(
    (
      await db
        .insert(siteSettings)
        .values({ id: 1, ...data })
        .onConflictDoUpdate({ target: siteSettings.id, set: data })
        .returning()
    )[0]!,
  );
}

export async function addYoutube(db: AdminDatabase, id: number, input: unknown) {
  const parsed = youtubeInput.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  if (!(await getProperty(db, id)))
    return fail({ code: 'not_found', message: 'La propiedad no existe.' });
  return ok(
    (
      await db
        .insert(media)
        .values({ propertyId: id, ...parsed.data, sortOrder: await nextMediaOrder(db, id) })
        .returning()
    )[0]!,
  );
}
async function nextMediaOrder(db: AdminDatabase, id: number) {
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(${media.sortOrder}), -1) + 1` })
    .from(media)
    .where(eq(media.propertyId, id));
  return row?.n ?? 0;
}

export async function uploadMedia(
  db: AdminDatabase,
  bucket: MediaBucket,
  id: number,
  kind: 'image' | 'panorama',
  file: File,
) {
  if (!(await getProperty(db, id)))
    return fail({ code: 'not_found', message: 'La propiedad no existe.' });
  const bytes = await file.arrayBuffer();
  const check = checkUpload({
    mediaKind: kind,
    bytes: new Uint8Array(bytes),
    declaredMimeType: file.type,
  });
  if (check.problems.length || !check.detectedMimeType)
    return fail({
      code: 'media_upload_rejected',
      message: 'Archivo inválido: usa JPG, PNG o WebP y respeta el tamaño máximo.',
    });
  const objectKey = buildObjectKey(id, kind, check.detectedMimeType, crypto.randomUUID());
  await bucket.put(objectKey, bytes, { httpMetadata: { contentType: check.detectedMimeType } });
  // No se borra ningún objeto R2 durante R2, tampoco al retirar una fila del modelo.
  return ok(
    (
      await db
        .insert(media)
        .values({
          propertyId: id,
          kind,
          objectKey,
          mimeType: check.detectedMimeType,
          fileSizeBytes: bytes.byteLength,
          sortOrder: await nextMediaOrder(db, id),
        })
        .returning()
    )[0]!,
  );
}

export async function changeMedia(
  db: AdminBatchDatabase,
  id: number,
  mediaId: number,
  input: unknown,
): Promise<AdminResult<unknown>> {
  const parsed = mediaPatch.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.propertyId, id)))
    .limit(1);
  if (!row) return fail({ code: 'not_found', message: 'El archivo no existe.' });
  if (parsed.data.isCover && row.kind !== 'image')
    return fail({ code: 'validation_failed', message: 'La portada debe ser una imagen.' });
  const update = db
    .update(media)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(media.id, mediaId), eq(media.propertyId, id)));
  if (parsed.data.isCover)
    await db.batch([
      db.update(media).set({ isCover: false }).where(eq(media.propertyId, id)),
      update,
    ]);
  else await update;
  return ok((await propertyMedia(db, id)).find((m) => m.id === mediaId));
}

export async function removeMedia(db: AdminBatchDatabase, id: number, mediaId: number) {
  const property = await getProperty(db, id);
  if (!property) return fail({ code: 'not_found', message: 'La propiedad no existe.' });
  const file = (await propertyMedia(db, id)).find((row) => row.id === mediaId);
  if (!file) return fail({ code: 'not_found', message: 'El archivo no existe.' });
  if (property.status === 'published' && file.isCover)
    return fail({
      code: 'media_in_use',
      message:
        'Primero elige otra portada antes de eliminar la portada de una propiedad publicada.',
    });
  const remove = db.delete(media).where(and(eq(media.id, mediaId), eq(media.propertyId, id)));
  // El recorrido se limpia en la misma transacción: nunca queda apuntando a un panorama borrado.
  if (tourUsesMedia(property.tourJson ?? null, mediaId))
    await db.batch([
      db
        .update(properties)
        .set({
          tourJson: removeTourNode(property.tourJson ?? null, mediaId),
          updatedAt: new Date(),
        })
        .where(eq(properties.id, id)),
      remove,
    ]);
  else await remove;
  return ok({ deleted: true });
}

export const listContacts = (db: AdminDatabase) =>
  db
    .select({
      id: contacts.id,
      propertyCode: properties.code,
      name: contacts.name,
      preferredContactMethod: contacts.preferredContactMethod,
      contactValue: contacts.contactValue,
      message: contacts.message,
      locale: contacts.locale,
      status: contacts.status,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .leftJoin(properties, eq(contacts.propertyId, properties.id))
    .orderBy(desc(contacts.createdAt), desc(contacts.id));
