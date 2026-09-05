import { defineConfig } from 'drizzle-kit';

// Drizzle Kit solo genera el SQL de migracion a partir del esquema.
// La aplicacion de las migraciones sobre D1 la hace Wrangler
// (`npm run db:migrate:local` / `npm run db:migrate:remote`),
// por eso aqui no hacen falta credenciales de Cloudflare.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
