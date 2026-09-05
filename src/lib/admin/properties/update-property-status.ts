/**
 * Cambios de estado editorial.
 *
 * Esta funcion existe para IMPEDIR escrituras arbitrarias de
 * `publication_status`: solo deja pasar las transiciones del flujo aprobado.
 *
 * Todavia NO implementa publicacion real: `published` no se alcanza desde
 * aqui, no se toca `published_at`, y no se crean revisiones, tokens ni correos.
 */

import { eq } from 'drizzle-orm';

import { properties } from '../../../db/schema';
import type { PublicationStatus } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

/**
 * Transiciones permitidas en esta fase.
 *
 * `draft -> published` no aparece deliberadamente: publicar exige pasar por
 * revision. `approved -> published` tampoco: la publicacion real llegara en
 * una fase posterior, junto con `published_at` y el rebuild.
 */
const ALLOWED_TRANSITIONS: Record<PublicationStatus, PublicationStatus[]> = {
  draft: ['in_review', 'archived'],
  in_review: ['draft', 'approved', 'archived'],
  approved: ['draft', 'archived'],
  published: ['archived'],
  archived: ['draft'],
};

export function isAllowedTransition(from: PublicationStatus, to: PublicationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(from: PublicationStatus): PublicationStatus[] {
  return [...ALLOWED_TRANSITIONS[from]];
}

export async function updatePropertyStatus(
  db: AdminDatabase,
  propertyId: number,
  nextStatus: PublicationStatus,
): Promise<AdminResult<typeof properties.$inferSelect>> {
  const found = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);

  const existing = found[0];
  if (existing === undefined) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const current = existing.publicationStatus;

  if (current === nextStatus) return ok(existing);

  if (!isAllowedTransition(current, nextStatus)) {
    return fail({
      code: 'invalid_status_transition',
      message: `No se puede pasar de "${current}" a "${nextStatus}".`,
      field: 'publicationStatus',
    });
  }

  const updated = await db
    .update(properties)
    .set({ publicationStatus: nextStatus, updatedAt: new Date() })
    .where(eq(properties.id, propertyId))
    .returning();

  const row = updated[0];
  if (row === undefined) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  return ok(row);
}
