/**
 * Publicar y retirar una propiedad.
 *
 * El problema que resuelve este archivo es de ORDEN, no de permisos. El sitio
 * publico es estatico: se genera leyendo que propiedades son publicas y se
 * despliega. Si se marcara la propiedad como `published` antes del build, un
 * fallo dejaria la base afirmando algo que la web no dice; si se marcara
 * despues, el build habria corrido cuando todavia era `approved` y la web
 * desplegada no la contendria.
 *
 * La salida es no mover el estado editorial hasta tener confirmacion, y
 * anotar mientras tanto una PETICION duradera:
 *
 *   1. el admin pide publicar. Se valida la ficha, se anota la peticion y se
 *      avisa a quien construye. La propiedad sigue en `approved`;
 *   2. quien construye genera la version candidata —el sitio tal como
 *      quedaria— y la despliega;
 *   3. confirma el resultado con el token de la peticion. Solo entonces la
 *      propiedad pasa a `published`.
 *
 * Si algo falla en cualquier punto, la peticion queda en `failed` y la
 * propiedad no se ha movido: la release publica anterior sigue intacta y
 * volver a intentarlo es pedirlo otra vez.
 *
 * Retirar es la misma coreografia al reves, y devuelve la propiedad a
 * `approved`. No hay un estado editorial nuevo para nada de esto: el estado
 * de la OPERACION vive en `publication_requests`.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  properties,
  propertyMedia,
  propertyTourNodes,
  propertyTranslations,
  publicationRequests,
} from '../../db/schema';
import { updatePropertyStatus } from '../admin/properties/update-property-status';
import { fail, isUniqueViolation, ok, type AdminDatabase, type AdminResult } from '../admin/types';
import {
  validatePropertyForPublication,
  type PropertyForPublication,
  type PublicationIssue,
} from '../domain/publication';
import {
  ACTIVE_PUBLICATION_REQUEST_STATUSES,
  type PublicationAction,
  type PublicationRequestStatus,
  type PublicationStatus,
} from '../domain/vocabularies';
import {
  generateSecretToken,
  hashSecretToken,
  looksLikeSecretToken,
} from '../security/secret-token';
import type { ManualInstructions, PublishTrigger } from './trigger';

/* -------------------------------------------------------------------------- */
/* Forma                                                                      */
/* -------------------------------------------------------------------------- */

/** Donde se confirma el resultado de un build. El token NO viaja en la ruta. */
export const CALLBACK_PATH = '/api/publication/callback';

/** Lo que cabe en `error_summary`: un motivo, no una traza. */
export const MAX_ERROR_SUMMARY = 200;

export interface PublicationRequestView {
  id: number;
  propertyId: number;
  action: PublicationAction;
  status: PublicationRequestStatus;
  jobRef: string | null;
  errorSummary: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Derivado: sigue viva y bloquea otra operacion sobre la misma propiedad. */
  isActive: boolean;
}

export interface PublicationStateView {
  propertyId: number;
  publicationStatus: PublicationStatus;
  /** Si hoy se podria pedir cada operacion. */
  canPublish: boolean;
  canUnpublish: boolean;
  /**
   * Que le falta a la ficha para poder publicarse.
   *
   * Solo se calcula cuando el estado editorial lo permite: en un borrador la
   * lista seria ruido, porque lo que falta primero es la revision.
   */
  issues: PublicationIssue[];
  /** La operacion viva, si la hay. */
  current: PublicationRequestView | null;
  /** Historial reciente, la mas nueva primero. */
  history: PublicationRequestView[];
}

/** Lo que se devuelve al pedir una operacion. */
export interface PublicationTicket {
  request: PublicationRequestView;
  /**
   * Instrucciones del ejecutor manual, con el token en claro.
   *
   * Solo aparece con el ejecutor manual de desarrollo. En cualquier otro caso
   * es `null` y el token no sale de aqui.
   */
  manual: ManualInstructions | null;
}

export interface FinalizationResult {
  request: PublicationRequestView;
  publicationStatus: PublicationStatus;
}

/** Cuantas operaciones pasadas se enseñan en el panel. */
const HISTORY_LIMIT = 10;

