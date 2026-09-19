# R1: contenido vivo y publicación inmediata

Trabajo local en `rework/simple-core`, desde `6429e8d`. El commit 9B2
`4541be3` se conserva en `wip/9b2-privacy`; `main` coincide con `origin/main`.
Sin push, deploy, migraciones remotas ni escrituras sobre datos reales.

## Lectura pública

Las diez páginas de contenido ES/EN (home, catálogo, ficha, mapa y contacto),
`/sitemap.xml` y el 404 leen D1 en el Worker. Cada página llama una vez a
`loadRuntimePublicSnapshot()`, que reutiliza `buildPublicSnapshot(db)`.
`PublicLayout` recibe la marca y media global por props, sin consultas propias.

El modelo conserva su proyección pública: no selecciona coordenadas privadas,
respeta visibilidad y solo genera fichas para traducciones con título y slug.
Una ficha ausente, retirada, oculta o sin traducción responde 404 con el shell
público y `noindex`. Las fichas ya no usan `getStaticPaths()`.

Son **18 SELECT por request** con propiedades visibles, o **5** sin propiedades
visibles, independientes del número de propiedades. No se añade caché ni otro
read model. HTML y sitemap usan `Cache-Control: no-store`.

La raíz continúa estática para elegir idioma y usa la marca de respaldo.
Los componentes visuales existentes y el CSS público se conservan.
Canonical, hreflang, x-default de home, OG, Twitter y JSON-LD se renderizan
en el HTML inicial. Sin `CODELOBA_SITE_URL`, se mantiene el comportamiento
anterior: URLs relativas y sitemap vacío, sin inventar un dominio.

## Escrituras

Se reutilizan las rutas administrativas:

- `GET /api/admin/properties/:id/publication`: estado actual y enlace público.
- `POST /api/admin/properties/:id/publication/publish`: valida contenido y
  escribe `published` y `published_at`. Responde 200 al terminar, 422 con
  todos los problemas de contenido, 404 si no existe. Una archivada exige
  restauración explícita y responde 409.
- `POST /api/admin/properties/:id/publication/unpublish`: escribe `draft` y
  limpia `published_at`; el siguiente request deja de mostrar la propiedad.

Se permite publicar desde `draft`, `in_review` y `approved`. La validación
comprueba contenido, sin exigir revisión ni aprobación. El scope explícito
`runtime-publication` evita abrir estas transiciones en el PATCH editorial.
Repetir una publicación o retirada completada es seguro.

Los endpoints nuevos no crean `publication_requests`, tokens o jobs, no
invocan GitHub y no esperan confirmación. Se conservan Access fail-closed,
same-origin y `no-store` en admin. El contexto runtime deja de conectar el
trigger de GitHub y el manifiesto del build.

Se conserva el middleware y la señal de desarrollo original de Astro. El
middleware fija `no-store` también en páginas administrativas autorizadas.
El QA ejecuta el Worker construido con el bypass configurado y exige 403 tanto
en páginas como en API. Los procesos de prueba aíslan las variables `DEV/PROD`
de Vitest para no contaminar la compilación productiva.

El editor usa el mismo coordinador de guardado antes de publicar o retirar.
Muestra `Publicar propiedad` o `Publicada`, `Ver propiedad` y `Retirar`, con
la lista de errores de validación cuando corresponde. La revisión externa
ya no se monta. Configuración guarda directamente el contenido público y
no monta el panel de publicación del sitio.

## Media y build

`/media/:id` autoriza solo con D1 y la visibilidad de la propiedad. Conserva
404 para datos u objetos R2 ausentes, borradores y vendidas ocultas, así como
ETag, nosniff y los headers de caché anteriores. La retirada se verifica contra
el servidor: una copia ya almacenada puede durar según esos headers
(una hora en navegador y un día en el borde). R1 no añade invalidación.
`/site-media/*` conserva su implementación.

`astro.config.mjs` ya no conecta `publicSnapshotPlugin`; no hay imports runtime
de `virtual:public-snapshot` ni `virtual:release-manifest`. El build no requiere
D1, snapshots, `CODELOBA_D1_SOURCE` ni `CODELOBA_PUBLICATION_REQUEST`.

## Infraestructura histórica

Permanecen schema y migraciones, estados antiguos, tablas de revisión y
`publication_requests`, servicios y APIs de revisión, handlers históricos de
publicación/reconciliación, scripts, workflow, fuentes del snapshot de build y
panel del sitio. Ya no intervienen en el recorrido nuevo. Los endpoints
históricos conservan sus protecciones; su eliminación física queda para R2/R3.
`deployedReleaseManifest()` devuelve `null`: este artefacto no contiene una
release de contenido. La guía anterior está marcada como histórica.

## Verificación reproducible

`src/lib/admin/properties/direct-publication.test.ts` usa SQLite temporal real
para validar estados, errores HTTP, Access, same-origin, ausencia de requests
y triggers, privacidad del DTO y recuento de consultas.

`src/lib/public/runtime.test.ts` copia el proyecto a una carpeta temporal,
construye antes de crear D1 y arranca Astro/workerd con D1/R2 locales aislados.
Recorre por HTTP creación, datos mínimos, subida PNG, roles, publicación,
catálogo, ficha, mapa, sitemap, media y retirada con 404. Incluye ES sin EN,
ficha bilingüe, configuración inmediata y SEO del HTML inicial. No necesita
credenciales externas ni dependencias nuevas. Se ejecuta dentro de `npm test`.
También arranca el artefacto construido con Wrangler local para verificar que
lee el contenido escrito después del build y mantiene Access cerrado.

Checks de cierre: `npm test`, `npm run check`, `npm run lint`,
`npm run format:check` y `npm run build`.

Resultado local: **2098 tests en 70 archivos aprobados**; Astro check sin
errores, warnings ni hints; lint y formato aprobados. El build normal y el
build aislado sin D1 terminan correctamente. Solo se prerenderizan `/` y
`/robots.txt`; se conserva el aviso de tamaño de los chunks del cliente.
La QA HTTP incluye los nueve pasos solicitados en ES y una segunda ficha EN,
sin modificar datos reales ni recursos remotos.
