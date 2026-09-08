/**
 * El manifiesto de la version que esta desplegada AHORA.
 *
 * Es el unico punto donde el Worker en ejecucion averigua a que release
 * pertenece. Existe separado a proposito: el resto del codigo trabaja con un
 * `ReleaseManifest | null` y no necesita saber de donde sale.
 *
 * Hoy devuelve `null`, que significa "no hay release que acotar" y deja la
 * autorizacion de archivos exactamente como estaba: la decide la base. Es la
 * conducta correcta en desarrollo y en cualquier build que no venga del flujo
 * de publicacion.
 *
 * Lo que falta para que devuelva algo NO es codigo de este modulo, sino el
 * build que lo produce: el manifiesto tiene que viajar dentro del mismo
 * artefacto que el HTML —igual que `virtual:public-snapshot` viaja hoy—, y
 * eso lo monta la fase de CI. Cuando exista, esta funcion leera ese modulo y
 * nada mas cambiara de sitio.
 */

import type { ReleaseManifest } from './release';

export function deployedReleaseManifest(): ReleaseManifest | null {
  return null;
}
