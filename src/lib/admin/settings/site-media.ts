import { eq } from 'drizzle-orm';
import { siteSettings } from '../../../db/schema';
import { checkSiteUpload, type SiteMediaSlot } from '../../domain/site-media';
import { extensionForMimeType } from '../../domain/media-upload';
import { fail, ok, type AdminDatabase } from '../types';
import type { MediaBucket } from '../media/bucket';

export const COLUMN_BY_SLOT = {
  logo: 'logoObjectKey',
  favicon: 'faviconObjectKey',
  social: 'socialImageObjectKey',
  hero: 'heroObjectKey',
} as const;
export async function readSiteMediaKey(db: AdminDatabase, slot: SiteMediaSlot) {
  const [row] = await db
    .select({ key: siteSettings[COLUMN_BY_SLOT[slot]] })
    .from(siteSettings)
    .where(eq(siteSettings.id, 1))
    .limit(1);
  return row?.key ?? null;
}
export async function changeSiteImage(
  db: AdminDatabase,
  bucket: MediaBucket,
  slot: SiteMediaSlot,
  file: File | null,
) {
  let key: string | null = null;
  if (file) {
    const bytes = await file.arrayBuffer();
    const checked = checkSiteUpload({
      slot,
      bytes: new Uint8Array(bytes),
      declaredMimeType: file.type,
    });
    if (checked.problems.length || !checked.detectedMimeType)
      return fail({
        code: 'media_upload_rejected',
        message: 'Imagen no admitida o demasiado grande.',
      });
    key = `site/${slot}/${crypto.randomUUID()}.${extensionForMimeType(checked.detectedMimeType)}`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: checked.detectedMimeType } });
  }
  const data = { [COLUMN_BY_SLOT[slot]]: key, updatedAt: new Date() };
  await db
    .insert(siteSettings)
    .values({ id: 1, ...data })
    .onConflictDoUpdate({ target: siteSettings.id, set: data });
  return ok({ slot, present: key !== null });
}
