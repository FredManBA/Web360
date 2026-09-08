import type { APIRoute } from 'astro';

import { toAdminContext } from '../../../../../../lib/admin/http/astro';
import { handleReconcilePublication } from '../../../../../../lib/admin/http/publication-handlers';

export const prerender = false;

/**
 * Comprueba si la operacion viva ya esta desplegada y, si lo esta, la cierra.
 *
 * La prueba es el artefacto que atiende esta misma peticion: lleva dentro el
 * manifiesto de la version que se genero. Si no coincide, no se supone nada.
 */
export const POST: APIRoute = (context) => handleReconcilePublication(toAdminContext(context));
