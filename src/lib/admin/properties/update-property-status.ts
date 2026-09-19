import { eq } from 'drizzle-orm';

import { properties } from '../../../db/schema';
import type { PublicationStatus } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

/**
 * Quien pide el cambio.
 *
 * `editorial` es el panel y todo lo demas. `publication` es unicamente la
 * capa historica. `runtime-publication` aplica las acciones inmediatas de R1
 * despues de validar el contenido.
 */
export type StatusChangeScope = 'editorial' | 'publication' | 'runtime-publication';

/**
 * Transiciones del flujo editorial.
 *
 * Ninguna ruta editorial puede publicar saltandose el validador de contenido.
 */
const ALLOWED_TRANSITIONS: Record<PublicationStatus, PublicationStatus[]> = {
  draft: ['in_review', 'archived'],
  in_review: ['draft', 'approved', 'archived'],
  approved: ['draft', 'archived'],
  published: ['archived'],
  archived: ['draft'],
};

/**
 * Transiciones reservadas al flujo historico de publicacion.
 *
 * `approved -> published` se aplica cuando el build que incluye la propiedad
 * ya esta desplegado; `published -> approved` cuando el build que la retira
 * lo esta. Antes de esa confirmacion la propiedad NO cambia de estado, para
 * que un fallo no deje la base diciendo algo que la web no dice.
 */
const PUBLICATION_TRANSITIONS: Record<PublicationStatus, PublicationStatus[]> = {
  draft: [],
  in_review: [],
  approved: ['published'],
  published: ['approved'],
  archived: [],
};

/** Transiciones inmediatas de R1. El scope editorial no puede saltarse la validacion. */
const RUNTIME_PUBLICATION_TRANSITIONS: Record<PublicationStatus, PublicationStatus[]> = {
  draft: ['published'],
  in_review: ['published', 'draft'],
  approved: ['published', 'draft'],
  published: ['draft'],
  archived: [],
};

export function isAllowedTransition(
  from: PublicationStatus,
  to: PublicationStatus,
  scope: StatusChangeScope = 'editorial',
): boolean {
  if (scope === 'runtime-publication') return RUNTIME_PUBLICATION_TRANSITIONS[from].includes(to);
  if (ALLOWED_TRANSITIONS[from].includes(to)) return true;

  return scope === 'publication' && PUBLICATION_TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(
  from: PublicationStatus,
  scope: StatusChangeScope = 'editorial',
): PublicationStatus[] {
  if (scope === 'runtime-publication') return [...RUNTIME_PUBLICATION_TRANSITIONS[from]];
  return scope === 'publication'
    ? [...ALLOWED_TRANSITIONS[from], ...PUBLICATION_TRANSITIONS[from]]
    : [...ALLOWED_TRANSITIONS[from]];
}

export interface StatusChangeOptions {
  /** Por defecto `editorial`: lo restrictivo es lo que se obtiene sin pedir nada. */
  scope?: StatusChangeScope;
  now?: Date;
}

export async function updatePropertyStatus(
  db: AdminDatabase,
  propertyId: number,
  nextStatus: PublicationStatus,
  options: StatusChangeOptions = {},
): Promise<AdminResult<typeof properties.$inferSelect>> {
  const scope = options.scope ?? 'editorial';
  const now = options.now ?? new Date();

  const found = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);

  const existing = found[0];
  if (existing === undefined) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const current = existing.publicationStatus;

  if (current === nextStatus) return ok(existing);

  if (!isAllowedTransition(current, nextStatus, scope)) {
    return fail({
      code: 'invalid_status_transition',
      message: `No se puede pasar de "${current}" a "${nextStatus}".`,
      field: 'publicationStatus',
    });
  }

  /*
   * `published_at` es "cuando esta version salio a la web", no una marca
   * historica: se pone al publicar y se retira al despublicar, para que no
   * quede una fecha afirmando algo que ya no es cierto. Solo lo escribe el
   * flujo de publicacion; ninguna transicion editorial lo toca.
   */
  const publishedAt =
    nextStatus === 'published'
      ? now
      : scope === 'runtime-publication' || current === 'published'
        ? null
        : existing.publishedAt;

  const updated = await db
    .update(properties)
    .set({ publicationStatus: nextStatus, publishedAt, updatedAt: now })
    .where(eq(properties.id, propertyId))
    .returning();

  const row = updated[0];
  if (row === undefined) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  return ok(row);
}
