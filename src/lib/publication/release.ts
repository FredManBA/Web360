/**
 * La version del sitio que produciria una peticion de publicacion.
 *
 * Dos piezas, y las dos salen de la misma lectura:
 *
 * - el SNAPSHOT candidato: el sitio publico tal como quedaria si la operacion
 *   saliera bien, construido sin tocar la base;
 * - el MANIFIESTO: la lista de archivos que ese HTML referencia.
 *
 * Por que hace falta el manifiesto y no basta con la base. El HTML se
 * despliega una vez y se queda quieto; `publication_status` sigue siendo una
 * columna que cambia. Si la unica autorizacion de `/media/N` fuera esa
 * columna, la web desplegada y la puerta de los archivos podrian discrepar:
 * una propiedad retirada dejaria en el aire las fotos que su HTML todavia
 * enlaza, y una recien aprobada abriria sus archivos antes de que su ficha
 * exista. El manifiesto ata las dos cosas a la MISMA version: se genera del
 * snapshot que se despliega, asi que por construccion contiene exactamente lo
 * que ese HTML pide.
 *
 * Lo que el manifiesto NO hace es ampliar permisos. Es una lista blanca que
 * se suma a la comprobacion de la base; nunca la sustituye ni la relaja.
 *
 * Donde vive el manifiesto de la version desplegada es harina de otro costal
 * —viaja con el artefacto del build— y se resuelve en `deployed-release.ts`.
 */

import type { PublicationAction } from '../domain/vocabularies';
import {
  buildCandidateSnapshot,
  mediaIdFromPublicUrl,
  type PublicMediaItem,
  type PublicSnapshot,
} from '../public/read-model';
import type { AdminDatabase } from '../admin/types';

/**
 * Que archivos puede servir una version del sitio, y de que version se habla.
 *
 * No lleva ids de propiedad ni estados: es una lista blanca de archivos y su
 * procedencia. Se publica junto al sitio, asi que no debe contener nada que
 * no pudiera verse en el HTML.
 */
export interface ReleaseManifest {
  /** Identifica esta version. Se deriva de la peticion que la origino. */
  releaseId: string;
  generatedAt: string;
  /** Archivos que el HTML de esta version referencia. Ordenados. */
  mediaIds: number[];
}

export interface ReleaseCandidate {
  snapshot: PublicSnapshot;
  manifest: ReleaseManifest;
}

export interface ReleaseRequest {
  id: number;
  propertyId: number;
  action: PublicationAction;
}

/** Identificador legible y estable de la version que produce una peticion. */
export function releaseIdFor(request: ReleaseRequest): string {
  return `${request.action}-p${request.propertyId}-r${request.id}`;
}

/** Los archivos de una ficha: portada, hero, galeria y panoramas del recorrido. */
function mediaIdsOfItem(item: PublicMediaItem | null, into: Set<number>): void {
  if (item === null) return;

  const id = mediaIdFromPublicUrl(item.url);
  if (id !== null) into.add(id);
}

/**
 * Los archivos que referencia un snapshot.
 *
 * Se recorre el snapshot y no la base a proposito: lo que importa no es que
 * archivos existen, sino cuales pide el HTML que se va a desplegar.
 */
export function releaseMediaIds(snapshot: PublicSnapshot): number[] {
  const ids = new Set<number>();

  for (const locale of ['es', 'en'] as const) {
    for (const property of snapshot.properties[locale]) {
      mediaIdsOfItem(property.media.cover, ids);
      mediaIdsOfItem(property.media.hero, ids);
      for (const item of property.media.items) mediaIdsOfItem(item, ids);

      for (const node of property.tour?.nodes ?? []) {
        const id = mediaIdFromPublicUrl(node.url);
        if (id !== null) ids.add(id);
      }
    }
  }

  return [...ids].sort((a, b) => a - b);
}

/**
 * Construye la version candidata de una peticion.
 *
 * NO escribe nada. Se puede llamar tantas veces como haga falta, y dos
 * llamadas con la base igual dan el mismo resultado salvo por `generatedAt`.
 */
export async function buildReleaseCandidate(
  db: AdminDatabase,
  request: ReleaseRequest,
  now: Date = new Date(),
): Promise<ReleaseCandidate> {
  const snapshot = await buildCandidateSnapshot(
    db,
    { propertyId: request.propertyId, action: request.action },
    now,
  );

  return {
    snapshot,
    manifest: {
      releaseId: releaseIdFor(request),
      generatedAt: snapshot.generatedAt,
      mediaIds: releaseMediaIds(snapshot),
    },
  };
}

/**
 * Si la version desplegada admite servir un archivo.
 *
 * Sin manifiesto no hay nada que anadir y decide la base, como hasta ahora:
 * es lo que ocurre en desarrollo y en cualquier build que no venga del flujo
 * de publicacion. Con manifiesto, la lista blanca ACOTA lo que la base ya
 * hubiera permitido; nunca al reves.
 */
export function releaseAllowsMedia(manifest: ReleaseManifest | null, mediaId: number): boolean {
  return manifest === null || manifest.mediaIds.includes(mediaId);
}
