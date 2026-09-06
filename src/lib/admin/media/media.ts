/**
 * Registro de archivos multimedia.
 *
 * Esta capa NO sube bytes ni habla con R2: solo escribe metadatos. La clave
 * del objeto llega ya conocida y no se comprueba que exista fisicamente,
 * porque el almacenamiento todavia no forma parte del producto.
 *
 * Dos reglas que la base no puede garantizar sola y que se validan aqui para
 * poder devolver un error comprensible en vez de una violacion de constraint:
 *
 * - un archivo solo puede agruparse en un grupo de SU MISMA propiedad;
 * - proveedor y tipo tienen que ser coherentes (no hay panoramas de YouTube).
 *
 * Los roles (hero y portada) se cambian en lote, para que no exista ningun
 * instante con dos heroes ni con ninguno.
 */

import { and, eq, isNull, ne } from 'drizzle-orm';

import {
  properties,
  propertyMedia,
  propertyMediaTranslations,
  propertyTourNodes,
} from '../../../db/schema';
import { validateMediaGroup } from '../../domain/consistency';
import { canBeCatalogCover, canBeHero, validateMediaSource } from '../../domain/media';
import type { Locale, MediaKind, SourceProvider } from '../../domain/vocabularies';
import { nextSortOrder, normalizeText } from '../shared';
import {
  fail,
  isUniqueViolation,
  ok,
  type AdminBatchDatabase,
  type AdminBatchItem,
  type AdminDatabase,
  type AdminResult,
} from '../types';
import { loadMediaGroup } from './media-groups';

/* -------------------------------------------------------------------------- */
/* Formas de entrada                                                          */
/* -------------------------------------------------------------------------- */

/** Textos por idioma. El vacio se guarda como `null`. */
export interface MediaTexts {
  titleEs?: string | null;
  altTextEs?: string | null;
  captionEs?: string | null;
  titleEn?: string | null;
  altTextEn?: string | null;
  captionEn?: string | null;
}

/** Metadatos tecnicos que la ficha puede llevar. */
export interface MediaMetadata {
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}

export interface CreateMediaInput extends MediaTexts, MediaMetadata {
  groupId?: number | null;
  mediaKind: MediaKind;
  sourceProvider: SourceProvider;
  objectKey?: string | null;
  youtubeVideoId?: string | null;
  sortOrder?: number;
}

/**
 * Campos editables.
 *
 * `propertyId`, `mediaKind` y `sourceProvider` NO se pueden cambiar: el tipo
 * decide que roles admite y si el archivo puede usarse en el recorrido 360,
 * asi que cambiarlo invalidaria en silencio cosas que dependen de el. Para
 * eso se registra otro archivo y se borra este.
 */
export interface UpdateMediaInput extends MediaTexts, MediaMetadata {
  groupId?: number | null;
  objectKey?: string | null;
  youtubeVideoId?: string | null;
  sortOrder?: number;
  isHero?: boolean;
  isCatalogCover?: boolean;
}

export interface MediaRecord {
  id: number;
  propertyId: number;
  groupId: number | null;
  mediaKind: MediaKind;
  sourceProvider: SourceProvider;
  sortOrder: number;
  isHero: boolean;
  isCatalogCover: boolean;
}

function toRecord(row: typeof propertyMedia.$inferSelect): MediaRecord {
  return {
    id: row.id,
    propertyId: row.propertyId,
    groupId: row.propertyMediaGroupId,
    mediaKind: row.mediaKind,
    sourceProvider: row.sourceProvider,
    sortOrder: row.sortOrder,
    isHero: row.isHero,
    isCatalogCover: row.isCatalogCover,
  };
}

/* -------------------------------------------------------------------------- */
/* Validaciones compartidas                                                   */
/* -------------------------------------------------------------------------- */

