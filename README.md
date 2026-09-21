# CodeLoba

Sitio web de propiedades construido con **Astro** y desplegado en **Cloudflare
Workers**, con **D1** (base de datos) y **R2** (multimedia).

El núcleo público lee D1 en cada request y renderiza HTML con Astro.
Publicar y retirar contenido son escrituras directas en D1, independientes del
build y del deploy. R2 reduce el producto a `properties`, `media`,
`site_settings` y `contacts`, con ES/EN integrados y guardado manual del admin.
El proyecto parte de una D1 nueva: una única migración crea esas cuatro tablas.
Ver [el modelo y la validación de R2](docs/rework-r2.md).

## Requisitos

- Node.js 24 LTS o superior
- npm
- Una cuenta de Cloudflare (solo para desplegar)

## Instalacion

```bash
npm install
```

## Ejecucion local

```bash
npm run dev
```

El sitio queda disponible en http://localhost:4321.
La raíz (`/`) elige idioma en el navegador y ofrece enlaces ES/EN sin JavaScript.

## Build

```bash
npm run build     # genera dist/
npm run preview   # sirve el resultado del build en local
```

El build produce:

- `dist/client/` — paginas estaticas prerenderizadas y assets.
- `dist/server/` — el Worker con las rutas on-demand.

## Regla de renderizado

Las páginas de contenido ES/EN y `/sitemap.xml` declaran `prerender = false`.
`loadRuntimePublicSnapshot()` obtiene el binding `DB` y reutiliza
`buildPublicSnapshot(db)` una vez por request; el layout recibe sus datos por
props. El HTML inicial conserva SEO, contenido e idiomas.

La raíz `/` sigue estática y elige idioma. `npm run build` solo construye código:
no necesita D1 local/remota, snapshot ni variables de publicación. Para servir
contenido en desarrollo sí hace falta preparar la D1 local:

```bash
npm run db:migrate:local
npm run db:seed:local
```

## Configuracion de Cloudflare

La configuracion vive en `wrangler.jsonc`. El adaptador `@astrojs/cloudflare`
inyecta automaticamente el punto de entrada del Worker y el binding de assets
durante el build, por lo que no se declaran a mano.

Los recursos se crean una vez; `wrangler.jsonc` ya trae el nombre y el
`database_id` de la D1 en uso:

```bash
npx wrangler d1 create cr360-db         # devuelve el database_id
npx wrangler r2 bucket create codeloba-media
```

Comprobar el bundle sin desplegar nada:

```bash
npm run build
npx wrangler deploy --dry-run --config dist/server/wrangler.json
```

> Nota: las sesiones de Astro estan desactivadas (`session: false` en
> `astro.config.mjs`), asi que el Worker solo declara los bindings `DB`,
> `MEDIA` y `ASSETS`. No se aprovisiona ningun namespace KV.

## D1 y R2

Bindings declarados en `wrangler.jsonc`:

| Binding | Recurso               | Uso                            |
| ------- | --------------------- | ------------------------------ |
| `DB`    | D1 (`cr360-db`)       | contenido vivo y configuración |
| `MEDIA` | R2 (`codeloba-media`) | imágenes, 360 y multimedia     |

Los bindings solo existen dentro de una peticion on-demand y se acceden asi:

```ts
import { env } from 'cloudflare:workers';
import { getDb } from '@/db/client';

export const prerender = false;

const db = getDb(env);
const media = env.MEDIA;
```

> `Astro.locals.runtime.env` se elimino en Astro v6: el binding se obtiene
> del modulo `cloudflare:workers`, que solo existe dentro del Worker.

El esquema se define en `src/db/schema.ts` y las migraciones se generan en
`drizzle/`:

```bash
npm run db:generate        # genera el SQL a partir del esquema
npm run db:migrate:local   # aplica las migraciones a la D1 local
npm run db:migrate:remote  # aplica las migraciones a la D1 de Cloudflare
```

Tras cambiar `wrangler.jsonc`, regenerar los tipos de los bindings:

```bash
npm run cf:typegen
```

## Variables y secretos

**Nunca** se suben credenciales al repositorio.

- `.dev.vars.example` documenta las variables que haran falta.
- Para desarrollo local: copiar a `.dev.vars` (ignorado por Git) y rellenar.
- Para produccion: `npx wrangler secret put NOMBRE_VARIABLE`.

### Acceso al panel

El panel (`/admin/*`) y su API (`/api/admin/*`) estan **cerrados por
defecto** y responden 403. Hay exactamente dos formas de entrar.

**Desarrollo local.** Copia `.dev.vars.example` a `.dev.vars` y pon:

```
ADMIN_DEV_BYPASS=true
```

Esto solo funciona con el servidor de desarrollo (`npm run dev`): el bypass
exige a la vez modo DEV y la variable, asi que **una build productiva lo
ignora** aunque alguien la configure por error.

**Produccion.** Requiere una Cloudflare Access Application configurada y estas
dos variables:

```
CF_ACCESS_TEAM_DOMAIN=https://<equipo>.cloudflareaccess.com
CF_ACCESS_AUD=<audience tag>
```

El Worker verifica criptograficamente el JWT que Access envia en la cabecera
`Cf-Access-Jwt-Assertion`: firma contra el JWKS del equipo, emisor, audiencia
y caducidad. Si falta cualquiera de las dos variables, **falla cerrado**: toda
peticion administrativa se rechaza.

Conviene tener claro que:

- CodeLoba **no tiene login propio**. El de Cloudflare Access lo presenta el
  borde antes de que la peticion llegue al Worker.
- El **MFA se configura en Cloudflare Access**, no en la aplicacion.
- El Worker valida el JWT aunque Access proteja la ruta en el borde: el
  perimetro no sustituye a la comprobacion.
- En produccion, la Access Application protege `/admin/*` y `/api/admin/*`.

## Estructura

```
src/
  db/          cliente Drizzle y esquema de D1
  layouts/     layouts compartidos de Astro
  pages/       rutas (el arbol de archivos define las URLs)
    es/        sitio publico en espanol
    en/        sitio publico en ingles
    admin/     panel de administracion (on-demand)
  styles/      CSS global
drizzle/       migraciones SQL generadas
public/        archivos servidos tal cual
```

`src/components/` contiene la interfaz compartida; `src/lib/`, el dominio,
read model y lógica del admin; `src/pages/api/`, los endpoints HTTP.

## Idiomas

`/es/` y `/en/` son arboles de rutas independientes, para que cada idioma
tenga sus propias URLs indexables. Las fichas EN aparecen únicamente cuando
existe una traducción válida. La raíz recuerda la preferencia de idioma.

## Scripts

| Script                | Descripcion                           |
| --------------------- | ------------------------------------- |
| `npm run dev`         | servidor de desarrollo                |
| `npm run build`       | build de produccion                   |
| `npm run preview`     | sirve el build en local               |
| `npm run check`       | comprobacion de tipos (`astro check`) |
| `npm run lint`        | ESLint                                |
| `npm run format`      | Prettier                              |
| `npm run db:generate` | genera migraciones de Drizzle         |
| `npm run cf:typegen`  | regenera los tipos de los bindings    |
