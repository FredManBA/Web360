/**
 * El manifiesto de la version que esta desplegada AHORA.
 *
 * Es el unico punto donde el Worker en ejecucion averigua a que release
 * pertenece, y lo sabe porque el manifiesto viaja DENTRO de su propio
 * artefacto: lo inyecta el plugin del build, de la misma lectura de la que
 * salio el HTML que se prerenderizo. No se consulta a nadie, no hay red y no
 * hay estado que pueda haber cambiado por debajo. El artefacto habla de si
 * mismo.
 *
 * De ahi su otro uso: cuando el callback de una publicacion se pierde, esto
 * es la prueba de que el despliegue ocurrio. Si el artefacto que responde dice
 * llevar dentro la release de esa peticion, es que llego a desplegarse.
 *
 * `null` significa "esta version no afirma pertenecer a ninguna operacion de
 * publicacion", que es lo que devuelve cualquier build normal. En ese caso la
 * autorizacion de archivos la decide la base, igual que antes de que este
 * modulo existiera.
 */

import manifest from 'virtual:release-manifest';

import type { ReleaseManifest } from './release';

export function deployedReleaseManifest(): ReleaseManifest | null {
  return manifest;
}
