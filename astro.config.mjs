// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

import { publicSnapshotPlugin } from './src/lib/public/snapshot-plugin.ts';

// https://astro.build/config
export default defineConfig({
  // Regla de renderizado de CodeLoba:
  // el sitio publico es ESTATICO por defecto (prerenderizado en build).
  // Una ruta concreta pasa a ejecutarse on-demand en el Worker solo si
  // declara explicitamente `export const prerender = false`.
  output: 'static',

  // El catalogo publico se resuelve en el build: el plugin lee la base local
  // en Node y entrega el snapshot ya listo, porque el prerenderizado del
  // adaptador ocurre dentro de workerd y alli no hay acceso a ficheros.
  vite: {
    plugins: [publicSnapshotPlugin()],
  },

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
  // La raiz solo redirige al idioma por defecto, de forma temporal (302),
  // para no fijar el idioma en cache mientras no exista deteccion.
  redirects: {
    '/': {
      status: 302,
      destination: '/es/',
    },
  },
});
