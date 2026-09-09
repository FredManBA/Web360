/**
 * Subir, reemplazar y quitar la media global del sitio.
 *
 * Cuatro huecos y una fila: `site_settings` guarda una clave de R2 por hueco y
 * nada mas. No hay tabla nueva, no hay ids, no hay relaciones con propiedades.
 *
 * El orden de las operaciones es lo unico delicado, y es el mismo criterio que
 * la multimedia de propiedades:
 *
 * - AL SUBIR se guarda primero el objeto y despues se apunta la clave. Si la
 *   base falla, se retira el objeto recien subido;
 * - AL REEMPLAZAR se apunta la clave nueva ANTES de borrar la vieja. Si el
 *   borrado falla, queda un objeto huerfano en R2 —molesto y silencioso— en
 *   vez de una referencia rota, que seria un hueco vacio en la web;
 * - AL QUITAR se borra primero la referencia y despues se intenta borrar el
 *   objeto, por la misma razon.
 *
 * Un huerfano se puede limpiar cualquier dia; una referencia rota la ve todo
 * el mundo.
 *
 * Las claves NO salen de aqui. Lo que se devuelve al panel es si hay imagen y
 * cuando cambio, nunca donde esta.
 */

import { asc, eq } from 'drizzle-orm';

import { siteSettings } from '../../../db/schema';
import {
  buildSiteObjectKey,
  checkSiteUpload,
  SITE_MEDIA_RULES,
  SITE_MEDIA_SLOTS,
  type SiteMediaSlot,
} from '../../domain/site-media';
import { extensionForMimeType, type UploadProblem } from '../../domain/media-upload';
import type { MediaBucket } from '../media/bucket';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

/* -------------------------------------------------------------------------- */
/* Forma                                                                      */
/* -------------------------------------------------------------------------- */

/** Lo que el panel sabe de un hueco. Sin la clave. */
export interface SiteMediaSlotView {
  slot: SiteMediaSlot;
  label: string;
  /** Si hay imagen configurada. */
  present: boolean;
  /** Ruta publica para previsualizarla; `null` cuando el hueco esta vacio. */
  url: string | null;
  /** Version, para que el navegador no ensene la imagen anterior. */
  version: number | null;
  maxBytes: number;
  mimeTypes: string[];
}

export type SiteMediaView = Record<SiteMediaSlot, SiteMediaSlotView>;

/** Columna de `site_settings` que guarda cada hueco. */
const COLUMN_BY_SLOT = {
  logo: 'logoObjectKey',
  favicon: 'faviconObjectKey',
  social: 'defaultSocialImageObjectKey',
  hero: 'homeHeroObjectKey',
} as const satisfies Record<SiteMediaSlot, keyof typeof siteSettings.$inferSelect>;

/** La ruta publica de un hueco. Es lo unico que ve el navegador. */
export function siteMediaUrl(slot: SiteMediaSlot, version: number | null = null): string {
  return version === null ? `/site-media/${slot}` : `/site-media/${slot}?v=${version}`;
}

const UPLOAD_MESSAGES: Record<UploadProblem, string> = {
  empty_file: 'El archivo está vacío.',
  mime_not_allowed: 'Ese tipo de archivo no se admite aquí.',
  content_unrecognized: 'No reconocemos el contenido del archivo.',
  content_mismatch: 'El contenido del archivo no coincide con su tipo.',
  too_large: 'La imagen supera el tamaño máximo de este hueco.',
};

/* -------------------------------------------------------------------------- */
/* Lectura                                                                    */
/* -------------------------------------------------------------------------- */

interface SettingsRow {
  id: number;
  updatedAt: Date;
  keys: Record<SiteMediaSlot, string | null>;
}

async function readSettings(db: AdminDatabase): Promise<SettingsRow | null> {
  const rows = await db.select().from(siteSettings).orderBy(asc(siteSettings.id)).limit(1);
  const row = rows[0];

  if (row === undefined) return null;

  return {
    id: row.id,
    updatedAt: row.updatedAt,
    keys: {
      logo: row.logoObjectKey,
      favicon: row.faviconObjectKey,
      social: row.defaultSocialImageObjectKey,
      hero: row.homeHeroObjectKey,
    },
  };
}

/**
 * La clave de un hueco.
 *
 * La usa la entrega publica para ir a buscar el objeto. Es la unica funcion
 * que devuelve una clave, y solo se llama desde el servidor.
 */
export async function readSiteMediaKey(
  db: AdminDatabase,
  slot: SiteMediaSlot,
): Promise<string | null> {
  return (await readSettings(db))?.keys[slot] ?? null;
}

/** Segundos, que es resolucion de sobra para saber si algo cambio. */
function versionOf(row: SettingsRow | null): number | null {
  return row === null ? null : Math.floor(row.updatedAt.getTime() / 1000);
}

