import type { ReleaseManifest } from './release';

/** Compatibilidad con las APIs historicas: R1 no lleva releases de contenido. */
export function deployedReleaseManifest(): ReleaseManifest | null {
  return null;
}
