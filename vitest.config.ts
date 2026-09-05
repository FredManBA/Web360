import { defineConfig } from 'vitest/config';

// Tests unitarios de la logica de dominio y validacion. No arrancan Astro ni
// tocan la base de datos: todo lo que se prueba aqui son funciones puras.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
