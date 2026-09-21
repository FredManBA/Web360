// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Las rutas con contenido leen D1 en el Worker; la raiz queda estatica.
  output: 'static',

  /*
   * El origen publico para canonical, hreflang y sitemap.
   *
   * `CODELOBA_SITE_URL` tiene prioridad: cuando haya dominio propio basta con
   * definirla al construir. Sin ella se usa el host de produccion actual.
   */
  site: process.env.CODELOBA_SITE_URL || 'https://properties.costarica360.workers.dev',

  adapter: cloudflare({
    // 'compile': las imagenes se optimizan en el build con sharp.
    // Evita depender del binding de Cloudflare Images (producto de pago).
    // La estrategia definitiva se revisara en la fase de multimedia.
    imageService: 'compile',
  }),

  // Sesiones desactivadas: el proyecto no las usa y asi el adaptador no
  // declara el binding KV `SESSION`, que Cloudflare aprovisionaria en el
  // primer despliegue. Tambien excluye el runtime de sesiones del bundle.
  session: false,

  // ES y EN son arboles de rutas independientes (mejor para SEO).
  //
  // La raiz ya NO redirige desde la configuracion: un 302 del servidor no
  // puede saber que idioma eligio la persona la ultima vez. Ahora `/` es una
  // pagina estatica (`src/pages/index.astro`) que decide en el navegador y
  // deja una eleccion de idioma visible cuando no hay JavaScript.
});
