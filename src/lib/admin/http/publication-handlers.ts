/**
 * Handlers HTTP de la publicacion.
 *
 * Misma envoltura que el resto del panel: acceso de Access, mismo origen y
 * `Cache-Control: no-store`.
 *
 * Seis puertas y ninguna mas: consultar el estado, pedir publicar, pedir
 * retirar, reconciliar una operacion cuyo callback se perdio, abandonarla
 * cuando nadie puede saber que paso, y preguntar que version esta ejecutando
 * el artefacto. Ninguna acepta un estado editorial en
 * el cuerpo —la accion la dice la RUTA— y ninguna publica nada por si misma:
 * solo anotan la peticion y avisan al ejecutor.
 *
 * El token de callback no se devuelve al navegador salvo con el ejecutor
 * manual de desarrollo, que es el unico que necesita que una persona lo
 * copie para completar el flujo a mano.
 */

import { z } from 'zod';

import { describeRelease } from '../../publication/release';
import {
  abandonPublication,
  MAX_ABANDON_REASON,
  getPublicationState,
  reconcilePublication,
  requestPublication,
  type PublicationTicket,
} from '../../publication/publication';
import { manualPublishTrigger, type PublishTrigger } from '../../publication/trigger';
import type { AdminResult } from '../types';
import { parseRouteId, readJsonBody, requireAdminAccess, requireSameOrigin } from './guard';
import { jsonError, jsonFromAdminError, jsonInternalError, jsonSuccess } from './responses';
import type { AdminHttpContext } from './handlers';

/** Misma envoltura que el resto de handlers administrativos. */
async function handle(ctx: AdminHttpContext, run: () => Promise<Response>): Promise<Response> {
  try {
    const auth = await requireAdminAccess(
      ctx.request,
      ctx.env,
      ctx.accessKeyResolver === undefined ? {} : { keyResolver: ctx.accessKeyResolver },
    );
    if (auth.denied !== null) return auth.denied;

    const crossOrigin = requireSameOrigin(ctx.request);
    if (crossOrigin !== null) return crossOrigin;

    return await run();
  } catch (error) {
    return jsonInternalError(error);
  }
}

function invalidId(): Response {
  return jsonError('validation_failed', 'El identificador debe ser un entero positivo.', 422, {
    field: 'id',
  });
}

/**
 * El ejecutor por defecto.
 *
 * Manual mientras no exista el flujo de CI. `exposeToken` solo se activa en
 * una build de desarrollo, que es cuando hace falta completar el callback a
 * mano; en produccion el token no llega nunca al navegador.
 */
function defaultTrigger(ctx: AdminHttpContext): PublishTrigger {
  return manualPublishTrigger({ exposeToken: ctx.env.isDev === true });
}

export function handleGetPublication(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    const state = await getPublicationState(ctx.db, id, ctx.deployedRelease ?? null);
    if (!state.ok) return jsonFromAdminError(state.error);

    /*
     * Se acompaña de la version que ejecuta el artefacto: con las dos cosas el
     * panel puede distinguir "esperando" de "esto ya deberia haber terminado",
     * sin inventarse ningun estado.
     */
    return jsonSuccess({ ...state.data, deployed: describeRelease(ctx.deployedRelease ?? null) });
  });
}

/**
 * Responde a una peticion recien creada.
 *
 * Se devuelve el estado completo —lo que el panel necesita pintar— y, solo si
 * el ejecutor manual las dio, las instrucciones para confirmar a mano.
 */
async function ticketResponse(
  ctx: AdminHttpContext,
  propertyId: number,
  result: AdminResult<PublicationTicket>,
): Promise<Response> {
  if (!result.ok) return jsonFromAdminError(result.error);

  const state = await getPublicationState(ctx.db, propertyId, ctx.deployedRelease ?? null);
  if (!state.ok) return jsonFromAdminError(state.error);

  return jsonSuccess({
    publication: state.data,
    deployed: describeRelease(ctx.deployedRelease ?? null),
    /*
     * Solo con el ejecutor manual. Lleva el token en claro, asi que viaja una
     * unica vez, en una respuesta `no-store` que no se vuelve a poder leer.
     */
    manual: result.data.manual,
  });
}

