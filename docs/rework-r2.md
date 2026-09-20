# R2: núcleo y admin

Las únicas tablas de producto son `properties`, `media`, `site_settings` y
`contacts`. ES/EN son columnas; características, tour y redes son JSON pequeños.
Los estados son `draft` y `published`. Una vendida publicada sigue visible;
Retirar la devuelve a borrador inmediatamente.

El admin crea el siguiente CR360-XXX y abre una pantalla de edición. Guardar
envía ES, EN, información y características en un único UPDATE atómico. No hay
autosave. Multimedia se gestiona aparte: imagen, panorama o YouTube; una portada
sirve para catálogo y hero. El tour migrado permanece de solo lectura, y no se
puede eliminar un panorama que pertenezca a él. Configuración y contactos tienen
pantallas pequeñas. Access, same-origin, JSON estricto y no-store se conservan.

## Base de datos

El proyecto parte de una D1 nueva. `drizzle/0000_core_baseline.sql` es la única
migración: crea directamente `properties`, `media`, `site_settings` y `contacts`
con sus índices, CHECK y claves foráneas, sobre una base vacía. No crea ninguna
tabla antigua ni convierte nada.

No hay corte de datos heredados. La cadena histórica 0000-0008, que construía el
modelo anterior y lo transformaba después, se retiró a propósito al decidir que
no se conservan los datos actuales; queda en el historial de git. Las
[migraciones de Wrangler](https://developers.cloudflare.com/d1/reference/migrations/)
registran cada aplicación en `d1_migrations`.

`site_settings` no se rellena desde la migración: el runtime tolera que la fila
no exista y guardar la crea. `src/db/seed/seed.sql` inserta `id = 1` para
desarrollo local.

Se descartan deliberadamente workflow/reviews/tokens, coordenadas privadas,
POI, tipos personalizados, locales configurables, grupos, títulos/captions de
media y redes inactivas. Documentos y vídeo propio dejan de estar en el modelo
activo. No se borra ningún objeto R2, tampoco al eliminar media desde el admin;
los objetos sin referencia quedan para una limpieza futura explícita.

Los objetos que hoy existen en R2 pueden quedar sin referencia; borrarlos, si se
quiere, será una tarea aparte y explícita.

## Lectura y validación mínima

Cada página pública usa tres SELECT: settings, propiedades publicadas y su
media; dos si no hay propiedades. La entrega de un archivo usa un SELECT con
JOIN. Los DTO mantienen el contrato de los componentes públicos. El diseño
público no cambia: en `global.css` solo se eliminan estilos de revisión privada
que ya no tenían consumidores.

| Medida                            | Antes | Después                         |
| --------------------------------- | ----- | ------------------------------- |
| Tablas de producto                | 25    | 4                               |
| Estados editoriales               | 5     | 2                               |
| Patrones de URL de API            | 47    | 12                              |
| Archivos de rutas API             | 47    | 2 (contacto y dispatcher admin) |
| SELECT por página con propiedades | 18    | 3                               |

Se eliminan 193 archivos, incluidos 55 archivos de tests y 55 archivos de
publicación/revisión y su infraestructura.

`src/lib/public/r2-runtime.test.ts` trabaja en una carpeta temporal con D1/R2
locales y credenciales filtradas del entorno. Aplica el baseline a una base
vacía y comprueba que solo existen las cuatro tablas, que la integridad
referencial está limpia y que no hay datos previos. El segundo caso crea,
guarda, sube una única imagen pequeña, elige portada, publica, comprueba
catálogo/ficha y retira, comprobando catálogo y 404.

Validación de cierre: esos dos casos dirigidos, `npm run check`, `npm run build`
y ESLint/Prettier solo sobre archivos cambiados. No se ejecuta la suite completa.
