/**
 * Transiciones del estado editorial.
 *
 * R1 publica directamente desde borrador; los estados editoriales antiguos
 * siguen siendo compatibles mientras se retiran sus tablas en otra fase.
 * Estos helpers solo expresan reglas; ninguno escribe en base de datos.
 *
 * El estado comercial es independiente y no interviene aqui.
 */

import type { PublicationStatus, ReviewStatus } from './vocabularies';

/** Se envia a revision desde el borrador. */
export function canSubmitForReview(status: PublicationStatus): boolean {
  return status === 'draft';
}

/** El revisor solo actua sobre una revision pendiente. */
export function canApproveReview(reviewStatus: ReviewStatus): boolean {
  return reviewStatus === 'pending';
}

/** Misma condicion para pedir cambios. */
export function canRequestChanges(reviewStatus: ReviewStatus): boolean {
  return reviewStatus === 'pending';
}

/**
 * Una propiedad editable puede publicarse sin revision externa.
 *
 * Esto es unicamente la comprobacion de estado: que la ficha este COMPLETA lo
 * decide `validatePropertyForPublication`. Ambas deben cumplirse para publicar.
 */
export function canPublishProperty(status: PublicationStatus): boolean {
  return status === 'draft' || status === 'in_review' || status === 'approved';
}

/** Se archiva desde cualquier estado, salvo si ya esta archivada. */
export function canArchiveProperty(status: PublicationStatus): boolean {
  return status !== 'archived';
}

/** Volver a borrador para retomar la edicion de una propiedad archivada. */
export function canRestoreToDraft(status: PublicationStatus): boolean {
  return status === 'archived';
}

/** Estados a los que se puede pasar desde el actual, para pintar la UI. */
export function nextPublicationStatuses(status: PublicationStatus): PublicationStatus[] {
  const next: PublicationStatus[] = [];

  if (canPublishProperty(status)) next.push('published');
  if (status === 'published') next.push('draft');
  if (canArchiveProperty(status)) next.push('archived');
  if (canRestoreToDraft(status)) next.push('draft');

  return next;
}
