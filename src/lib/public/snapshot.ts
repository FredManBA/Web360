/** Frontera de servidor: una lectura del modelo publico por request, sin cache. */
import { env } from 'cloudflare:workers';

import { getDb } from '../../db/client';
import { buildPublicSnapshot, type PublicSnapshot } from './read-model';

export function loadRuntimePublicSnapshot(): Promise<PublicSnapshot> {
  return buildPublicSnapshot(getDb(env));
}
