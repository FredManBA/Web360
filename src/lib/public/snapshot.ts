/**
 * Acceso al snapshot publico desde las paginas.
 *
 * Las paginas no leen la base: importan el modulo virtual que el plugin de
 * Vite ha rellenado durante el build. Este fichero existe para que ese detalle
 * quede en un solo sitio y las paginas se lean bien.
 */

import snapshot from 'virtual:public-snapshot';

import type { PublicSnapshot } from './read-model';

export function loadPublicSnapshot(): PublicSnapshot {
  return snapshot;
}
