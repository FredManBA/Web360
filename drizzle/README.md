# Migraciones

Las migraciones SQL de Cloudflare D1 se generan automaticamente en este
directorio a partir de `src/db/schema.ts`:

```bash
npm run db:generate        # crea el .sql de migracion
npm run db:migrate:local   # lo aplica a la D1 local
npm run db:migrate:remote  # lo aplica a la D1 de Cloudflare
```

`0000_core_baseline.sql` es el punto de partida: crea directamente `properties`,
`media`, `site_settings` y `contacts` sobre una base vacia. La historia anterior
(0000-0008, que construia el modelo antiguo y lo convertia despues) se retiro a
proposito al decidir que el proyecto arranca con una D1 nueva y sin datos
heredados. Queda en el historial de git si alguna vez hace falta consultarla.

No edites los archivos generados a mano.
