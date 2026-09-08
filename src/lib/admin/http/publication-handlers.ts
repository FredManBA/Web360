/**
 * Handlers HTTP de la publicacion.
 *
 * Misma envoltura que el resto del panel: acceso de Access, mismo origen y
 * `Cache-Control: no-store`.
 *
 * Tres puertas y ninguna mas: consultar el estado, pedir publicar y pedir
 * retirar. Ninguna acepta un estado editorial en el cuerpo —la accion la dice
 * la RUTA— y ninguna publica nada por si misma: solo anotan la peticion y
 * avisan al ejecutor.
 *
 * El token de callback no se devuelve al navegador salvo con el ejecutor
 * manual de desarrollo, que es el unico que necesita que una persona lo
 * copie para completar el flujo a mano.
 */

import {
  getPublicationState,
  requestPublication,
  type PublicationTicket,
} from '../../publication/publication';
import { manualPublishTrigger, type PublishTrigger } from '../../publication/trigger';
import type { AdminResult } from '../types';
import { parseRouteId, requireAdminAccess, requireSameOrigin } from './guard';
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

    const state = await getPublicationState(ctx.db, id);

    return state.ok ? jsonSuccess(state.data) : jsonFromAdminError(state.error);
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

  const state = await getPublicationState(ctx.db, propertyId);
  if (!state.ok) return jsonFromAdminError(state.error);

  return jsonSuccess({
    publication: state.data,
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
