/** Textos del panel historico, desconectado de la interfaz R1. */
interface PublicationRequest {
  id: number;
  action: string;
  status: string;
  errorSummary: string | null;
  requestedAt: string;
  finishedAt: string | null;
  isActive: boolean;
}

/** Lo que contesta una comprobacion de "¿ya está publicado?". */
type ReconciliationReason =
  'applied' | 'nothing_to_reconcile' | 'release_mismatch' | 'no_release_deployed';

/**
 * Como se cuenta el resultado de una comprobacion.
 *
 * Cuando la version en linea es otra NO se dice "ha fallado": no se sabe. Se
 * dice lo unico cierto —que esta version no es la de esta operacion— y no se
 * toca nada.
 */
export function reconciliationMessage(reason: ReconciliationReason): {
  text: string;
  kind: 'ok' | 'warn';
} {
  if (reason === 'applied') {
    /* Vale igual para publicar y para retirar: lo que ya está en línea es el cambio. */
    return { text: 'El cambio ya está en línea: la operación queda cerrada.', kind: 'ok' };
  }

  if (reason === 'nothing_to_reconcile') {
    return { text: 'No hay ninguna operación pendiente.', kind: 'ok' };
  }

  return {
    text:
      'La versión que está en línea no es la de esta operación, así que todavía no se ha ' +
      'desplegado. No se ha cambiado nada: vuelve a comprobarlo cuando termine.',
    kind: 'warn',
  };
}

export const ACTION_LABELS: Record<string, string> = {
  publish: 'Publicación',
  unpublish: 'Retirada',
  /*
   * "Del sitio" y no "global": quien mira la pantalla no piensa en alcances,
   * piensa en que ha cambiado el nombre del negocio y quiere verlo publicado.
   */
  publish_site: 'Publicación del sitio',
};

/**
 * Como se cuenta el estado de una operacion.
 *
 * Ni una palabra sobre builds ni sobre proveedores: lo unico que le importa a
 * quien mira es si ya esta, si sigue en marcha o si hay que volver a
 * intentarlo.
 */
export function requestSummary(request: PublicationRequest): string {
  const what = ACTION_LABELS[request.action] ?? 'Operación';

  if (request.status === 'pending') return `${what} anotada. Preparando…`;
  if (request.status === 'building') return `${what} en curso. Todavía no está en la web.`;
  if (request.status === 'done') return `${what} completada.`;

  /*
   * Abandonada NO es fallida: nadie ha dicho que saliera mal, solo que se
   * dejo de esperar. Confundirlas seria escribir en pantalla algo que la base
   * no afirma.
   */
  if (request.status === 'abandoned') {
    return request.errorSummary === null
      ? `${what} abandonada. No se publicó ni se retiró nada.`
      : `${what} abandonada: ${request.errorSummary}`;
  }

  return request.errorSummary === null
    ? `${what} fallida. Vuelve a intentarlo.`
    : `${what} fallida: ${request.errorSummary}`;
}
