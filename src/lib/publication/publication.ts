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
import type { ReleaseManifest } from './release';
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
   * Si tiene sentido ofrecer abandonar la operacion viva.
   *
   * Falso cuando no hay ninguna, y tambien cuando el artefacto desplegado es
   * justo el de esa operacion: entonces la respuesta no es abandonar, es
   * reconciliar.
   */
  canAbandon: boolean;
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

/**
 * El estado que ve el panel.
 *
 * Recibe el manifiesto del artefacto que atiende la peticion porque una de las
 * respuestas depende de el: si esta misma operacion ya esta desplegada, lo que
 * toca es reconciliar y NO se ofrece abandonarla. Esa regla vive aqui y no en
 * la pantalla, para que el panel no tenga que comparar releases por su cuenta.
 */
export async function getPublicationState(
  db: AdminDatabase,
  propertyId: number,
  deployed: ReleaseManifest | null = null,
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
    /*
     * Abandonar solo tiene sentido mientras no haya forma de saber que paso.
     * Si el artefacto desplegado ES el de esta operacion, si la hay.
     */
    canAbandon: current !== null && !(deployed !== null && deployed.requestId === current.id),
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

/* -------------------------------------------------------------------------- */
/* Finales                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Como termina una peticion. Tres desenlaces, y significan cosas distintas.
 *
 * - `succeeded`: el cambio esta en la web y la propiedad se mueve;
 * - `failed`: consta que algo salio mal;
 * - `abandoned`: una persona decidio dejarlo. NO se afirma que el build o el
 *   despliegue fallaran; se afirma que nadie va a seguir esperando.
 *
 * Meter el abandono en `failed` seria escribir en la base algo que nadie sabe.
 */
export type PublicationEnding =
  | { kind: 'succeeded' }
  | { kind: 'failed'; reason: string }
  | { kind: 'abandoned'; reason: string };

/** El estado con el que queda una peticion segun como termine. */
const STATUS_BY_ENDING = {
  succeeded: 'done',
  failed: 'failed',
  abandoned: 'abandoned',
} as const satisfies Record<PublicationEnding['kind'], PublicationRequestStatus>;

/**
 * El unico sitio que escribe un estado terminal.
 *
 * Todo lo que termina una peticion pasa por aqui: el callback, la
 * reconciliacion, el fallo del ejecutor y el abandono. Tener una sola puerta
 * es lo que impide que aparezcan dos maneras distintas de cerrar lo mismo, y
 * lo que hace que "ya no esta viva" signifique siempre lo mismo.
 *
 * No toca la propiedad. Mover el estado editorial es decision de quien llama,
 * y solo un exito lo hace.
 */
async function finishRequest(
  db: AdminDatabase,
  requestId: number,
  ending: PublicationEnding,
  now: Date,
): Promise<PublicationRequestView | null> {
  const updated = await db
    .update(publicationRequests)
    .set({
      status: STATUS_BY_ENDING[ending.kind],
      errorSummary: ending.kind === 'succeeded' ? null : summarizeError(ending.reason),
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(publicationRequests.id, requestId))
    .returning();

  const row = updated[0];

  return row === undefined ? null : requestView(row);
}

/** Cierra una peticion como fallida. */
async function markFailed(
  db: AdminDatabase,
  requestId: number,
  reason: string,
  now: Date,
): Promise<PublicationRequestView | null> {
  return finishRequest(db, requestId, { kind: 'failed', reason }, now);
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

  return applyOutcome(db, request, outcome, now);
}

/**
 * Cierra una peticion VIVA con un resultado.
 *
 * Es el unico sitio donde una peticion deja de estar viva y donde se aplica la
 * transicion editorial. Da igual como se haya llegado —con el token del
 * callback o reconciliando contra el artefacto desplegado—: las dos puertas
 * pasan por aqui, asi que no puede haber dos maneras distintas de terminar
 * una publicacion.
 *
 * Quien llama es responsable de haber comprobado que la peticion sigue viva.
 * Esa comprobacion es lo que impide transicionar dos veces.
 */
async function applyOutcome(
  db: AdminDatabase,
  request: typeof publicationRequests.$inferSelect,
  outcome: PublicationOutcome,
  now: Date,
): Promise<AdminResult<FinalizationResult>> {
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

  const row = await finishRequest(db, request.id, { kind: 'succeeded' }, now);
  if (row === null) {
    return fail({ code: 'publication_failed', message: 'No se pudo cerrar la peticion.' });
  }

  return ok({ request: row, publicationStatus: moved.data.publicationStatus });
}

/* -------------------------------------------------------------------------- */
/* Reconciliacion                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Por que una reconciliacion hizo o no hizo algo.
 *
 * - `applied`: el artefacto que responde lleva dentro esa release, luego el
 *   despliegue ocurrio y la operacion se cierra como exito;
 * - `nothing_to_reconcile`: no hay ninguna operacion viva. Es lo que devuelve
 *   una segunda llamada, y por eso repetir es inofensivo;
 * - `release_mismatch`: hay una operacion viva, pero el artefacto desplegado
 *   es otro;
 * - `no_release_deployed`: hay una operacion viva y el artefacto no afirma
 *   pertenecer a ninguna.
 */
export type ReconciliationReason =
  'applied' | 'nothing_to_reconcile' | 'release_mismatch' | 'no_release_deployed';

export interface ReconciliationResult {
  reconciled: boolean;
  reason: ReconciliationReason;
  publicationStatus: PublicationStatus;
  /** La operacion mirada, tal como queda despues. */
  request: PublicationRequestView | null;
  /** La release que dice llevar el artefacto que responde. */
  deployedReleaseId: string | null;
}

/**
 * Recupera una operacion cuyo callback se perdio.
 *
 * El caso real es este: el build se hizo, el sitio se desplego y la
 * confirmacion no llego —se cayo la red, el proceso murio al final—. La
 * peticion se queda viva para siempre, la propiedad bloqueada, y el token en
 * claro ya no existe en ninguna parte.
 *
 * La unica prueba admisible de que el despliegue ocurrio es el ARTEFACTO que
 * esta respondiendo: lleva dentro el manifiesto de la version que se genero,
 * con el numero de la peticion que la origino. Si coincide, no hay nada que
 * suponer —la web ya muestra el resultado— y la operacion se cierra como
 * exito por la misma via que un callback normal.
 *
 * Si NO coincide, no se toca nada. Y no se toca a proposito: que el artefacto
 * sea otro no demuestra que el despliegue fallara, solo que este no es.
 * Darlo por fallido dejaria la base afirmando lo contrario de lo que la web
 * muestra, que es justo la incoherencia que todo este flujo existe para
 * evitar. Por la misma razon no hay ninguna caducidad por tiempo: llevar
 * mucho rato viva no dice nada sobre lo que ocurrio.
 */
/* -------------------------------------------------------------------------- */
/* Abandono                                                                   */
/* -------------------------------------------------------------------------- */

/** Lo que queda escrito cuando nadie da un motivo. */
export const DEFAULT_ABANDON_REASON = 'Abandonada a mano, sin confirmacion del despliegue.';

/** Un motivo es una frase, no un informe. */
export const MAX_ABANDON_REASON = 200;

export interface AbandonResult {
  request: PublicationRequestView;
  publicationStatus: PublicationStatus;
}

/**
 * Abandona una operacion viva.
 *
 * Existe para el unico caso que la reconciliacion no puede resolver: la
 * operacion lleva ahi, el artefacto desplegado no la confirma, y nadie va a
 * poder averiguar nunca si el despliegue ocurrio. Alguien tiene que decidir, y
 * esta funcion es esa decision hecha explicita.
 *
 * Lo que hace, y solo esto: cierra la peticion como `abandoned`, guarda el
 * motivo y libera la propiedad para otra operacion. Lo que NO hace, y es lo
 * importante:
 *
 * - no toca `publicationStatus` ni `published_at`. Abandonar no publica ni
 *   despublica: la web se queda exactamente como este;
 * - no lo cuenta como fallo. `failed` significa "consta que salio mal", y aqui
 *   nadie lo sabe;
 * - no simula un callback. Nadie ha confirmado nada.
 *
 * El token de la peticion queda inservible por el mismo camino que el de una
 * peticion ya cerrada: la finalizacion solo acepta operaciones vivas.
 *
 * Y una puerta antes de todo eso: si el artefacto que responde SI lleva dentro
 * esta release, abandonar seria tirar informacion que si existe. En ese caso
 * se rechaza y se manda reconciliar, que es la respuesta correcta.
 */
export async function abandonPublication(
  db: AdminDatabase,
  propertyId: number,
  deployed: ReleaseManifest | null,
  reason: string | null = null,
  now: Date = new Date(),
): Promise<AdminResult<AbandonResult>> {
  const found = await db
    .select({ publicationStatus: properties.publicationStatus })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  const property = found[0];
  if (property === undefined) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const active = await activeRequestOf(db, propertyId);
  if (active === undefined) {
    return fail({
      code: 'publication_request_not_found',
      message: 'Esta propiedad no tiene ninguna operacion de publicacion en curso.',
      field: 'propertyId',
    });
  }

  /*
   * Si el artefacto desplegado ES el de esta operacion, no hay nada que
   * decidir: la prueba existe y lo que toca es reconciliar. Abandonarla
   * dejaria la base diciendo "no sabemos" sobre algo que si se sabe.
   */
  if (deployed !== null && deployed.requestId === active.id) {
    return fail({
      code: 'publication_must_reconcile',
      message: 'Esta operacion ya esta desplegada: reconciliala en vez de abandonarla.',
    });
  }

  const clean = reason?.trim();

  const abandoned = await finishRequest(
    db,
    active.id,
    {
      kind: 'abandoned',
      reason: clean === undefined || clean.length === 0 ? DEFAULT_ABANDON_REASON : clean,
    },
    now,
  );

  if (abandoned === null) {
    return fail({ code: 'publication_failed', message: 'No se pudo cerrar la peticion.' });
  }

  // La propiedad no se ha movido, y se devuelve tal cual estaba.
  return ok({ request: abandoned, publicationStatus: property.publicationStatus });
}

export async function reconcilePublication(
  db: AdminDatabase,
  propertyId: number,
  deployed: ReleaseManifest | null,
  now: Date = new Date(),
): Promise<AdminResult<ReconciliationResult>> {
  const found = await db
    .select({ publicationStatus: properties.publicationStatus })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  const property = found[0];
  if (property === undefined) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const active = await activeRequestOf(db, propertyId);
  const deployedReleaseId = deployed?.releaseId ?? null;

  if (active === undefined) {
    return ok({
      reconciled: false,
      reason: 'nothing_to_reconcile',
      publicationStatus: property.publicationStatus,
      request: null,
      deployedReleaseId,
    });
  }

  if (deployed === null) {
    return ok({
      reconciled: false,
      reason: 'no_release_deployed',
      publicationStatus: property.publicationStatus,
      request: requestView(active),
      deployedReleaseId,
    });
  }

  if (deployed.requestId !== active.id) {
    return ok({
      reconciled: false,
      reason: 'release_mismatch',
      publicationStatus: property.publicationStatus,
      request: requestView(active),
      deployedReleaseId,
    });
  }

  const finalized = await applyOutcome(db, active, { ok: true }, now);
  if (!finalized.ok) return finalized;

  return ok({
    reconciled: true,
    reason: 'applied',
    publicationStatus: finalized.data.publicationStatus,
    request: finalized.data.request,
    deployedReleaseId,
  });
}

/* -------------------------------------------------------------------------- */
/* Confirmacion de maquina                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Cierra una peticion como exito por peticion de quien la desplego.
 *
 * Es la misma comprobacion que hace un admin al reconciliar, y a proposito:
 * quien llama dice QUE peticion cree haber desplegado, pero quien lo demuestra
 * es el ARTEFACTO que atiende esta llamada. Si el manifiesto embebido no lleva
 * ese numero, no se publica nada por muy correcta que fuera la credencial.
 *
 * De ahi la propiedad que importa: una credencial de maquina robada no sirve
 * para publicar una propiedad cualquiera. Solo puede cerrar la operacion que
 * el codigo desplegado ya esta sirviendo, que es justo la que iba a cerrarse
 * de todas formas.
 */
export async function confirmDeployedRelease(
  db: AdminDatabase,
  requestId: number,
  deployed: ReleaseManifest | null,
  now: Date = new Date(),
): Promise<AdminResult<ReconciliationResult>> {
  const rows = await db
    .select({ propertyId: publicationRequests.propertyId, status: publicationRequests.status })
    .from(publicationRequests)
    .where(eq(publicationRequests.id, requestId))
    .limit(1);

  const request = rows[0];
  const deployedReleaseId = deployed?.releaseId ?? null;

  // Peticion inexistente o ya terminada: no hay nada que cerrar, ni se repite.
  if (request === undefined || !ACTIVE_PUBLICATION_REQUEST_STATUSES.includes(request.status)) {
    return ok({
      reconciled: false,
      reason: 'nothing_to_reconcile',
      publicationStatus: await publicationStatusOf(db, request?.propertyId ?? null),
      request: null,
      deployedReleaseId,
    });
  }

  if (deployed === null) {
    return ok({
      reconciled: false,
      reason: 'no_release_deployed',
      publicationStatus: await publicationStatusOf(db, request.propertyId),
      request: null,
      deployedReleaseId,
    });
  }

  /*
   * El artefacto manda. Si dice llevar otra release, esta llamada no prueba
   * nada sobre la que dice cerrar, y no se toca la base.
   */
  if (deployed.requestId !== requestId) {
    return ok({
      reconciled: false,
      reason: 'release_mismatch',
      publicationStatus: await publicationStatusOf(db, request.propertyId),
      request: null,
      deployedReleaseId,
    });
  }

  // Misma puerta que el admin: una sola forma de cerrar una publicacion.
  return reconcilePublication(db, request.propertyId, deployed, now);
}

/**
 * Deja constancia de que el build o el despliegue fallaron.
 *
 * Quien lo dice es el proceso que lo intento, asi que aqui SI se acepta su
 * palabra: un fallo no publica nada, no mueve la propiedad y no puede
 * convertirse en un exito. Lo peor que puede hacer una credencial robada por
 * esta puerta es dar por fallida una operacion que iba bien, y eso se arregla
 * pidiendola otra vez.
 *
 * Solo actua sobre operaciones vivas: repetirlo no vuelve a escribir nada.
 */
export async function reportPublicationFailure(
  db: AdminDatabase,
  requestId: number,
  reason: string | null = null,
  now: Date = new Date(),
): Promise<AdminResult<FinalizationResult>> {
  const rows = await db
    .select()
    .from(publicationRequests)
    .where(eq(publicationRequests.id, requestId))
    .limit(1);

  const request = rows[0];
  if (request === undefined || !ACTIVE_PUBLICATION_REQUEST_STATUSES.includes(request.status)) {
    return fail({
      code: 'publication_request_not_found',
      message: 'No hay ninguna operacion de publicacion viva con ese numero.',
      field: 'requestId',
    });
  }

  const clean = reason?.trim();

  return applyOutcome(
    db,
    request,
    {
      ok: false,
      ...(clean === undefined || clean.length === 0 ? {} : { error: clean }),
    },
    now,
  );
}

/** El estado editorial de una propiedad, o `draft` si ya no existe. */
async function publicationStatusOf(
  db: AdminDatabase,
  propertyId: number | null,
): Promise<PublicationStatus> {
  if (propertyId === null) return 'draft';

  const rows = await db
    .select({ publicationStatus: properties.publicationStatus })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows[0]?.publicationStatus ?? 'draft';
}