const SOURCE_MESSAGES: Record<string, string> = {
  object_key_required: 'Falta la clave del objeto en R2.',
  object_key_not_allowed: 'Un archivo de YouTube no lleva clave de R2.',
  youtube_id_required: 'Falta el identificador del vídeo de YouTube.',
  youtube_id_not_allowed: 'Un archivo de R2 no lleva identificador de YouTube.',
  youtube_id_invalid: 'El identificador del vídeo de YouTube no tiene un formato válido.',
  youtube_only_video: 'YouTube solo puede usarse para vídeos.',
};

function sourceFailure<T>(problem: string): AdminResult<T> {
  return fail({
    code: 'media_invalid_provider',
    message: SOURCE_MESSAGES[problem] ?? 'La combinación de proveedor y tipo no es válida.',
    field: 'sourceProvider',
  });
}

/**
 * Comprueba que el grupo elegido sea de la misma propiedad.
 *
 * `null` significa "sin grupo" y siempre es valido.
 */
async function checkGroupOwnership(
  db: AdminDatabase,
  propertyId: number,
  groupId: number | null,
): Promise<AdminResult<null>> {
  if (groupId === null) return ok(null);

  const found = await loadMediaGroup(db, propertyId, groupId);
  if (!found.ok) return found;

  // Comprobacion de dominio, ademas de la consulta anterior.
  const problems = validateMediaGroup(
    { propertyId, groupId },
    { propertyId: found.data.propertyId },
  );
  if (problems.length > 0) {
    return fail({
      code: 'media_group_property_mismatch',
      message: 'El grupo multimedia pertenece a otra propiedad.',
      field: 'groupId',
    });
  }

  return ok(null);
}

/**
 * El archivo debe existir Y ser de esta propiedad.
 *
 * Se exporta porque el borrado coordinado necesita conocer la clave del objeto
 * ANTES de que la fila desaparezca.
 */
export async function loadMediaRow(
  db: AdminDatabase,
  propertyId: number,
  mediaId: number,
): Promise<AdminResult<typeof propertyMedia.$inferSelect>> {
  const rows = await db.select().from(propertyMedia).where(eq(propertyMedia.id, mediaId)).limit(1);

  const media = rows[0];
  if (media === undefined || media.propertyId !== propertyId) {
    return fail({ code: 'media_not_found', message: 'El archivo no existe.', field: 'mediaId' });
  }

  return ok(media);
}

/** Escribe los textos que vengan, normalizando el vacio a `null`. */
async function writeMediaTexts(
  db: AdminDatabase,
  mediaId: number,
  input: MediaTexts,
): Promise<void> {
  type Texts = { title?: string | null; altText?: string | null; caption?: string | null };

  const byLocale: [Locale, Texts][] = [];

  const es: Texts = {};
  if (input.titleEs !== undefined) es.title = normalizeText(input.titleEs);
  if (input.altTextEs !== undefined) es.altText = normalizeText(input.altTextEs);
  if (input.captionEs !== undefined) es.caption = normalizeText(input.captionEs);
  if (Object.keys(es).length > 0) byLocale.push(['es', es]);

  const en: Texts = {};
  if (input.titleEn !== undefined) en.title = normalizeText(input.titleEn);
  if (input.altTextEn !== undefined) en.altText = normalizeText(input.altTextEn);
  if (input.captionEn !== undefined) en.caption = normalizeText(input.captionEn);
  if (Object.keys(en).length > 0) byLocale.push(['en', en]);

  for (const [locale, texts] of byLocale) {
    const existing = await db
      .select({ id: propertyMediaTranslations.id })
      .from(propertyMediaTranslations)
      .where(
        and(
          eq(propertyMediaTranslations.propertyMediaId, mediaId),
          eq(propertyMediaTranslations.locale, locale),
        ),
      )
      .limit(1);

    const row = existing[0];

    if (row === undefined) {
      await db.insert(propertyMediaTranslations).values({
        propertyMediaId: mediaId,
        locale,
        title: texts.title ?? null,
        altText: texts.altText ?? null,
        caption: texts.caption ?? null,
      });
    } else {
      await db
        .update(propertyMediaTranslations)
        .set({ ...texts, updatedAt: new Date() })
        .where(eq(propertyMediaTranslations.id, row.id));
    }
  }
}