function requestView(row: typeof publicationRequests.$inferSelect): PublicationRequestView {
  return {
    id: row.id,
    propertyId: row.propertyId,
    action: row.action,
    status: row.status,
    jobRef: row.jobRef,
    errorSummary: row.errorSummary,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    isActive: ACTIVE_PUBLICATION_REQUEST_STATUSES.includes(row.status),
  };
}

/** Recorta y limpia un motivo de fallo antes de guardarlo. */
export function summarizeError(reason: string): string {
  const clean = reason.replace(/\s+/g, ' ').trim();

  return clean.length > MAX_ERROR_SUMMARY ? `${clean.slice(0, MAX_ERROR_SUMMARY - 1)}…` : clean;
}

/* -------------------------------------------------------------------------- */
/* Lectura                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Carga la ficha con lo que necesita el validador de publicacion.
 *
 * Se lee lo justo: la regla de "esta lista para publicarse" ya existe en
 * `src/lib/domain/publication.ts` y no se reescribe aqui.
 */
async function loadForPublication(
  db: AdminDatabase,
  propertyId: number,
): Promise<PropertyForPublication | null> {
  const found = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);

  const property = found[0];
  if (property === undefined) return null;

  const translations = await db
    .select({
      locale: propertyTranslations.locale,
      slug: propertyTranslations.slug,
      title: propertyTranslations.title,
    })
    .from(propertyTranslations)
    .where(eq(propertyTranslations.propertyId, propertyId));

  const media = await db
    .select({
      id: propertyMedia.id,
      propertyId: propertyMedia.propertyId,
      mediaKind: propertyMedia.mediaKind,
      isHero: propertyMedia.isHero,
      isCatalogCover: propertyMedia.isCatalogCover,
    })
    .from(propertyMedia)
    .where(eq(propertyMedia.propertyId, propertyId));

  const tourNodes = await db
    .select({
      id: propertyTourNodes.id,
      propertyId: propertyTourNodes.propertyId,
      propertyMediaId: propertyTourNodes.propertyMediaId,
      isStart: propertyTourNodes.isStart,
    })
    .from(propertyTourNodes)
    .where(eq(propertyTourNodes.propertyId, propertyId));

  return {
    id: property.id,
    code: property.code,
    propertyTypeId: property.propertyTypeId,
    publicationStatus: property.publicationStatus,
    priceMode: property.priceMode,
    priceAmountMinor: property.priceAmountMinor,
    currencyCode: property.currencyCode,
    areaSquareMeters: property.areaSquareMeters,
    publicLatitude: property.publicLatitude,
    publicLongitude: property.publicLongitude,
    locationPrecision: property.locationPrecision,
    translations,
    media,
    tourNodes,
  };
}

async function activeRequestOf(
  db: AdminDatabase,
  propertyId: number,
): Promise<typeof publicationRequests.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(publicationRequests)
    .where(
      and(
        eq(publicationRequests.propertyId, propertyId),
        inArray(publicationRequests.status, [...ACTIVE_PUBLICATION_REQUEST_STATUSES]),
      ),
    )
    .limit(1);

  return rows[0];
}

export async function getPublicationState(
  db: AdminDatabase,
  propertyId: number,
): Promise<AdminResult<PublicationStateView>> {
  const property = await loadForPublication(db, propertyId);
  if (property === null) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const rows = await db
    .select()
    .from(publicationRequests)
    .where(eq(publicationRequests.propertyId, propertyId))
    .orderBy(desc(publicationRequests.id))
    .limit(HISTORY_LIMIT);

  const history = rows.map(requestView);
  const current = history.find((request) => request.isActive) ?? null;

  const status = property.publicationStatus;
  const check = status === 'approved' ? validatePropertyForPublication(property) : null;

  return ok({
    propertyId,
    publicationStatus: status,
    // Con una operacion viva no se puede pedir otra, sea cual sea el estado.
    canPublish: status === 'approved' && current === null && check?.valid === true,
    canUnpublish: status === 'published' && current === null,
    issues: check === null ? [] : check.issues,
    current,
    history,
  });
}

/* -------------------------------------------------------------------------- */
/* Peticion                                                                   */
/* -------------------------------------------------------------------------- */

export interface RequestPublicationInput {
  propertyId: number;
  action: PublicationAction;
  trigger: PublishTrigger;
  now?: Date;
}

