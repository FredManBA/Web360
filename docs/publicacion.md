# Publicación: cómo se activa y cómo se recupera

Guía operativa del flujo de publicación. Aquí no hay ningún valor real: solo
nombres, para qué sirve cada cosa y qué hacer cuando algo se queda a medias.

## Cómo funciona, en cuatro frases

1. El admin pide publicar (o retirar) desde el editor. La aplicación anota una
   operación en `publication_requests` y **no toca el estado editorial**.
2. Avisa a quien construye. Con GitHub configurado, dispara el workflow
   `Publicar sitio` pasándole **solo el número de la operación**.
3. El runner construye la versión candidata leyendo la D1 de producción,
   comprueba que el artefacto es el de esa operación y lo despliega.
4. Confirma el resultado. La aplicación solo lo da por bueno si el manifiesto
   que lleva dentro el Worker que responde es el de esa operación; entonces, y
   solo entonces, la propiedad pasa a `published` (o vuelve a `approved`).

## Secretos y variables

### Secretos del repositorio (GitHub → Settings → Secrets → Actions)

| Nombre                       | Para qué                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `CF_ACCOUNT_ID`              | Cuenta de Cloudflare. La usan el build (API de D1) y el deploy.                                         |
| `CF_D1_DATABASE_ID`          | Base D1 de producción. La usan el build y la configuración de Wrangler.                                 |
| `CF_D1_READ_TOKEN`           | Token de API de Cloudflare con **solo lectura** sobre D1. Es lo que el build usa para leer el catálogo. |
| `CLOUDFLARE_API_TOKEN`       | Token de API de Cloudflare con permiso para **editar Workers**. Solo lo usa el paso de deploy.          |
| `PUBLICATION_MACHINE_SECRET` | Secreto compartido con el Worker para confirmar el resultado.                                           |
| `PUBLIC_MAPBOX_TOKEN`        | Token público de Mapbox (`pk.`). Va al navegador; se restringe por dominio.                             |

### Variables del repositorio (no sensibles)

| Nombre              | Para qué                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `CODELOBA_SITE_URL` | Origen del sitio desplegado, sin barra final. Es adonde el runner manda la confirmación. |

### Secretos del Worker (`wrangler secret put …`)

| Nombre                       | Para qué                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `PUBLICATION_MACHINE_SECRET` | **El mismo valor** que el secreto de Actions. Sin él, el endpoint de máquina no abre nada. |
| `CODELOBA_GITHUB_REPOSITORY` | `propietario/repositorio` del repositorio que tiene el workflow.                           |
| `CODELOBA_GITHUB_WORKFLOW`   | Fichero del workflow: `publicar.yml`.                                                      |
| `CODELOBA_GITHUB_REF`        | Rama desde la que se ejecuta: normalmente `main`.                                          |
| `CODELOBA_GITHUB_TOKEN`      | Token de GitHub para disparar Actions.                                                     |
| `CODELOBA_GITHUB_API_BASE`   | Opcional. Otro punto de entrada de la API (GitHub Enterprise, o un doble local).           |

Los tres primeros de GitHub no son secretos en sentido estricto, pero se
configuran igual para no repartirlos entre dos sitios.

## Permisos mínimos del token de GitHub

Un **fine-grained personal access token** limitado a ese único repositorio, con
un solo permiso:

- **Actions: Read and write** (necesario para `workflow_dispatch`).

Nada más. No necesita `contents`, ni `packages`, ni acceso a otros
repositorios. Si el token se filtra, lo peor que permite es lanzar este
workflow: no puede leer código privado ni publicar por su cuenta, porque
publicar exige además que el artefacto desplegado coincida.

## Qué tiene que existir en Cloudflare antes de activarlo

Nada de esto lo crea el workflow; hay que crearlo una vez, a mano:

- el **Worker** `codeloba` (lo crea el primer `wrangler deploy` manual);
- la base **D1** `codeloba-db`, con las migraciones ya aplicadas
  (`npm run db:migrate:remote`) — **el workflow no migra nunca**;
- el bucket **R2** `codeloba-media`;
- la **Access Application** que protege `/admin/*` y `/api/admin/*`, con sus
  variables `CF_ACCESS_TEAM_DOMAIN` y `CF_ACCESS_AUD` en el Worker.

`wrangler.jsonc` lleva `REPLACE_WITH_D1_DATABASE_ID` a propósito: el
identificador real no se versiona. El paso
`npm run publication:wrangler-config` lo escribe **dentro del runner** a partir
de `CF_D1_DATABASE_ID`, y el repositorio se queda como estaba.

## Cómo se activa el disparador real

En cuanto el Worker tenga las cuatro variables `CODELOBA_GITHUB_*`, el panel
dispara Actions. No hay ningún interruptor aparte: la presencia de la
configuración **es** el interruptor.

Media configuración es un error, no un modo degradado: si falta alguna de las
cuatro, la aplicación lo dice en vez de publicar en silencio con el ejecutor
manual.

## Cómo se vuelve al ejecutor manual

Quitar las cuatro variables `CODELOBA_GITHUB_*` del Worker (`wrangler secret
delete …`, o vaciarlas en local). Sin ellas vuelve el ejecutor manual, que
anota la operación y espera a que alguien construya, despliegue y confirme a
mano. En una build de desarrollo, además, devuelve el token de un solo uso al
panel para poder cerrar el ciclo con:

```
curl -X POST "<sitio>/api/publication/callback" \
  -H "content-type: application/json" \
  -H "x-publication-token: <token>" \
  -d '{"ok": true}'
```

Ese callback de un solo uso sigue existiendo y es independiente del endpoint de
máquina: sirve como respaldo cuando no hay Actions por medio.

## Cuando la confirmación se pierde

Es el caso normal de "el deploy salió bien pero el último paso falló". La
operación se queda viva y **no se da por fallida**, porque nadie sabe si
ocurrió.

Para cerrarla: entra en la ficha, sección **Publicación**, y pulsa
**Comprobar si ya se publicó**. La aplicación mira el manifiesto que lleva
dentro el Worker que responde:

- si es el de esa operación, la cierra como éxito y aplica la transición;
- si es otro, no toca nada y lo dice. Eso no significa que fallara: significa
  que esa versión todavía no está en línea.

Si de verdad no hay forma de saberlo —el run desapareció, nadie sabe si llegó a
desplegarse— existe **Abandonar operación**, que cierra la operación sin
afirmar nada y libera la propiedad. No publica ni retira: la web se queda
exactamente como esté.

## Cómo se relaciona un despliegue con su operación

Sin mirar ningún secreto:

- el panel guarda una referencia del trabajo con la forma
  `github:propietario/repo/publicar.yml@main#req-42`;
- el run de Actions se llama `Publicación · operación 42`;
- el manifiesto de la release se llama `publish-p7-r42` e incluye el commit del
  que salió;
- `GET /api/admin/publication/deployed` dice qué versión está ejecutando el
  Worker ahora mismo.
