/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

// `Env` (con los bindings DB y MEDIA) se genera con `npm run cf:typegen`
// a partir de wrangler.jsonc, en el archivo `worker-configuration.d.ts`.

/**
 * Variables de entorno del build.
 *
 * `PUBLIC_MAPBOX_TOKEN` es el token PUBLICO de Mapbox, el que va en el
 * navegador y esta restringido por dominio en el panel de Mapbox. Se inyecta
 * en el build desde `.env` o desde el entorno, nunca se versiona, y si falta
 * el sitio se construye igual: los mapas se quedan en su alternativa de texto.
 */
interface ImportMetaEnv {
  readonly PUBLIC_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

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

/**
 * Modulo virtual con el manifiesto de la release desplegada.
 *
 * Lo genera el mismo plugin y de la misma lectura que el snapshot, para que
 * el HTML prerenderizado y la lista de archivos que el Worker acepta servir
 * pertenezcan a la misma version.
 *
 * Es `null` en cualquier build que no sea una version candidata de una
 * operacion de publicacion.
 */
declare module 'virtual:release-manifest' {
  import type { ReleaseManifest } from './lib/publication/release';

  const manifest: ReleaseManifest | null;
  export default manifest;
}
