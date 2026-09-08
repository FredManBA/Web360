/*
 * Comprueba que el build produjo la version que se pidio.
 *
 * Se ejecuta ENTRE el build y el despliegue, y es la ultima oportunidad de
 * parar antes de subir algo que no toca. Lee el manifiesto que el build dejo
 * junto al artefacto —la misma lectura de la que salio el bundle— y comprueba
 * que corresponde a la operacion de `CODELOBA_PUBLICATION_REQUEST`.
 *
 * Sale con codigo distinto de cero cuando algo no cuadra, para que el workflow
 * se detenga sin desplegar.
 *
 * Uso: node scripts/verify-release.mjs [ruta-del-manifiesto]
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.argv[2] ?? 'dist/release-manifest.json');

function fallar(motivo) {
  console.error(`[release] ${motivo}`);
  process.exit(1);
}

const esperado = Number((process.env.CODELOBA_PUBLICATION_REQUEST ?? '').trim());

if (!Number.isSafeInteger(esperado) || esperado <= 0) {
  fallar('CODELOBA_PUBLICATION_REQUEST no es un entero positivo.');
}

let manifiesto;
try {
  manifiesto = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  fallar(`no se pudo leer el manifiesto en ${file}: ${error.message}`);
}

if (manifiesto.requestId !== esperado) {
  fallar(
    `el artefacto dice pertenecer a la operación ${manifiesto.requestId}, ` +
      `pero se pidió construir la ${esperado}.`,
  );
}

if (typeof manifiesto.releaseId !== 'string' || manifiesto.releaseId.length === 0) {
  fallar('el manifiesto no identifica ninguna release.');
}

if (!Array.isArray(manifiesto.mediaIds)) {
  fallar('el manifiesto no lleva la lista de archivos de la versión.');
}

console.log(
  `[release] ${manifiesto.releaseId}: operación ${manifiesto.requestId}, ` +
    `${manifiesto.mediaIds.length} archivo(s)${
      typeof manifiesto.commit === 'string' ? `, commit ${manifiesto.commit.slice(0, 12)}` : ''
    }.`,
);
