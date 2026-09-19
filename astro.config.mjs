// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Las rutas con contenido leen D1 en el Worker; la raiz queda estatica.
  output: 'static',

  /*
   * El dominio publico, cuando lo haya.
   *
   * Sale del entorno y no del codigo: el dominio es cosa del despliegue, no
   * del repositorio, y asi el mismo build sirve para cualquiera. Sin la
   * variable, `Astro.site` queda `undefined` y el sitio se construye igual:
   * las URL del `<head>` salen relativas y el sitemap se queda vacio,
   * explicando por que. Nunca se inventa un host.
   */
  site: process.env.CODELOBA_SITE_URL || undefined,

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
