/**
 * Ubicacion publica.
 *
 * Regla dura: las coordenadas privadas NUNCA sirven de respaldo automatico
 * para una respuesta publica. Si no hay coordenada publica, no hay coordenada.
 *
 * Cuando la precision es `approximate`, la coordenada publica desplazada la
 * introduce el admin; en esta fase no se genera automaticamente.
 */

import type { LocationPrecision } from './vocabularies';

export interface PublicCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Solo los campos publicos. Al tipar la entrada asi, es estructuralmente
 * imposible que esta funcion lea `privateLatitude` / `privateLongitude`.
 */
export interface PublicLocationSource {
  publicLatitude: number | null;
  publicLongitude: number | null;
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Coordenada publicable, o `null` si no hay una utilizable.
 *
 * El resultado contiene exclusivamente `latitude` y `longitude`.
 */
export function getPublicCoordinates(source: PublicLocationSource): PublicCoordinates | null {
  const { publicLatitude, publicLongitude } = source;

  if (publicLatitude === null || publicLongitude === null) return null;
  if (!isValidLatitude(publicLatitude) || !isValidLongitude(publicLongitude)) return null;

  return { latitude: publicLatitude, longitude: publicLongitude };
}

export type LocationProblem = 'coordinates_missing' | 'coordinates_out_of_range';

/**
 * Tanto `exact` como `approximate` exigen una coordenada publica utilizable:
 * la diferencia esta en su exactitud, no en su existencia.
 */
export function validatePublicLocation(
  source: PublicLocationSource & { locationPrecision: LocationPrecision },
): LocationProblem[] {
  const { publicLatitude, publicLongitude } = source;

  if (publicLatitude === null || publicLongitude === null) return ['coordinates_missing'];
  if (!isValidLatitude(publicLatitude) || !isValidLongitude(publicLongitude)) {
    return ['coordinates_out_of_range'];
  }

  return [];
}
