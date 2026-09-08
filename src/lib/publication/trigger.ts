/**
 * Quien construye y despliega el sitio.
 *
 * El Worker no puede ejecutar `astro build`: el sitio publico se genera en
 * otra maquina. Asi que la capa de publicacion no publica nada por si misma,
 * sino que ANOTA la peticion y avisa a quien si puede. Este archivo es esa
 * frontera, y a proposito no sabe nada de GitHub, de Actions ni de
 * Cloudflare: recibe un trabajo y dice si lo acepto.
 *
 * En esta fase la unica implementacion es manual: sirve para desarrollo y
 * para probar el protocolo completo sin tocar ningun recurso remoto. La
 * implementacion real llegara detras de esta misma interfaz, sin que cambie
 * nada de lo que hay a este lado.
 *
 * El token de callback pasa por aqui en claro porque es justo lo que hay que
 * entregar a quien va a confirmar el resultado. Ninguna implementacion debe
 * registrarlo en un log.
 */

import type { PublicationAction } from '../domain/vocabularies';

/** Lo que se le encarga a quien construye. */
export interface PublishTriggerJob {
  requestId: number;
  propertyId: number;
  action: PublicationAction;
  /** La credencial con la que se confirmara el resultado. En claro. */
  callbackToken: string;
  /** Donde confirmarlo. Ruta del sitio, sin dominio. */
  callbackPath: string;
}

export interface PublishTriggerAccepted {
  ok: true;
  /**
   * Referencia opaca del trabajo, si el ejecutor la da (el id de un run, por
   * ejemplo). Solo sirve para poder mirarlo por fuera.
   */
  jobRef?: string;
  /**
   * Instrucciones para completarlo a mano.
   *
   * Solo la devuelve un ejecutor manual de desarrollo, y contiene el token en
   * claro: quien la reciba debe tratarla como el propio secreto.
   */
  manual?: ManualInstructions;
}

export interface ManualInstructions {
  callbackPath: string;
  callbackToken: string;
}

export interface PublishTriggerRejected {
  ok: false;
  /** Motivo corto y sin detalles internos: acaba en el panel. */
  error: string;
}

export type PublishTriggerResult = PublishTriggerAccepted | PublishTriggerRejected;

export interface PublishTrigger {
  /** Identifica al ejecutor en el registro de la peticion. */
  readonly name: string;
  start(job: PublishTriggerJob): Promise<PublishTriggerResult>;
}

/**
 * Ejecutor manual.
 *
 * No lanza nada: acepta el trabajo y se queda esperando a que una persona
 * construya y despliegue, y confirme despues con el callback. Es lo que
 * permite recorrer el protocolo entero en local sin crear ningun recurso.
 *
 * `exposeToken` solo debe activarse en desarrollo: es lo que hace que el
 * token vuelva al panel para poder completar el flujo a mano.
 */
export function manualPublishTrigger(options: { exposeToken?: boolean } = {}): PublishTrigger {
  return {
    name: 'manual',
    start(job) {
      return Promise.resolve({
        ok: true,
        jobRef: `manual:${job.requestId}`,
        ...(options.exposeToken === true
          ? { manual: { callbackPath: job.callbackPath, callbackToken: job.callbackToken } }
          : {}),
      });
    },
  };
}