/**
 * Posicion siguiente dentro del grupo, o del conjunto sin grupo.
 *
 * Mismo criterio que en caracteristicas: el orden es relativo al sitio donde
 * se ve el archivo, no a toda la propiedad.
 */
async function nextMediaSortOrder(
  db: AdminDatabase,
  propertyId: number,
  groupId: number | null,
): Promise<number> {
  const scope =
    groupId === null
      ? and(eq(propertyMedia.propertyId, propertyId), isNull(propertyMedia.propertyMediaGroupId))
      : and(
          eq(propertyMedia.propertyId, propertyId),
          eq(propertyMedia.propertyMediaGroupId, groupId),
        );

  const siblings = await db
    .select({ sortOrder: propertyMedia.sortOrder })
    .from(propertyMedia)
    .where(scope);

  return nextSortOrder(siblings.map((row) => row.sortOrder));
}

/* -------------------------------------------------------------------------- */
/* Crear                                                                      */
/* -------------------------------------------------------------------------- */

export async function createMedia(
  db: AdminDatabase,
  propertyId: number,
  input: CreateMediaInput,
): Promise<AdminResult<MediaRecord>> {
  const owner = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  if (owner.length === 0) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const objectKey = normalizeText(input.objectKey);
  const youtubeVideoId = normalizeText(input.youtubeVideoId);

  const problems = validateMediaSource({
    mediaKind: input.mediaKind,
    sourceProvider: input.sourceProvider,
    objectKey,
    youtubeVideoId,
  });

  const firstProblem = problems[0];
  if (firstProblem !== undefined) return sourceFailure(firstProblem);

  const groupId = input.groupId ?? null;

  const ownership = await checkGroupOwnership(db, propertyId, groupId);
  if (!ownership.ok) return ownership;

  const sortOrder = input.sortOrder ?? (await nextMediaSortOrder(db, propertyId, groupId));

  /*
   * Los roles no se asignan al crear: necesitan retirar el anterior en el
   * mismo lote, y para eso la fila tiene que existir. Se piden despues con
   * `setMediaRoles`.
   */
  let inserted: (typeof propertyMedia.$inferSelect)[];

  try {
    inserted = await db
      .insert(propertyMedia)
      .values({
        propertyId,
        propertyMediaGroupId: groupId,
        mediaKind: input.mediaKind,
        sourceProvider: input.sourceProvider,
        objectKey,
        youtubeVideoId,
        mimeType: normalizeText(input.mimeType),
        fileSizeBytes: input.fileSizeBytes ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        durationSeconds: input.durationSeconds ?? null,
        sortOrder,
      })
      .returning();
  } catch (error) {
    // La clave de R2 es unica en toda la tabla, no solo dentro de la propiedad.
    if (isUniqueViolation(error, 'object_key')) {
      return fail({
        code: 'media_object_key_taken',
        message: 'Ya hay un archivo registrado con esa clave.',
        field: 'objectKey',
      });
    }
    throw error;
  }

  const media = inserted[0];
  if (media === undefined) {
    return fail({ code: 'validation_failed', message: 'No se pudo registrar el archivo.' });
  }

  await writeMediaTexts(db, media.id, input);

  return ok(toRecord(media));
}

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

export interface MediaRolesInput {
  isHero?: boolean;
  isCatalogCover?: boolean;
}

/**
 * Sentencias que cambian los roles, en el orden en que deben ejecutarse.
 *
 * Primero se retira el rol a quien lo tuviera y despues se le da al nuevo:
 * los indices parciales del esquema solo admiten una fila con cada rol por
 * propiedad, asi que el orden inverso chocaria. Van todas en el mismo lote,
 * que D1 envuelve en una transaccion.
 */
