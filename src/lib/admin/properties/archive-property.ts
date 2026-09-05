/**
 * Archivado.
 *
 * Archivar es un cambio de ESTADO EDITORIAL, no un borrado: la fila y sus
 * traducciones permanecen intactas, y el estado comercial no se toca.
 *
 * No existe eliminacion fisica de propiedades: el producto prioriza archivar.
 */

import { properties } from '../../../db/schema';
import type { AdminDatabase, AdminResult } from '../types';
import { updatePropertyStatus } from './update-property-status';

export async function archiveProperty(
  db: AdminDatabase,
  propertyId: number,
): Promise<AdminResult<typeof properties.$inferSelect>> {
  return updatePropertyStatus(db, propertyId, 'archived');
}
