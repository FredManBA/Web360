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

## Migración

`drizzle/0008_r2_simple_core.sql` crea las cuatro tablas de destino, copia todos
los datos útiles y solo entonces elimina las anteriores. Conserva IDs, códigos,
fechas, ES/EN, precio, ubicación pública, orden, portada, características, tour,
identidad visual, redes activas y contactos. Tipos desconocidos pasan a `other`;
estados distintos de published pasan a draft. Un grupo de características se
incorpora al label; los nodos del tour se identifican por mediaId.

Se usa SQL SQLite soportado por D1, sin dependencias adicionales. Las
[migraciones de Wrangler](https://developers.cloudflare.com/d1/reference/migrations/)
registran cada aplicación en `d1_migrations`; no se debe ejecutar el archivo
aislado por segunda vez. Una restricción con nombre identifica tours con media
incompatible, enlaces entre propiedades, grupos ajenos o settings no singleton.
Los demás CHECK, UNIQUE y FK abortan conversiones inválidas. La migración conserva
las claves foráneas activas y se ejecuta como transacción de D1.

Antes del futuro corte, inspeccionar una copia SQLite explícita:

```sh
node scripts/inspect-r2-copy.mjs RUTA_A_COPIA.sqlite
```

Este comando abre solo esa copia en modo lectura y cuenta documentos/vídeos R2
excluidos y redes inactivas. No conecta con D1 ni R2. En esta fase no se recibió
una copia real: se validó una fixture temporal, con cero documentos/vídeos R2.
Las migraciones anteriores permanecen para permitir actualizar instalaciones
existentes; el runtime ya no consulta sus tablas.

Se descartan deliberadamente workflow/reviews/tokens, coordenadas privadas,
POI, tipos personalizados, locales configurables, grupos, títulos/captions de
media y redes inactivas. Documentos y vídeo propio dejan de estar en el modelo
activo. No se borra ningún objeto R2, tampoco al eliminar media desde el admin;
los objetos sin referencia quedan para una limpieza futura explícita.

El corte real requiere una fase posterior autorizada con copia fiel, inventario
de pérdidas y despliegue coordinado de schema y código. R2 no lo ejecuta.

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
publicación/revisión y su infraestructura. La historia SQL se conserva para
migrar instalaciones anteriores; no forma parte de las consultas del runtime.

`src/lib/public/r2-runtime.test.ts` trabaja en una carpeta temporal con D1/R2
locales y credenciales filtradas del entorno. Aplica primero el schema antiguo,
inserta una ficha ES/EN con features, imagen, dos panoramas, YouTube, dos nodos y
dos enlaces, settings, una red y un contacto, y aplica R2. Comprueba sus datos,
las cuatro tablas, integridad referencial, un render EN y el tour público.
El segundo caso crea, guarda, sube una única imagen pequeña, elige portada,
publica, comprueba catálogo/ficha y retira, comprobando catálogo y 404.

Validación de cierre: esos dos casos dirigidos, `npm run check`, `npm run build`
y ESLint/Prettier solo sobre archivos cambiados. No se ejecuta la suite completa.
