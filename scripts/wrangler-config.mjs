/*
 * Escribe el identificador real de la D1 en la configuracion de Wrangler.
 *
 * Por que hace falta. `wrangler.jsonc` lleva un placeholder a proposito: el
 * `database_id` real identifica un recurso de la cuenta y no se versiona.
 * Wrangler, por su parte, no interpola variables de entorno en ese campo, asi
 * que un despliegue automatico necesita que alguien lo escriba antes.
 *
 * Eso hace este script, y SOLO dentro de la maquina que despliega: sustituye
 * el placeholder por el valor de `CF_D1_DATABASE_ID`. El repositorio se queda
 * como estaba; el fichero modificado vive lo que viva el runner.
 *
 * Es idempotente: si el identificador ya esta puesto, no hace nada.
 *
 * Uso: node scripts/wrangler-config.mjs [ruta-de-wrangler.jsonc]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PLACEHOLDER = 'REPLACE_WITH_D1_DATABASE_ID';

const file = path.resolve(process.argv[2] ?? 'wrangler.jsonc');
const id = (process.env.CF_D1_DATABASE_ID ?? '').trim();

function fallar(motivo) {
  console.error(`[wrangler] ${motivo}`);
  process.exit(1);
}

if (id.length === 0) fallar('falta CF_D1_DATABASE_ID en el entorno.');

/*
 * Se comprueba la forma, no el valor: un id de D1 es un UUID. Asi un error de
 * configuracion se ve aqui y no como un despliegue apuntando a ninguna parte.
 */
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  fallar('CF_D1_DATABASE_ID no tiene forma de identificador de D1.');
}

let contenido;
try {
  contenido = readFileSync(file, 'utf8');
} catch (error) {
  fallar(`no se pudo leer ${file}: ${error.message}`);
}

if (contenido.includes(id)) {
  console.log('[wrangler] el identificador de la D1 ya estaba puesto.');
  process.exit(0);
}

if (!contenido.includes(PLACEHOLDER)) {
  fallar(`no se encontró el placeholder ${PLACEHOLDER} en ${file}.`);
}

writeFileSync(file, contenido.replaceAll(PLACEHOLDER, id), 'utf8');

// Nunca se imprime el identificador: es un dato de la cuenta.
console.log('[wrangler] identificador de la D1 escrito en la configuración local del runner.');
