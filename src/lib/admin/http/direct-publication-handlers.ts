import {
  getDirectPublicationState,
  publishProperty,
  unpublishProperty,
} from '../properties/direct-publication';
import { parseRouteId, requireAdminAccess, requireSameOrigin } from './guard';
import type { AdminHttpContext } from './handlers';
import { jsonError, jsonFromResult, jsonInternalError } from './responses';

async function handle(
  ctx: AdminHttpContext,
  action: 'get' | 'publish' | 'unpublish',
): Promise<Response> {
  try {
    const auth = await requireAdminAccess(
      ctx.request,
      ctx.env,
      ctx.accessKeyResolver === undefined ? {} : { keyResolver: ctx.accessKeyResolver },
    );
    if (auth.denied !== null) return auth.denied;
    const crossOrigin = requireSameOrigin(ctx.request);
    if (crossOrigin !== null) return crossOrigin;
    const id = parseRouteId(ctx.params.id);
    if (id === null)
      return jsonError('validation_failed', 'El identificador debe ser un entero positivo.', 422);
    const operation =
      action === 'publish'
        ? publishProperty
        : action === 'unpublish'
          ? unpublishProperty
          : getDirectPublicationState;
    return jsonFromResult(await operation(ctx.db, id));
  } catch (error) {
    return jsonInternalError(error);
  }
}

export const handleDirectPublicationState = (ctx: AdminHttpContext) => handle(ctx, 'get');
export const handlePublishProperty = (ctx: AdminHttpContext) => handle(ctx, 'publish');
export const handleUnpublishProperty = (ctx: AdminHttpContext) => handle(ctx, 'unpublish');
