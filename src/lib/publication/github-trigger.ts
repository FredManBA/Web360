/**
 * El ejecutor real: GitHub Actions.
 *
 * El Worker no puede construir ni desplegar el sitio, asi que lo que hace es
 * pedirle a Actions que lo haga. Esta es la unica pieza del proyecto que sabe
 * que existe GitHub, y detras de la misma interfaz `PublishTrigger` que usaba
 * el ejecutor manual: ni la capa de publicacion ni el panel se enteran.
 *
 * Lo que se manda, y sobre todo lo que NO:
 *
 * - se manda un unico input, `publicationRequestId`, que es un numero de fila
 *   y no un secreto. Con el, el workflow lee de la base que propiedad y que
 *   accion le tocan;
 * - NO se manda el token de callback, ni credenciales, ni nada sensible. Los
 *   inputs de un `workflow_dispatch` quedan a la vista de cualquiera que pueda
 *   leer los runs del repositorio, asi que meter ahi un secreto seria
 *   publicarlo. Lo que el runner necesita para autenticarse lo saca de sus
 *   propios secretos, no de aqui.
 *
 * Una limitacion de la API que conviene tener presente: el dispatch responde
 * `204 No Content`, sin cuerpo. No devuelve el id del run, asi que la
 * referencia que se guarda para diagnosticar se compone aqui con lo que si se
 * sabe —repositorio, workflow, rama y peticion—, y el workflow pone el numero
 * de peticion en el nombre del run para poder encontrarlo de un vistazo.
 */

import type { EnvLike } from '../public/d1-remote';
import { manualPublishTrigger, type PublishTrigger } from './trigger';

/** Variables que configuran el disparo. Nombres, no valores. */
export const GITHUB_ENV_KEYS = {
  repository: 'CODELOBA_GITHUB_REPOSITORY',
  workflow: 'CODELOBA_GITHUB_WORKFLOW',
  ref: 'CODELOBA_GITHUB_REF',
  token: 'CODELOBA_GITHUB_TOKEN',
} as const;

/**
 * Punto de entrada de la API, opcional.
 *
 * Existe para dos cosas legitimas: apuntar a un GitHub Enterprise, y poder
 * recorrer el ciclo entero en local contra un doble sin llamar a GitHub. No
 * es un secreto y no cambia nada de lo que se manda; solo a donde.
 */
const API_BASE_KEY = 'CODELOBA_GITHUB_API_BASE';