/**
 * Pide publicar o retirar.
 *
 * Lo que NO hace: cambiar el estado editorial. La propiedad se queda donde
 * estaba hasta que vuelva la confirmacion, y por eso una peticion fallida no
 * deja nada que deshacer.
 *
 * El orden importa: primero se comprueba que la operacion tiene sentido,
 * despues se anota, y solo entonces se avisa al ejecutor. Anotar antes de
 * avisar es lo que permite que un fallo del ejecutor quede registrado en vez
 * de perderse.
 */
export async function requestPublication(
  db: AdminDatabase,
  input: RequestPublicationInput,
): Promise<AdminResult<PublicationTicket>> {
  const { propertyId, action, trigger } = input;
  const now = input.now ?? new Date();

  const property = await loadForPublication(db, propertyId);
  if (property === null) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const status = property.publicationStatus;

  if (action === 'publish' && status !== 'approved') {
    return fail({
      code: 'publication_not_allowed',
      message: 'Solo se publica una propiedad aprobada.',
      field: 'publicationStatus',
    });
  }

  if (action === 'unpublish' && status !== 'published') {
    return fail({
      code: 'publication_not_allowed',
      message: 'Solo se retira una propiedad publicada.',
      field: 'publicationStatus',
    });
  }

  /*
   * La ficha incompleta se detiene ANTES de anotar nada: una peticion que no
   * podia salir bien no tiene por que dejar rastro.
   */
  if (action === 'publish') {
    const check = validatePropertyForPublication(property);

    if (!check.valid) {
      return fail({
        code: 'publication_incomplete',
        message: 'La ficha todavia no esta lista para publicarse.',
        issues: check.issues.map((issue) => ({
          path: issue.field ?? issue.section,
          message: issue.message,
        })),
      });
    }
  }

  const active = await activeRequestOf(db, propertyId);
  if (active !== undefined) {
    return fail({
      code: 'publication_in_progress',
      message: 'Esta propiedad ya tiene una operacion de publicacion en curso.',
    });
  }

  const token = generateSecretToken();

  let created: typeof publicationRequests.$inferSelect | undefined;

  try {
    const inserted = await db
      .insert(publicationRequests)
      .values({
        propertyId,
        action,
        status: 'pending',
        callbackTokenHash: await hashSecretToken(token),
        requestedAt: now,
      })
      .returning();

    created = inserted[0];
  } catch (error) {
    /*
     * El indice unico parcial es lo que decide de verdad: si dos peticiones
     * llegan a la vez, la comprobacion de arriba puede pasar en las dos y solo
     * una entra. La otra acaba aqui, no en una segunda operacion viva.
     */
    if (isUniqueViolation(error)) {
      return fail({
        code: 'publication_in_progress',
        message: 'Esta propiedad ya tiene una operacion de publicacion en curso.',
      });
    }

    throw error;
  }

  if (created === undefined) {
    return fail({ code: 'publication_failed', message: 'No se pudo anotar la peticion.' });
  }

  const requestId = created.id;

  let result;
  try {
    result = await trigger.start({
      requestId,
      propertyId,
      action,
      callbackToken: token,
      callbackPath: CALLBACK_PATH,
    });
  } catch (error) {
    /* El detalle no sale de aqui; en el panel queda un motivo generico. */
    console.error('[publicacion] el ejecutor fallo al aceptar el trabajo:', error);
    result = { ok: false as const, error: 'El ejecutor no acepto el trabajo.' };
  }

  if (!result.ok) {
    const failed = await markFailed(db, requestId, result.error, now);

    return fail({
      code: 'publication_trigger_failed',
      message:
        failed === null
          ? 'No se pudo lanzar la publicacion.'
          : `No se pudo lanzar la publicacion: ${failed.errorSummary ?? result.error}`,
    });
  }

  const updated = await db
    .update(publicationRequests)
    .set({
      status: 'building',
      startedAt: now,
      jobRef: result.jobRef ?? trigger.name,
      updatedAt: now,
    })
    .where(eq(publicationRequests.id, requestId))
    .returning();

  const row = updated[0];
  if (row === undefined) {
    return fail({ code: 'publication_failed', message: 'No se pudo anotar la peticion.' });
  }

  return ok({ request: requestView(row), manual: result.manual ?? null });
}

