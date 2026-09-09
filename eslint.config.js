import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default defineConfig([
  {
    ignores: ['dist/**', '.astro/**', '.wrangler/**', 'drizzle/**', 'worker-configuration.d.ts'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  {
    /*
     * Los scripts de `scripts/` y la configuracion de Astro corren en Node,
     * fuera del bundle: alli `process` y `console` existen. Se declaran a mano
     * en vez de anadir el paquete `globals` solo para esto.
     */
    files: ['scripts/**/*.mjs', 'astro.config.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
      },
    },
  },
]);
