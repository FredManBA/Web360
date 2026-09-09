/*
 * Confirma a la aplicacion que el despliegue ocurrio.
 *
 * Es el ultimo paso del workflow y el unico que puede encontrarse la web a
 * medio propagar. El Worker solo da por buena la confirmacion si el artefacto
 * que responde lleva dentro el manifiesto de ESTA operacion; justo despues de
 * desplegar, una peticion puede alcanzar todavia una instancia con la version
 * anterior, y entonces contesta 409 `not_applicable`.
 *
 * El 409 es lo UNICO que se reintenta, porque es lo unico que se sabe
 * transitorio: el propio Worker dice que la version desplegada aun no es esta.
 * Todo lo demas falla en el acto —401 por un secreto que no cuadra, 422 por un
 * cuerpo mal formado, 5xx, o un fallo de red por un SITE_URL equivocado—,
 * porque esperar no arregla ninguna de esas cosas y solo alarga el
 * diagnostico. Por eso tampoco se usa `curl --retry-all-errors`, que trataria
 * igual un secreto equivocado que una version sin propagar.
 *
 * Reintentar es seguro: la confirmacion es idempotente. Si una operacion ya
 * quedo cerrada, el endpoint responde sin volver a tocar nada, y si aun asi se
 * agotan los intentos queda el `reconcile` del panel, que usa la misma prueba.
 *
 * Uso: node scripts/publication-finalize.mjs
 *
 * Entorno: SITE_URL, MACHINE_SECRET, REQUEST_ID.
 */

import { pathToFileURL } from 'node:url';

/** Cuantas veces se pregunta, contando la primera. */
export const MAX_INTENTOS = 8;

/** Cuanto se espera entre una y otra. 8 intentos => hasta 35 s de espera. */
export const ESPERA_MS = 5000;

const HEADER_SECRETO = 'x-publication-machine-secret';

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Manda el parte y devuelve como acabo.
 *
 * No lanza por un fallo del servidor: devuelve el resultado para que quien
 * llama decida. Lo que si lanza es un error de red, que se trata como
 * transitorio igual que un 409.
 */
export async function confirmarDespliegue({
  siteUrl,
  secret,
  requestId,
  fetchImpl = globalThis.fetch,
  sleep = dormir,
  maxIntentos = MAX_INTENTOS,
  esperaMs = ESPERA_MS,
  log = console.log,
}) {
  const url = `${siteUrl.replace(/\/+$/, '')}/api/publication/machine`;
  const cuerpo = JSON.stringify({ requestId, ok: true });

  /* Solo lo escribe la rama HTTP: la de red ya no llega hasta aqui. */
  let ultimo = { status: 0, texto: '' };

  for (let intento = 1; intento <= maxIntentos; intento++) {
    let respuesta;

    try {
      respuesta = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [HEADER_SECRETO]: secret },
        body: cuerpo,
      });
    } catch (error) {
      /*
       * No se reintenta. Lo unico que se sabe transitorio es el 409, que es
       * el Worker diciendo con todas las letras "todavia no soy esa version".
       * Un fallo de red no dice eso: puede ser un SITE_URL equivocado, un DNS
       * que no resuelve o un corte, y ninguna de esas tres se arregla
       * esperando. Insistir solo alargaria el diagnostico.
       */
      const texto = String(error?.message ?? error);
      log(`[finalize] sin respuesta (${texto}): no se reintenta.`);

      return { ok: false, status: 0, intentos: intento, texto, agotado: false };
    }

    const texto = await respuesta.text();
    ultimo = { status: respuesta.status, texto };

    if (respuesta.ok) {
      log(
        `[finalize] confirmado en el intento ${intento}/${maxIntentos} (HTTP ${respuesta.status}).`,
      );
      return { ok: true, status: respuesta.status, intentos: intento };
    }

    /* Lo unico que se reintenta: la version desplegada aun no es la nuestra. */
    if (respuesta.status !== 409) {
      log(`[finalize] HTTP ${respuesta.status}: no se reintenta. ${texto}`);
      return { ok: false, status: respuesta.status, intentos: intento, texto, agotado: false };
    }

    log(
      `[finalize] intento ${intento}/${maxIntentos}: HTTP 409, la versión desplegada todavía no es la de esta operación.`,
    );

    if (intento === maxIntentos) break;
    await sleep(esperaMs);
  }

  log(
    `[finalize] agotados ${maxIntentos} intentos. Último: HTTP ${ultimo.status}. ${ultimo.texto}`,
  );
  return {
    ok: false,
    status: ultimo.status,
    intentos: maxIntentos,
    texto: ultimo.texto,
    agotado: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Entrada desde el workflow                                                  */
/* -------------------------------------------------------------------------- */

function fallar(motivo) {
  console.error(`[finalize] ${motivo}`);
  process.exit(1);
}

async function main() {
  const siteUrl = (process.env.SITE_URL ?? '').trim();
  const secret = (process.env.MACHINE_SECRET ?? '').trim();
  const requestId = Number((process.env.REQUEST_ID ?? '').trim());

  if (siteUrl.length === 0) fallar('falta SITE_URL.');
  if (secret.length === 0) fallar('falta MACHINE_SECRET.');
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    fallar('REQUEST_ID no es un entero positivo.');
  }

  const resultado = await confirmarDespliegue({ siteUrl, secret, requestId });

  /*
   * El codigo HTTP se ve siempre, tambien cuando sale bien. Nunca el secreto:
   * solo viaja en la cabecera y no se imprime en ningun camino.
   */
  if (!resultado.ok) {
    fallar(
      `la confirmación no se pudo entregar (HTTP ${resultado.status}` +
        `${resultado.agotado ? `, tras ${resultado.intentos} intentos` : ''}).`,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