/** Cierra una peticion como fallida. */
async function markFailed(
  db: AdminDatabase,
  requestId: number,
  reason: string,
  now: Date,
): Promise<PublicationRequestView | null> {
  const updated = await db
    .update(publicationRequests)
    .set({
      status: 'failed',
      errorSummary: summarizeError(reason),
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(publicationRequests.id, requestId))
    .returning();

  const row = updated[0];

  return row === undefined ? null : requestView(row);
}

/* -------------------------------------------------------------------------- */
/* Confirmacion                                                               */
/* -------------------------------------------------------------------------- */

/** Lo que cuenta quien construyo el sitio. Nada mas: ni propiedad, ni estado. */
export type PublicationOutcome = { ok: true } | { ok: false; error?: string };

/**
 * Cierra una peticion con el resultado del build.
 *
 * El token es la unica credencial y lo unico que identifica la operacion: el
 * cliente no dice sobre que propiedad actua ni a que estado ir, porque eso ya
 * lo decidio el admin cuando la pidio. Aceptarlo del cuerpo convertiria este
 * endpoint en un "pon esta propiedad como quieras".
 *
 * Devuelve el mismo fallo indistinguible para el token que no existe, el que
 * ya se uso y el de una peticion ya cerrada. Esa indistinguibilidad es
 * deliberada, y es tambien lo que hace segura la repeticion: un segundo
 * callback no vuelve a transicionar nada.
 */
export async function finalizePublication(
  db: AdminDatabase,
  rawToken: string,
  outcome: PublicationOutcome,
  now: Date = new Date(),
): Promise<AdminResult<FinalizationResult>> {
  const invalid = fail<FinalizationResult>({
    code: 'publication_link_invalid',
    message: 'Esta confirmacion no es valida.',
  });

  if (!looksLikeSecretToken(rawToken)) return invalid;

  /* Se busca POR HASH sobre su indice unico: el secreto no se compara con nada. */
  const rows = await db
    .select()
    .from(publicationRequests)
    .where(eq(publicationRequests.callbackTokenHash, await hashSecretToken(rawToken)))
    .limit(1);

  const request = rows[0];
  if (request === undefined) return invalid;

  // Ya cerrada: el token murio con ella y no se vuelve a aplicar nada.
  if (!ACTIVE_PUBLICATION_REQUEST_STATUSES.includes(request.status)) return invalid;

  if (!outcome.ok) {
    const failed = await markFailed(
      db,
      request.id,
      outcome.error === undefined || outcome.error.trim().length === 0
        ? 'El build no termino correctamente.'
        : outcome.error,
      now,
    );

    if (failed === null) {
      return fail({ code: 'publication_failed', message: 'No se pudo cerrar la peticion.' });
    }

    // El estado editorial no se ha tocado: la web anterior sigue siendo la buena.
    const current = await db
      .select({ publicationStatus: properties.publicationStatus })
      .from(properties)
      .where(eq(properties.id, request.propertyId))
      .limit(1);

    return ok({
      request: failed,
      publicationStatus: current[0]?.publicationStatus ?? 'draft',
    });
  }

  const nextStatus: PublicationStatus = request.action === 'publish' ? 'published' : 'approved';

  /*
   * La transicion se pide con alcance `publication`, que es el unico modo de
   * alcanzar `approved <-> published`. Si entre medias alguien archivo la
   * propiedad, la maquina de estados lo rechaza y la peticion queda fallida:
   * es preferible a forzar un estado que ya no encaja.
   */
  const moved = await updatePropertyStatus(db, request.propertyId, nextStatus, {
    scope: 'publication',
    now,
  });

  if (!moved.ok) {
    const failed = await markFailed(db, request.id, moved.error.message, now);

    return fail({
      code: 'publication_failed',
      message: failed === null ? 'No se pudo cerrar la peticion.' : moved.error.message,
    });
  }

  const updated = await db
    .update(publicationRequests)
    .set({ status: 'done', errorSummary: null, finishedAt: now, updatedAt: now })
    .where(eq(publicationRequests.id, request.id))
    .returning();

  const row = updated[0];
  if (row === undefined) {
    return fail({ code: 'publication_failed', message: 'No se pudo cerrar la peticion.' });
  }

  return ok({ request: requestView(row), publicationStatus: moved.data.publicationStatus });
}
