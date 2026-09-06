/**
 * Plugin de Vite que inyecta el snapshot publico.
 *
 * El sitio publico es estatico, pero D1 solo existe en tiempo de ejecucion, y
 * el adaptador de Cloudflare prerenderiza dentro de workerd: una pagina no
 * puede leer la base ni abrir ficheros mientras se genera.
 *
 * La pieza que falta es esta. El plugin corre en Node, dentro del proceso de
 * Vite, lee la base local UNA vez y entrega el resultado como modulo. Cuando
 * la pagina se prerenderiza, el snapshot ya es un objeto en el bundle.
 *
 * Asi el sitio sigue siendo estatico, no hace falta infraestructura y al
 * cliente solo le llega el HTML.
 */

import type { Plugin } from 'vite';

import type { PublicSnapshot } from './read-model';
import { readLocalSnapshot } from './snapshot-source';

export const SNAPSHOT_MODULE_ID = 'virtual:public-snapshot';
const RESOLVED_ID = `\0${SNAPSHOT_MODULE_ID}`;

export function publicSnapshotPlugin(): Plugin {
  /*
   * Se lee una sola vez y en cuanto empieza el build. Hacerlo al vuelo desde
   * `load` lo dejaba a merced de en que momento pide el modulo cada pagina.
   */
  let pending: Promise<PublicSnapshot> | null = null;

  const snapshotOnce = (): Promise<PublicSnapshot> => (pending ??= readLocalSnapshot());

  return {
    name: 'codeloba:public-snapshot',

    buildStart() {
      void snapshotOnce();
    },

    resolveId(id) {
      return id === SNAPSHOT_MODULE_ID ? RESOLVED_ID : null;
    },

    async load(id) {
      if (id !== RESOLVED_ID) return null;

      const snapshot = await snapshotOnce();

      /*
       * Se serializa entero: es lo unico que las paginas necesitan, y asi el
       * prerenderizado no depende del sistema de ficheros.
       */
      return `export default ${JSON.stringify(snapshot)};`;
    },
  };
}
