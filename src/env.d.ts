/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

// `Env` (con los bindings DB y MEDIA) se genera con `npm run cf:typegen`
// a partir de wrangler.jsonc, en el archivo `worker-configuration.d.ts`.

/**
 * Modulo virtual con el snapshot publico.
 *
 * No hay fichero detras: lo genera `src/lib/public/snapshot-plugin.ts` durante
 * el build, leyendo la base local en Node. Las paginas prerenderizadas lo
 * importan ya resuelto, porque el adaptador de Cloudflare las ejecuta dentro
 * de workerd y alli no hay acceso a la base ni a ficheros.
 */
declare module 'virtual:public-snapshot' {
  import type { PublicSnapshot } from './lib/public/read-model';

  const snapshot: PublicSnapshot;
  export default snapshot;
}
