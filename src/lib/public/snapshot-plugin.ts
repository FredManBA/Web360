/**
 * Plugin de Vite que inyecta los datos del build.
 *
 * El sitio publico es estatico, pero D1 solo existe en tiempo de ejecucion, y
 * el adaptador de Cloudflare prerenderiza dentro de workerd: una pagina no
 * puede leer la base ni abrir ficheros mientras se genera.
 *
 * La pieza que falta es esta. El plugin corre en Node, dentro del proceso de
 * Vite, lee los datos UNA vez y los entrega como modulos. Cuando la pagina se
 * prerenderiza, el snapshot ya es un objeto en el bundle.
 *
 * Dos modulos, de la MISMA lectura, y eso es lo importante:
 *
 * - `virtual:public-snapshot`, el contenido que se prerenderiza;
 * - `virtual:release-manifest`, la lista de archivos que ese contenido
 *   referencia y de que operacion de publicacion salio.
 *
 * Que salgan de la misma lectura es lo que garantiza que el HTML desplegado y
 * los archivos que el Worker acepta servir pertenezcan a la misma version. Si
 * cada uno se leyera por su cuenta, podrian discrepar, que es exactamente el
 * problema que el manifiesto viene a resolver.
 *
 * En un build normal el manifiesto es `null`: no hay ninguna operacion que
 * afirmar, y el Worker se comporta como siempre.
 */

import type { Plugin } from 'vite';

import type { ReleaseManifest } from '../publication/release';
import { readBuildData, type BuildData } from './snapshot-source';

export const SNAPSHOT_MODULE_ID = 'virtual:public-snapshot';
export const RELEASE_MODULE_ID = 'virtual:release-manifest';

const RESOLVED_SNAPSHOT = `\0${SNAPSHOT_MODULE_ID}`;
const RESOLVED_RELEASE = `\0${RELEASE_MODULE_ID}`;

export interface SnapshotPluginOptions {
  /** Punto de inyeccion para pruebas; en el build real no se usa. */
  read?: () => Promise<BuildData>;
}

export function publicSnapshotPlugin(options: SnapshotPluginOptions = {}): Plugin {
  /*
   * Se lee una sola vez y en cuanto empieza el build. Hacerlo al vuelo desde
   * `load` lo dejaba a merced de en que momento pide el modulo cada pagina, y
   * ademas los dos modulos tienen que ver los mismos datos.
   */
  let pending: Promise<BuildData> | null = null;

  const read = options.read ?? (() => readBuildData());
  const dataOnce = (): Promise<BuildData> => (pending ??= read());

  return {
    name: 'codeloba:public-snapshot',

    async buildStart() {
      /*
       * Se espera aqui a proposito: si la frontera de datos no puede
       * responder con la verdad —origen remoto caido, operacion que ya no
       * encaja—, el build tiene que morir ahora y no generar un sitio
       * incompleto.
       */
      await dataOnce();
    },

    resolveId(id) {
      if (id === SNAPSHOT_MODULE_ID) return RESOLVED_SNAPSHOT;
      if (id === RELEASE_MODULE_ID) return RESOLVED_RELEASE;
      return null;
    },

    async load(id) {
      if (id !== RESOLVED_SNAPSHOT && id !== RESOLVED_RELEASE) return null;

      const data = await dataOnce();

      /*
       * Se serializa entero: es lo unico que las paginas necesitan, y asi el
       * prerenderizado no depende del sistema de ficheros.
       */
      if (id === RESOLVED_SNAPSHOT) return `export default ${JSON.stringify(data.snapshot)};`;

      const manifest: ReleaseManifest | null = data.manifest;

      return `export default ${JSON.stringify(manifest)};`;
    },
  };
}
