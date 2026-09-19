import { eq } from 'drizzle-orm';

import { properties, propertyTranslations } from '../../../db/schema';
import { validatePropertyForPublication } from '../../domain/publication';
import { canPublishProperty } from '../../domain/states';
import { isPubliclyVisible } from '../../domain/visibility';
import type { PublicationStatus } from '../../domain/vocabularies';
import { propertyHref } from '../../public/read-model';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';
import { loadForPublication } from './load-for-publication';
import { updatePropertyStatus } from './update-property-status';

export interface DirectPublicationState {
  publicationStatus: PublicationStatus;
  href: string | null;
}

export async function getDirectPublicationState(
  db: AdminDatabase,
  propertyId: number,
): Promise<AdminResult<DirectPublicationState>> {
  const [property] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  if (property === undefined)
    return fail({ code: 'not_found', message: 'La propiedad no existe.' });
  const translations = await db
    .select()
    .from(propertyTranslations)
    .where(eq(propertyTranslations.propertyId, propertyId));
  const spanish = translations.find((row) => row.locale === 'es');
  return ok({
    publicationStatus: property.publicationStatus,
    href:
      isPubliclyVisible(property) && spanish?.slug?.trim() && spanish.title?.trim()
        ? propertyHref('es', spanish.slug)
        : null,
  });
}

/** D1 es la publicacion: ninguna peticion, revision o ejecutor interviene. */
export async function publishProperty(
  db: AdminDatabase,
  propertyId: number,
  now = new Date(),
): Promise<AdminResult<DirectPublicationState>> {
  const property = await loadForPublication(db, propertyId);
  if (property === null) return fail({ code: 'not_found', message: 'La propiedad no existe.' });
  if (
    property.publicationStatus !== 'published' &&
    !canPublishProperty(property.publicationStatus)
  ) {
    return fail({
      code: 'publication_not_allowed',
      message: 'Restaura la propiedad a borrador antes de publicarla.',
    });
  }
  const check = validatePropertyForPublication(property);
  if (!check.valid) {
    return fail({
      code: 'publication_incomplete',
      message: 'Completa los siguientes datos para publicar.',
      issues: check.issues.map((issue) => ({
        path: issue.field ?? issue.section,
        message: issue.message,
      })),
    });
  }
  const changed = await updatePropertyStatus(db, propertyId, 'published', {
    scope: 'runtime-publication',
    now,
  });
  if (!changed.ok) return changed;
  return getDirectPublicationState(db, propertyId);
}

export async function unpublishProperty(
  db: AdminDatabase,
  propertyId: number,
  now = new Date(),
): Promise<AdminResult<DirectPublicationState>> {
  const changed = await updatePropertyStatus(db, propertyId, 'draft', {
    scope: 'runtime-publication',
    now,
  });
  if (!changed.ok) return changed;
  return getDirectPublicationState(db, propertyId);
}