export function handleRequestPublish(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    /*
     * Sin cuerpo: la accion la dice la ruta. Aceptar un estado de publicacion
     * aqui seria reabrir la puerta que el flujo entero existe para cerrar.
     */
    const result = await requestPublication(ctx.db, {
      propertyId: id,
      action: 'publish',
      trigger: ctx.publishTrigger ?? defaultTrigger(ctx),
    });

    return ticketResponse(ctx, id, result);
  });
}

export function handleRequestUnpublish(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    const result = await requestPublication(ctx.db, {
      propertyId: id,
      action: 'unpublish',
      trigger: ctx.publishTrigger ?? defaultTrigger(ctx),
    });

    return ticketResponse(ctx, id, result);
  });
}

/* -------------------------------------------------------------------------- */
/* Reconciliacion y estado del artefacto                                      */
/* -------------------------------------------------------------------------- */

/**
 * Comprueba si la operacion viva ya esta desplegada.
 *
 * No recibe nada del cliente salvo la propiedad: la prueba de que el
 * despliegue ocurrio es el artefacto que atiende esta misma peticion, y eso no
 * se puede enviar en un cuerpo. Repetirla es inofensivo.
 */
export function handleReconcilePublication(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    const result = await reconcilePublication(ctx.db, id, ctx.deployedRelease ?? null);
    if (!result.ok) return jsonFromAdminError(result.error);

    const state = await getPublicationState(ctx.db, id, ctx.deployedRelease ?? null);
    if (!state.ok) return jsonFromAdminError(state.error);

    return jsonSuccess({
      reconciliation: {
        reconciled: result.data.reconciled,
        reason: result.data.reason,
        deployedReleaseId: result.data.deployedReleaseId,
      },
      publication: state.data,
      deployed: describeRelease(ctx.deployedRelease ?? null),
    });
  });
}

/**
 * Abandona la operacion viva.
 *
 * Es una decision humana y se trata como tal: el motivo llega en el cuerpo, la
 * confirmacion la pide el panel, y aqui solo se comprueba que la operacion no
 * este ya demostrada por el artefacto —en ese caso se rechaza y se manda
 * reconciliar—.
 *
 * No publica ni despublica nada.
 */
const abandonSchema = z.strictObject({
  reason: z.string().max(MAX_ABANDON_REASON).nullish(),
});

export function handleAbandonPublication(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    const body = await readJsonBody(ctx.request, { allowEmpty: true });
    if (!body.ok) return body.response;

    const parsed = abandonSchema.safeParse(body.value);
    if (!parsed.success) {
      return jsonError('validation_failed', 'Motivo invalido.', 422, { field: 'reason' });
    }

    const result = await abandonPublication(
      ctx.db,
      id,
      ctx.deployedRelease ?? null,
      parsed.data.reason ?? null,
    );

    if (!result.ok) return jsonFromAdminError(result.error);

    const state = await getPublicationState(ctx.db, id, ctx.deployedRelease ?? null);
    if (!state.ok) return jsonFromAdminError(state.error);

    return jsonSuccess({
      abandoned: result.data.request,
      publication: state.data,
      deployed: describeRelease(ctx.deployedRelease ?? null),
    });
  });
}

/**
 * Que version esta ejecutando el artefacto que responde.
 *
 * Protegido como el resto del panel aunque no diga nada secreto: es
 * informacion de despliegue, y no tiene por que estar en la calle. `null`
 * significa que esta version no salio de una operacion de publicacion.
 */
export function handleGetDeployedRelease(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, () =>
    Promise.resolve(jsonSuccess({ deployed: describeRelease(ctx.deployedRelease ?? null) })),
  );
}
