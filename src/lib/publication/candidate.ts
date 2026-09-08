/**
 * La version candidata que corresponde a UNA peticion concreta.
 *
 * Quien construye el sitio recibe un numero de peticion y nada mas. Todo lo
 * demas —que propiedad, que accion, si la operacion sigue viva— se lee de la
 * base, nunca del entorno. Esa es la regla que hace que manipular la variable
 * del build no sirva para publicar otra cosa: cambiarla solo puede apuntar a
 * otra peticion que ya existe, con su propia propiedad y su propia accion.
 *
 * Aqui se comprueba lo que el build no puede dar por supuesto:
 *
 * - la peticion existe;
 * - sigue siendo la operacion viva de su propiedad;
 * - el estado editorial encaja con la accion (publicar exige `approved`,
 *   retirar exige `published`), que es la misma regla que aplico la capa de
 *   aplicacion al anotarla y que puede haber dejado de ser cierta desde
 *   entonces;
 * - la candidata que sale lleva la identidad de esa peticion.
 *
 * Si algo no cuadra, no se construye un sitio "casi bueno": se falla, y quien
 * llama decide. Un build que sigue adelante con datos que no encajan es
 * exactamente como se despliega una web incoherente.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { properties, publicationRequests } from '../../db/schema';
import { fail, ok, type AdminDatabase, type AdminResult } from '../admin/types';
import {
  ACTIVE_PUBLICATION_REQUEST_STATUSES,
  type PublicationAction,
  type PublicationStatus,
} from '../domain/vocabularies';
import {
  buildReleaseCandidate,
  releaseIdFor,
  type ReleaseCandidate,
  type ReleaseMetadata,
} from './release';

export interface CandidateRequest {
  id: number;
  propertyId: number;
  action: PublicationAction;
  /** Estado editorial de la propiedad en el momento de leerla. */
  publicationStatus: PublicationStatus;
}

/** Estado editorial que exige cada accion para tener sentido. */
const REQUIRED_STATUS: Record<PublicationAction, PublicationStatus> = {
  publish: 'approved',
  unpublish: 'published',
};

/**
 * Resuelve la peticion que se va a construir.
 *
 * La lectura junta peticion y propiedad para que no quepa el hueco entre
 * "existe la peticion" y "la propiedad sigue como decia".
 */
export async function loadCandidateRequest(
  db: AdminDatabase,
  requestId: number,
): Promise<AdminResult<CandidateRequest>> {
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    return fail({
      code: 'validation_failed',
      message: 'El identificador de la peticion debe ser un entero positivo.',
      field: 'requestId',
    });
  }

  const rows = await db
    .select({
      id: publicationRequests.id,
      propertyId: publicationRequests.propertyId,
      action: publicationRequests.action,
      status: publicationRequests.status,
      publicationStatus: properties.publicationStatus,
    })
    .from(publicationRequests)
    .innerJoin(properties, eq(publicationRequests.propertyId, properties.id))
    .where(
      and(
        eq(publicationRequests.id, requestId),
        // Solo una operacion viva se puede construir.
        inArray(publicationRequests.status, [...ACTIVE_PUBLICATION_REQUEST_STATUSES]),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    return fail({
      code: 'publication_request_not_found',
      message: `No hay ninguna operacion de publicacion viva con el numero ${requestId}.`,
      field: 'requestId',
    });
  }

  if (row.publicationStatus !== REQUIRED_STATUS[row.action]) {
    return fail({
      code: 'publication_not_allowed',
      message:
        `La peticion ${requestId} pide "${row.action}", pero la propiedad esta en ` +
        `"${row.publicationStatus}".`,
      field: 'publicationStatus',
    });
  }

  return ok({
    id: row.id,
    propertyId: row.propertyId,
    action: row.action,
    publicationStatus: row.publicationStatus,
  });
}

/**
 * Construye la version candidata de una peticion.
 *
 * No escribe nada en la base: publicar sigue siendo cosa del callback.
 */
export async function buildRequestedRelease(
  db: AdminDatabase,
  requestId: number,
  now: Date = new Date(),
  metadata: ReleaseMetadata = {},
): Promise<AdminResult<ReleaseCandidate>> {
  const request = await loadCandidateRequest(db, requestId);
  if (!request.ok) return request;

  const candidate = await buildReleaseCandidate(db, request.data, now, metadata);

  /*
   * La candidata tiene que poder demostrar de que peticion salio. Si esto no
   * cuadrara, el artefacto no podria servir mas tarde para reconciliar, que es
   * justo para lo que existe el manifiesto.
   */
  if (
    candidate.manifest.requestId !== request.data.id ||
    candidate.manifest.releaseId !== releaseIdFor(request.data)
  ) {
    return fail({
      code: 'publication_failed',
      message: 'La version construida no corresponde a la peticion pedida.',
    });
  }

  return ok(candidate);
}