function roleStatements(
  db: AdminBatchDatabase,
  propertyId: number,
  mediaId: number,
  roles: MediaRolesInput,
): AdminBatchItem[] {
  const statements: AdminBatchItem[] = [];
  const now = new Date();

  if (roles.isHero === true) {
    statements.push(
      db
        .update(propertyMedia)
        .set({ isHero: false, updatedAt: now })
        .where(
          and(
            eq(propertyMedia.propertyId, propertyId),
            eq(propertyMedia.isHero, true),
            ne(propertyMedia.id, mediaId),
          ),
        ),
    );
  }

  if (roles.isCatalogCover === true) {
    statements.push(
      db
        .update(propertyMedia)
        .set({ isCatalogCover: false, updatedAt: now })
        .where(
          and(
            eq(propertyMedia.propertyId, propertyId),
            eq(propertyMedia.isCatalogCover, true),
            ne(propertyMedia.id, mediaId),
          ),
        ),
    );
  }

  statements.push(
    db
      .update(propertyMedia)
      .set({
        ...(roles.isHero === undefined ? {} : { isHero: roles.isHero }),
        ...(roles.isCatalogCover === undefined ? {} : { isCatalogCover: roles.isCatalogCover }),
        updatedAt: now,
      })
      .where(and(eq(propertyMedia.id, mediaId), eq(propertyMedia.propertyId, propertyId))),
  );

  return statements;
}

/** El tipo debe admitir el rol que se pide. */
function checkRoleKind<T>(kind: MediaKind, roles: MediaRolesInput): AdminResult<T> | null {
  if (roles.isHero === true && !canBeHero(kind)) {
    return fail({
      code: 'media_role_conflict',
      message: 'Solo una imagen o un vídeo pueden encabezar la ficha.',
      field: 'isHero',
    });
  }

  if (roles.isCatalogCover === true && !canBeCatalogCover(kind)) {
    return fail({
      code: 'media_role_conflict',
      message: 'La portada del catálogo solo puede ser una imagen.',
      field: 'isCatalogCover',
    });
  }

  return null;
}

/**
 * Cambia hero y portada en una sola operacion.
 *
 * Existe para que la UI no tenga que hacer dos PATCH (retirar el anterior y
 * marcar el nuevo) y quedarse a medias si el segundo falla.
 */
export async function setMediaRoles(
  db: AdminBatchDatabase,
  propertyId: number,
  mediaId: number,
  roles: MediaRolesInput,
): Promise<AdminResult<MediaRecord>> {
  const found = await loadMediaRow(db, propertyId, mediaId);
  if (!found.ok) return found;

  const conflict = checkRoleKind<MediaRecord>(found.data.mediaKind, roles);
  if (conflict !== null) return conflict;

  if (roles.isHero === undefined && roles.isCatalogCover === undefined) {
    return ok(toRecord(found.data));
  }

  const [first, ...rest] = roleStatements(db, propertyId, mediaId, roles);
  if (first !== undefined) await db.batch([first, ...rest]);

  const refreshed = await loadMediaRow(db, propertyId, mediaId);
  if (!refreshed.ok) return refreshed;

  return ok(toRecord(refreshed.data));
}

/* -------------------------------------------------------------------------- */
/* Actualizar                                                                 */
/* -------------------------------------------------------------------------- */

