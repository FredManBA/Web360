/**
 * Handlers HTTP de la revision privada.
 *
 * Misma envoltura que el resto del panel: acceso de Access, mismo origen y
 * `Cache-Control: no-store`.
 *
 * Aqui esta la unica respuesta de todo el proyecto que contiene un token en
 * claro: la de crear un enlace. Por eso no se cachea, no se registra y no
 * vuelve a poder leerse: consultar el estado devuelve si el enlace sigue vivo,
 * nunca el token.
 */

import { z } from 'zod';

import { getReviewState, requestReview, revokeReviewLinks } from '../../review/review';
import { parseRouteId, readJsonBody, requireAdminAccess, requireSameOrigin } from './guard';
import { jsonError, jsonFromResult, jsonInternalError, jsonSuccess } from './responses';
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

const requestSchema = z.strictObject({
  reviewerEmail: z.string().max(200).nullish(),
});

export function handleGetReview(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    return jsonFromResult(await getReviewState(ctx.db, id));
  });
}

/**
 * Abre una revision y devuelve el enlace.
 *
 * Es la unica respuesta que trae el token en claro, y llega una sola vez:
 * despues solo se puede saber si sigue activo.
 */
export function handleRequestReview(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    const body = await readJsonBody(ctx.request, { allowEmpty: true });
    if (!body.ok) return body.response;

    const parsed = requestSchema.safeParse(body.value);
    if (!parsed.success) {
      return jsonError('validation_failed', 'Datos invalidos.', 422, {
        field: parsed.error.issues[0]?.path.join('.') ?? undefined,
      });
    }

    const result = await requestReview(ctx.db, id, {
      ...(parsed.data.reviewerEmail === undefined
        ? {}
        : { reviewerEmail: parsed.data.reviewerEmail }),
    });

    if (!result.ok) return jsonFromResult(result);

    const state = await getReviewState(ctx.db, id);
    if (!state.ok) return jsonFromResult(state);

    return jsonSuccess({
      review: state.data,
      // Enseñalo ahora: no se vuelve a poder leer.
      token: result.data.token,
      expiresAt: result.data.expiresAt,
    });
  });
}

export function handleRevokeReviewLinks(ctx: AdminHttpContext): Promise<Response> {
  return handle(ctx, async () => {
    const id = parseRouteId(ctx.params.id);
    if (id === null) return invalidId();

    return jsonFromResult(await revokeReviewLinks(ctx.db, id));
  });
}
