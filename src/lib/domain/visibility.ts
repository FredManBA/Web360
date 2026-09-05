/**
 * Visibilidad publica de una propiedad.
 *
 * Funcion pura: no consulta base de datos ni depende de la peticion.
 * Todavia no interviene nada de SEO ni `noindex`.
 */

import type { CommercialStatus, PublicationStatus } from './vocabularies';

export interface VisibilityInput {
  publicationStatus: PublicationStatus;
  commercialStatus: CommercialStatus;
  showWhenSold: boolean;
}

/**
 * Reglas:
 *
 * - solo `published` puede ser publico; draft, in_review, approved y archived
 *   no lo son nunca;
 * - vendida y `showWhenSold = false` -> oculta;
 * - vendida y `showWhenSold = true`  -> visible;
 * - `offer_received` y `reserved` siguen visibles (siguen siendo escaparate).
 *
 * Los dos estados son independientes: el comercial solo puede ocultar una
 * propiedad ya publicada, nunca publicar una que no lo esta.
 */
export function isPubliclyVisible(input: VisibilityInput): boolean {
  if (input.publicationStatus !== 'published') return false;
  if (input.commercialStatus === 'sold') return input.showWhenSold;
  return true;
}