export async function getSiteMedia(db: AdminDatabase): Promise<SiteMediaView> {
  const row = await readSettings(db);
  const version = versionOf(row);

  const view = {} as SiteMediaView;

  for (const slot of SITE_MEDIA_SLOTS) {
    const present = (row?.keys[slot] ?? null) !== null;
    const rule = SITE_MEDIA_RULES[slot];

    view[slot] = {
      slot,
      label: rule.label,
      present,
      url: present ? siteMediaUrl(slot, version) : null,
      version: present ? version : null,
      maxBytes: rule.maxBytes,
      mimeTypes: [...rule.mimeTypes],
    };
  }

  return view;
}

/* -------------------------------------------------------------------------- */
/* Escritura                                                                  */
/* -------------------------------------------------------------------------- */

/** Asegura que existe la fila de configuracion, y devuelve su id. */
async function settingsRowId(db: AdminDatabase): Promise<number> {
  const existing = await readSettings(db);
  if (existing !== null) return existing.id;

  const inserted = await db.insert(siteSettings).values({}).returning({ id: siteSettings.id });
  const id = inserted[0]?.id;

  if (id === undefined) throw new Error('no se pudo crear la configuracion del sitio');

  return id;
}

/** Borra un objeto sin dejar que su fallo tumbe la operacion. */
async function forget(bucket: MediaBucket, key: string | null): Promise<void> {
  if (key === null) return;

  try {
    await bucket.delete(key);
  } catch (error) {
    /*
     * Un huerfano en R2 es un problema de limpieza; una referencia rota lo es
     * de la web. Se deja constancia y se sigue.
     */
    console.error('[media del sitio] no se pudo borrar un objeto anterior:', error);
  }
}

export interface SiteMediaUploadInput {
  /** Nombre con el que llego el archivo. Solo se usa como metadato en R2. */
  fileName: string;
  declaredMimeType: string;
  bytes: ArrayBuffer;
}

/**
 * Pone (o reemplaza) la imagen de un hueco.
 *
 * La clave se genera aqui dentro: el cliente manda bytes y un tipo, nunca una
 * ruta.
 */
export async function uploadSiteMedia(
  db: AdminDatabase,
  bucket: MediaBucket,
  slot: SiteMediaSlot,
  input: SiteMediaUploadInput,
): Promise<AdminResult<SiteMediaView>> {
  const bytes = new Uint8Array(input.bytes);

  const { problems, detectedMimeType } = checkSiteUpload({
    slot,
    declaredMimeType: input.declaredMimeType,
    bytes,
  });

  const firstProblem = problems[0];
  if (firstProblem !== undefined) {
    const limit = Math.round(SITE_MEDIA_RULES[slot].maxBytes / 1024);

    return fail({
      code: 'media_upload_rejected',
      message:
        firstProblem === 'too_large'
          ? `${UPLOAD_MESSAGES[firstProblem]} (máximo ${limit} KB).`
          : UPLOAD_MESSAGES[firstProblem],
      field: 'file',
    });
  }

  // `checkSiteUpload` solo deja pasar el archivo si reconocio su contenido.
  if (detectedMimeType === null) {
    return fail({
      code: 'media_upload_rejected',
      message: UPLOAD_MESSAGES.content_unrecognized,
      field: 'file',
    });
  }

  const id = await settingsRowId(db);
  const previous = await readSiteMediaKey(db, slot);

  const objectKey = buildSiteObjectKey(
    slot,
    extensionForMimeType(detectedMimeType),
    crypto.randomUUID(),
  );

  try {
    await bucket.put(objectKey, input.bytes, {
      httpMetadata: { contentType: detectedMimeType },
      customMetadata: { siteMediaSlot: slot },
    });
  } catch {
    // Sin objeto no se apunta nada: la configuracion se queda como estaba.
    return fail({
      code: 'media_upload_failed',
      message: 'No pudimos guardar la imagen. Vuelve a intentarlo.',
      field: 'file',
    });
  }

  try {
    await db
      .update(siteSettings)
      .set({ [COLUMN_BY_SLOT[slot]]: objectKey, updatedAt: new Date() })
      .where(eq(siteSettings.id, id));
  } catch (error) {
    // La base fallo: se retira lo que si llego a subirse.
    await forget(bucket, objectKey);
    throw error;
  }

  // La referencia nueva ya esta escrita; ahora si se puede soltar la vieja.
  if (previous !== null && previous !== objectKey) await forget(bucket, previous);

  return ok(await getSiteMedia(db));
}

/**
 * Vacia un hueco.
 *
 * Primero la referencia, despues el objeto: si el borrado en R2 falla, el
 * sitio ya no lo enlaza y lo unico que queda es un archivo de mas.
 */
export async function deleteSiteMedia(
  db: AdminDatabase,
  bucket: MediaBucket,
  slot: SiteMediaSlot,
): Promise<AdminResult<SiteMediaView>> {
  const row = await readSettings(db);
  const previous = row?.keys[slot] ?? null;

  if (row === null || previous === null) {
    return fail({
      code: 'media_not_found',
      message: 'Ese hueco no tiene ninguna imagen.',
      field: 'slot',
    });
  }

  await db
    .update(siteSettings)
    .set({ [COLUMN_BY_SLOT[slot]]: null, updatedAt: new Date() })
    .where(eq(siteSettings.id, row.id));

  await forget(bucket, previous);

  return ok(await getSiteMedia(db));
}
