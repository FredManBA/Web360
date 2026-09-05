# Migraciones

Las migraciones SQL de Cloudflare D1 se generan automaticamente en este
directorio a partir de `src/db/schema.ts`:

```bash
npm run db:generate        # crea el .sql de migracion
npm run db:migrate:local   # lo aplica a la D1 local
npm run db:migrate:remote  # lo aplica a la D1 de Cloudflare
```

En la Fase 0 el esquema esta vacio, por lo que todavia no hay migraciones.
No edites los archivos generados a mano.
