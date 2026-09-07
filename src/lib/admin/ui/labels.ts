/**
 * Etiquetas humanas del panel.
 *
 * Los identificadores internos (`draft`, `offer_received`...) no se muestran
 * nunca al usuario.
 */

import type {
  CommercialStatus,
  ContactMethod,
  ContactStatus,
  PublicationStatus,
} from '../../domain/vocabularies';

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  approved: 'Aprobada',
  published: 'Publicada',
  archived: 'Archivada',
};

export const COMMERCIAL_STATUS_LABELS: Record<CommercialStatus, string> = {
  available: 'Disponible',
  offer_received: 'Con oferta',
  reserved: 'Reservada',
  sold: 'Vendida',
};

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  email: 'Correo',
  whatsapp: 'WhatsApp',
  phone: 'Teléfono',
  social: 'Redes',
  other: 'Otro',
};

/** Bandeja de entrada, no un pipeline: solo pendiente y atendida. */
export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  new: 'Sin atender',
  reviewed: 'Atendida',
};

export function publicationStatusLabel(status: PublicationStatus): string {
  return PUBLICATION_STATUS_LABELS[status];
}

export function commercialStatusLabel(status: CommercialStatus): string {
  return COMMERCIAL_STATUS_LABELS[status];
}

/** "1 propiedad" / "8 propiedades". Sin graficas ni KPIs inventados. */
export function propertyCountLabel(total: number): string {
  return total === 1 ? '1 propiedad' : `${total} propiedades`;
}
