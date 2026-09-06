/**
 * Lectura del multimedia de una propiedad.
 *
 * Devuelve la estructura ya lista para pintar: grupos con sus nombres y sus
 * archivos dentro, mas los archivos sin grupo aparte. Se incluyen tambien
 * `heroId` y `catalogCoverId`, que no son columnas nuevas sino un atajo
 * derivado de las banderas: la UI los necesita en cada repintado y buscarlos
 * a mano en cada lista es ruido.
 *
 * El orden se fija SIEMPRE de forma explicita (`sort_order ASC, id ASC`); no
 * se confia en el orden natural de SQLite.
 */

import { asc, eq } from 'drizzle-orm';

import {
  properties,
  propertyMedia,
  propertyMediaGroupTranslations,
  propertyMediaGroups,
  propertyMediaTranslations,
} from '../../../db/schema';
import type { Locale, MediaKind, SourceProvider } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

export interface MediaTranslationView {
  title: string | null;
  altText: string | null;
  caption: string | null;
}

export interface MediaView {
  id: number;
  groupId: number | null;

  mediaKind: MediaKind;
  sourceProvider: SourceProvider;

  /** Clave del objeto en R2. `null` cuando la fuente es YouTube. */
  objectKey: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  youtubeVideoId: string | null;

  width: number | null;
  height: number | null;
  durationSeconds: number | null;

  sortOrder: number;
  isHero: boolean;
  isCatalogCover: boolean;

  translations: Partial<Record<Locale, MediaTranslationView>>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaGroupView {
  id: number;
  sortOrder: number;
  names: Partial<Record<Locale, string | null>>;
  media: MediaView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PropertyMediaView {
  propertyId: number;
  groups: MediaGroupView[];
  /** Archivos de la propiedad que no pertenecen a ningun grupo. */
  ungrouped: MediaView[];
  /** Derivados de las banderas; `null` si todavia no se ha elegido. */
  heroId: number | null;
  catalogCoverId: number | null;
}

/** Orden estable: primero `sortOrder`, y el id desempata. */
function byOrder<T extends { sortOrder: number; id: number }>(a: T, b: T): number {
  return a.sortOrder === b.sortOrder ? a.id - b.id : a.sortOrder - b.sortOrder;
}

export async function getPropertyMedia(
  db: AdminDatabase,
  propertyId: number,
): Promise<AdminResult<PropertyMediaView>> {
  const owner = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  if (owner.length === 0) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const groupRows = await db
    .select()
    .from(propertyMediaGroups)
    .where(eq(propertyMediaGroups.propertyId, propertyId))
    .orderBy(asc(propertyMediaGroups.sortOrder), asc(propertyMediaGroups.id));

  const mediaRows = await db
    .select()
    .from(propertyMedia)
    .where(eq(propertyMedia.propertyId, propertyId))
    .orderBy(asc(propertyMedia.sortOrder), asc(propertyMedia.id));

  /*
   * Las traducciones se traen enteras y se cruzan en memoria, igual que en
   * caracteristicas: con el volumen previsto es mas simple y legible que
   * varios joins condicionales.
   */
  const groupNames = await db
    .select({
      groupId: propertyMediaGroupTranslations.propertyMediaGroupId,
      locale: propertyMediaGroupTranslations.locale,
      name: propertyMediaGroupTranslations.name,
    })
    .from(propertyMediaGroupTranslations);

  const mediaTexts = await db
    .select({
      mediaId: propertyMediaTranslations.propertyMediaId,
      locale: propertyMediaTranslations.locale,
      title: propertyMediaTranslations.title,
      altText: propertyMediaTranslations.altText,
      caption: propertyMediaTranslations.caption,
    })
    .from(propertyMediaTranslations);

  const namesByGroup = new Map<number, Partial<Record<Locale, string | null>>>();
  for (const row of groupNames) {
    const entry = namesByGroup.get(row.groupId) ?? {};
    entry[row.locale] = row.name;
    namesByGroup.set(row.groupId, entry);
  }

  const textsByMedia = new Map<number, Partial<Record<Locale, MediaTranslationView>>>();
  for (const row of mediaTexts) {
    const entry = textsByMedia.get(row.mediaId) ?? {};
    entry[row.locale] = { title: row.title, altText: row.altText, caption: row.caption };
    textsByMedia.set(row.mediaId, entry);
  }

  const toMediaView = (row: typeof propertyMedia.$inferSelect): MediaView => ({
    id: row.id,
    groupId: row.propertyMediaGroupId,

    mediaKind: row.mediaKind,
    sourceProvider: row.sourceProvider,

    objectKey: row.objectKey,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    youtubeVideoId: row.youtubeVideoId,

    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,

    sortOrder: row.sortOrder,
    isHero: row.isHero,
    isCatalogCover: row.isCatalogCover,

    translations: textsByMedia.get(row.id) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const media = mediaRows.map(toMediaView).sort(byOrder);

  const groups: MediaGroupView[] = groupRows
    .map((row) => ({
      id: row.id,
      sortOrder: row.sortOrder,
      names: namesByGroup.get(row.id) ?? {},
      media: media.filter((item) => item.groupId === row.id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
    .sort(byOrder);

  return ok({
    propertyId,
    groups,
    ungrouped: media.filter((item) => item.groupId === null),
    heroId: media.find((item) => item.isHero)?.id ?? null,
    catalogCoverId: media.find((item) => item.isCatalogCover)?.id ?? null,
  });
}