export interface GitHubTriggerConfig {
  /** `propietario/repositorio`. */
  repository: string;
  /** Fichero del workflow (`publicar.yml`) o su id numerico. */
  workflow: string;
  /** Rama o tag desde el que se ejecuta. */
  ref: string;
  /**
   * Token con permiso para disparar Actions en ese repositorio y nada mas.
   *
   * Con un token de acceso fino basta `actions: write` sobre este
   * repositorio; no necesita leer el codigo ni tocar nada del contenido.
   */
  token: string;
  /** Puntos de inyeccion para poder probar sin red. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_BASE = 'https://api.github.com';

/** Forma minima de `propietario/repositorio`. */
const REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Lee la configuracion del entorno.
 *
 * Devuelve `null` cuando no hay ninguna de las cuatro variables: eso no es un
 * error, es "aqui no se dispara nada", que es lo normal en desarrollo. Que
 * falte solo alguna si lo es: media configuracion significa que alguien creia
 * tener el ejecutor real y no lo tiene, y publicar en silencio con el manual
 * seria peor que decirlo.
 */
export function readGitHubTriggerConfig(env: EnvLike): GitHubTriggerConfig | null {
  const values = {
    repository: env[GITHUB_ENV_KEYS.repository]?.trim() ?? '',
    workflow: env[GITHUB_ENV_KEYS.workflow]?.trim() ?? '',
    ref: env[GITHUB_ENV_KEYS.ref]?.trim() ?? '',
    token: env[GITHUB_ENV_KEYS.token]?.trim() ?? '',
  };

  if (Object.values(values).every((value) => value.length === 0)) return null;

  const missing = Object.entries(GITHUB_ENV_KEYS)
    .filter(([key]) => values[key as keyof typeof values].length === 0)
    .map(([, name]) => name);

  if (missing.length > 0) {
    throw new Error(`falta configuracion para disparar GitHub Actions: ${missing.join(', ')}`);
  }

  if (!REPOSITORY.test(values.repository)) {
    throw new Error(`${GITHUB_ENV_KEYS.repository} debe tener la forma "propietario/repositorio".`);
  }

  const apiBase = env[API_BASE_KEY]?.trim() ?? '';

  return { ...values, ...(apiBase.length === 0 ? {} : { apiBase }) };
}

/**
 * Referencia para diagnosticar, sin secretos.
 *
 * No es el id del run —el dispatch no lo devuelve—, sino todo lo necesario
 * para encontrarlo: en que repositorio, con que workflow, sobre que rama y
 * para que peticion.
 */
export function gitHubJobRef(config: GitHubTriggerConfig, requestId: number): string {
  return `github:${config.repository}/${config.workflow}@${config.ref}#req-${requestId}`;
}

/** Un motivo corto y sin credenciales a partir de la respuesta de GitHub. */
async function describeFailure(response: Response): Promise<string> {
  let message = '';

  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch {
    message = '';
  }

  if (response.status === 401 || response.status === 403) {
    return 'GitHub rechazo la credencial de publicacion.';
  }

  if (response.status === 404) {
    return 'GitHub no encuentra el repositorio, el workflow o la rama configurados.';
  }

  return message.length > 0
    ? `GitHub respondio ${response.status}: ${message}`
    : `GitHub respondio ${response.status}.`;
}

/**
 * El ejecutor de produccion.
 *
 * Acepta el trabajo cuando GitHub confirma el dispatch, y lo rechaza en
 * cualquier otro caso. Rechazar no publica nada ni deja nada a medias: la capa
 * de publicacion anota la peticion como fallida y la propiedad no se mueve.
 */
export function gitHubPublishTrigger(config: GitHubTriggerConfig): PublishTrigger {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.apiBase ?? DEFAULT_API_BASE;

  return {
    name: 'github-actions',

    async start(job) {
      const url = `${base}/repos/${config.repository}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`;

      let response: Response;

      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'content-type': 'application/json',
            'user-agent': 'codeloba-publicacion',
          },
          /*
           * Un solo input, y ningun secreto. Los inputs de un dispatch son
           * visibles para quien pueda ver los runs: el token de callback y las
           * credenciales NO pueden pasar por aqui.
           */
          body: JSON.stringify({
            ref: config.ref,
            inputs: { publicationRequestId: String(job.requestId) },
          }),
        });
      } catch (error) {
        // Nunca se incluye el token: solo por que no se pudo hablar con GitHub.
        console.error('[publicacion] no se pudo contactar con GitHub:', error);
        return { ok: false, error: 'No se pudo contactar con GitHub.' };
      }

      // El dispatch correcto responde 204 y sin cuerpo.
      if (response.status !== 204) {
        return { ok: false, error: await describeFailure(response) };
      }

      return { ok: true, jobRef: gitHubJobRef(config, job.requestId) };
    },
  };
}

/**
 * Que ejecutor toca segun el entorno.
 *
 * Con GitHub configurado, el real. Sin el, el manual, que en desarrollo
 * devuelve el token para poder cerrar el ciclo a mano. La eleccion se hace
 * aqui y no en el handler para que el panel no tenga que saber nada de esto.
 */
export function resolvePublishTrigger(
  env: EnvLike,
  options: { isDev?: boolean } = {},
): PublishTrigger {
  const config = readGitHubTriggerConfig(env);

  if (config !== null) return gitHubPublishTrigger(config);

  return manualPublishTrigger({ exposeToken: options.isDev === true });
}
