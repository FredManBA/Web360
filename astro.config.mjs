// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Regla de renderizado de CodeLoba:
  // el sitio publico es ESTATICO por defecto (prerenderizado en build).
  // Una ruta concreta pasa a ejecutarse on-demand en el Worker solo si
  // declara explicitamente `export const prerender = false`.
  output: 'static',

  adapter: cloudflare({
    // 'compile': las imagenes se optimizan en el build con sharp.
    // Evita depender del binding de Cloudflare Images (producto de pago).
    // La estrategia definitiva se revisara en la fase de multimedia.
    imageService: 'compile',
  }),

  // ES y EN son arboles de rutas independientes (mejor para SEO).
  // La raiz solo redirige al idioma por defecto.
  redirects: {
    '/': '/es/',
  },
});
