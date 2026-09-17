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
  isSitePublicationAction,
  SITE_PUBLICATION_ACTION,
  type PropertyPublicationAction,
  type PublicationStatus,
} from '../domain/vocabularies';
import {
  buildReleaseCandidate,
  releaseIdFor,
  type ReleaseCandidate,
  type ReleaseMetadata,
} from './release';

/**
 * La peticion que se va a construir.
 *
 * Union y no un `propertyId` nullable: una operacion de propiedad SIEMPRE
 * tiene propiedad y estado editorial, y una del sitio no tiene ninguno de los
 * dos. Escrito asi, el compilador no deja confundirlos.
 */
export type CandidateRequest =
  | {
      id: number;
      action: PropertyPublicationAction;
      propertyId: number;
      /** Estado editorial de la propiedad en el momento de leerla. */
      publicationStatus: PublicationStatus;
    }
  | { id: number; action: typeof SITE_PUBLICATION_ACTION; propertyId: null };

/**
 * Estado editorial que exige cada accion de propiedad para tener sentido.
 *
 * `publish_site` no esta, y no por olvido: no mira ninguna propiedad, asi que
 * no hay estado que exigir. El tipo lo deja dicho.
 */
const REQUIRED_STATUS: Record<PropertyPublicationAction, PublicationStatus> = {
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
    /*
     * `left` y no `inner`: una peticion de sitio no tiene propiedad con la que
     * juntarse, y con `inner` desapareceria de la consulta como si no
     * existiera.
     */
    .leftJoin(properties, eq(publicationRequests.propertyId, properties.id))
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

  if (isSitePublicationAction(row.action)) {
    /*
     * Publicar el sitio no exige nada de ninguna propiedad. El CHECK de la
     * base ya garantiza que estas filas no llevan `property_id`; comprobarlo
     * aqui tambien es lo que permite devolver el tipo estrecho sin mentir.
     */
    if (row.propertyId !== null) {
      return fail({
        code: 'publication_failed',
        message: `La peticion ${requestId} publica el sitio y no deberia nombrar una propiedad.`,
      });
    }

    return ok({ id: row.id, action: row.action, propertyId: null });
  }

  if (row.propertyId === null || row.publicationStatus === null) {
    return fail({
      code: 'publication_failed',
      message: `La peticion ${requestId} pide "${row.action}" y no encuentra su propiedad.`,
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
    action: row.action,
    propertyId: row.propertyId,
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
