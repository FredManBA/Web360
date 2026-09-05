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
]);