export async function updateMedia(
  db: AdminBatchDatabase,
  propertyId: number,
  mediaId: number,
  input: UpdateMediaInput,
): Promise<AdminResult<MediaRecord>> {
  const found = await loadMediaRow(db, propertyId, mediaId);
  if (!found.ok) return found;

  const current = found.data;

  // La fuente se revalida con los valores ya mezclados, no solo con lo nuevo.
  if (input.objectKey !== undefined || input.youtubeVideoId !== undefined) {
    const problems = validateMediaSource({
      mediaKind: current.mediaKind,
      sourceProvider: current.sourceProvider,
      objectKey: input.objectKey === undefined ? current.objectKey : normalizeText(input.objectKey),
      youtubeVideoId:
        input.youtubeVideoId === undefined
          ? current.youtubeVideoId
          : normalizeText(input.youtubeVideoId),
    });

    const firstProblem = problems[0];
    if (firstProblem !== undefined) return sourceFailure(firstProblem);
  }

  const roleConflict = checkRoleKind<MediaRecord>(current.mediaKind, input);
  if (roleConflict !== null) return roleConflict;

  const patch: Record<string, unknown> = {};

  if (input.groupId !== undefined) {
    const ownership = await checkGroupOwnership(db, propertyId, input.groupId);
    if (!ownership.ok) return ownership;

    patch.propertyMediaGroupId = input.groupId;
  }

  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.objectKey !== undefined) patch.objectKey = normalizeText(input.objectKey);
  if (input.youtubeVideoId !== undefined) {
    patch.youtubeVideoId = normalizeText(input.youtubeVideoId);
  }
  if (input.mimeType !== undefined) patch.mimeType = normalizeText(input.mimeType);
  if (input.fileSizeBytes !== undefined) patch.fileSizeBytes = input.fileSizeBytes;
  if (input.width !== undefined) patch.width = input.width;
  if (input.height !== undefined) patch.height = input.height;
  if (input.durationSeconds !== undefined) patch.durationSeconds = input.durationSeconds;

  if (Object.keys(patch).length > 0) {
    try {
      await db
        .update(propertyMedia)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(propertyMedia.id, mediaId));
    } catch (error) {
      if (isUniqueViolation(error, 'object_key')) {
        return fail({
          code: 'media_object_key_taken',
          message: 'Ya hay un archivo registrado con esa clave.',
          field: 'objectKey',
        });
      }
      throw error;
    }
  }

  await writeMediaTexts(db, mediaId, input);

  /*
   * Los roles pasan por el mismo camino que `setMediaRoles`: una unica
   * implementacion del intercambio, tambien cuando llegan dentro de un PATCH.
   */
  if (input.isHero !== undefined || input.isCatalogCover !== undefined) {
    const roles = await setMediaRoles(db, propertyId, mediaId, {
      ...(input.isHero === undefined ? {} : { isHero: input.isHero }),
      ...(input.isCatalogCover === undefined ? {} : { isCatalogCover: input.isCatalogCover }),
    });
    if (!roles.ok) return roles;

    return roles;
  }

  const refreshed = await loadMediaRow(db, propertyId, mediaId);
  if (!refreshed.ok) return refreshed;

  return ok(toRecord(refreshed.data));
}

/* -------------------------------------------------------------------------- */
/* Eliminar                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Borra el REGISTRO, no el archivo.
 *
 * En esta fase no existe almacenamiento, asi que no hay ningun objeto de R2
 * que retirar; la clave queda libre para volver a registrarse.
 *
 * Un panorama usado por un nodo del recorrido 360 no se puede borrar: la
 * clave foranea es `RESTRICT` y se comprueba antes para poder explicarlo, en
 * lugar de dejar que reviente el driver. La referencia NO se rompe.
 */
export async function deleteMedia(
  db: AdminDatabase,
  propertyId: number,
  mediaId: number,
): Promise<AdminResult<{ id: number }>> {
  const found = await loadMediaRow(db, propertyId, mediaId);
  if (!found.ok) return found;

  const usedByTour = await db
    .select({ id: propertyTourNodes.id })
    .from(propertyTourNodes)
    .where(eq(propertyTourNodes.propertyMediaId, mediaId))
    .limit(1);

  if (usedByTour.length > 0) {
    return fail({
      code: 'media_in_use',
      message: 'No se puede eliminar: el recorrido 360° usa este panorama.',
      field: 'mediaId',
    });
  }

  // Sus traducciones caen por CASCADE.
  await db
    .delete(propertyMedia)
    .where(and(eq(propertyMedia.id, mediaId), eq(propertyMedia.propertyId, propertyId)));

  return ok({ id: mediaId });
}
