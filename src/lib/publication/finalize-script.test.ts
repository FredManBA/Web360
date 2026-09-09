/**
 * Tests del paso que confirma el despliegue al terminar el workflow.
 *
 * Lo que se prueba es la unica decision que toma: que reintenta y que no.
 * Importa porque el 409 significa "la version desplegada todavia no es la
 * tuya" —transitorio, se espera— mientras que un 401 significa "el secreto no
 * cuadra", y esperar por eso solo alarga un fallo de configuracion.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { confirmarDespliegue, MAX_INTENTOS } from '../../../scripts/publication-finalize.mjs';

const SECRETO = 'secreto-de-prueba-que-no-debe-aparecer';

/** Un doble de `fetch` que va devolviendo las respuestas de la lista. */
function respuestas(...codigos: (number | Error)[]): {
  fetchImpl: typeof fetch;
  llamadas: { url: string; init: RequestInit }[];
} {
  const llamadas: { url: string; init: RequestInit }[] = [];
  let i = 0;

  const fetchImpl: typeof fetch = async (entrada, init) => {
    llamadas.push({ url: String(entrada), init: init ?? {} });
    const siguiente = codigos[Math.min(i++, codigos.length - 1)];

    if (siguiente instanceof Error) throw siguiente;

    const cuerpo =
      siguiente === 409 ? '{"ok":false,"error":{"code":"not_applicable"}}' : '{"ok":true}';
    return new Response(cuerpo, { status: siguiente });
  };

  return { fetchImpl, llamadas };
}

interface Resultado {
  ok: boolean;
  status: number;
  intentos: number;
  agotado?: boolean;
  texto?: string;
}

async function ejecutar(
  codigos: (number | Error)[],
  opciones: { maxIntentos?: number } = {},
): Promise<{ resultado: Resultado; esperas: number[]; registro: string[]; llamadas: number }> {
  const { fetchImpl, llamadas } = respuestas(...codigos);
  const esperas: number[] = [];
  const registro: string[] = [];

  const resultado = (await confirmarDespliegue({
    siteUrl: 'https://codeloba.codeloba.workers.dev',
    secret: SECRETO,
    requestId: 1,
    fetchImpl,
    sleep: async (ms: number) => {
      esperas.push(ms);
    },
    log: (linea: string) => registro.push(linea),
    ...opciones,
  })) as Resultado;

  return { resultado, esperas, registro, llamadas: llamadas.length };
}

/* -------------------------------------------------------------------------- */

describe('la confirmacion del despliegue', () => {
  it('manda el parte a la ruta de maquina, con el secreto en la cabecera', async () => {
    const { fetchImpl, llamadas } = respuestas(200);

    await confirmarDespliegue({
      siteUrl: 'https://codeloba.codeloba.workers.dev/',
      secret: SECRETO,
      requestId: 7,
      fetchImpl,
      sleep: async () => {},
      log: () => {},
    });

    const [llamada] = llamadas;
    expect(llamada?.url).toBe('https://codeloba.codeloba.workers.dev/api/publication/machine');
    expect(llamada?.init.method).toBe('POST');
    expect((llamada?.init.headers as Record<string, string>)['x-publication-machine-secret']).toBe(
      SECRETO,
    );
    expect(llamada?.init.body).toBe('{"requestId":7,"ok":true}');
  });

  it('a la primera, sin esperar', async () => {
    const { resultado, esperas, llamadas } = await ejecutar([200]);

    expect(resultado.ok).toBe(true);
    expect(resultado.intentos).toBe(1);
    expect(esperas).toEqual([]);
    expect(llamadas).toBe(1);
  });
});

describe('el 409, que es el caso transitorio', () => {
  it('un 409 y luego exito: reintenta y sale bien', async () => {
    const { resultado, esperas, llamadas } = await ejecutar([409, 200]);

    expect(resultado.ok).toBe(true);
    expect(resultado.intentos).toBe(2);
    expect(llamadas).toBe(2);
    // Espero entre uno y otro, una sola vez.
    expect(esperas).toHaveLength(1);
    expect(esperas[0]).toBeGreaterThan(0);
  });

  it('aguanta varios 409 seguidos antes de acertar', async () => {
    const { resultado, llamadas } = await ejecutar([409, 409, 409, 200]);

    expect(resultado.ok).toBe(true);
    expect(resultado.intentos).toBe(4);
    expect(llamadas).toBe(4);
  });

  it('si el 409 no se va nunca, el paso falla', async () => {
    const { resultado, esperas, llamadas } = await ejecutar([409]);

    expect(resultado.ok).toBe(false);
    expect(resultado.agotado).toBe(true);
    expect(resultado.status).toBe(409);
    expect(resultado.intentos).toBe(MAX_INTENTOS);
    expect(llamadas).toBe(MAX_INTENTOS);
    // No se espera despues del ultimo intento: seria tiempo tirado.
    expect(esperas).toHaveLength(MAX_INTENTOS - 1);
  });

  it('el limite es acotado y modesto', async () => {
    expect(MAX_INTENTOS).toBeGreaterThanOrEqual(3);
    expect(MAX_INTENTOS).toBeLessThanOrEqual(12);
  });
});

describe('los errores que NO son transitorios', () => {
  it('401 falla en el acto, sin gastar reintentos', async () => {
    const { resultado, esperas, llamadas } = await ejecutar([401, 200]);

    expect(resultado.ok).toBe(false);
    expect(resultado.status).toBe(401);
    expect(resultado.intentos).toBe(1);
    expect(resultado.agotado).toBe(false);
    expect(llamadas).toBe(1);
    expect(esperas).toEqual([]);
  });

  it('403 tampoco se reintenta', async () => {
    const { resultado, llamadas, esperas } = await ejecutar([403, 200]);

    expect(resultado.ok).toBe(false);
    expect(resultado.status).toBe(403);
    expect(llamadas).toBe(1);
    expect(esperas).toEqual([]);
  });

  it('un cuerpo mal formado (422) o un 500 tampoco', async () => {
    for (const codigo of [422, 500]) {
      const { resultado, llamadas } = await ejecutar([codigo, 200]);

      expect(resultado.ok).toBe(false);
      expect(resultado.status).toBe(codigo);
      expect(llamadas).toBe(1);
    }
  });
});

describe('un fallo de red', () => {
  /*
   * Tampoco se reintenta. Un 409 es el Worker diciendo "todavia no soy esa
   * version"; un fallo de red no dice nada de eso y suele ser un SITE_URL
   * equivocado o un DNS que no resuelve, que esperando no se arreglan.
   */
  it('falla en el acto: un solo intento y cero esperas', async () => {
    const { resultado, esperas, llamadas } = await ejecutar([new Error('ECONNRESET'), 200]);

    expect(resultado.ok).toBe(false);
    expect(resultado.intentos).toBe(1);
    expect(resultado.agotado).toBe(false);
    expect(llamadas).toBe(1);
    expect(esperas).toEqual([]);
  });

  it('deja ver el motivo, sin codigo HTTP porque no lo hubo', async () => {
    const { resultado, registro } = await ejecutar([new Error('ECONNRESET')]);

    expect(resultado.status).toBe(0);
    expect(resultado.texto).toContain('ECONNRESET');
    expect(registro.join('\n')).toContain('ECONNRESET');
  });
});

describe('lo que se ve por pantalla', () => {
  it('el codigo HTTP final siempre, el secreto nunca', async () => {
    const { registro } = await ejecutar([409, 401]);
    const todo = registro.join('\n');

    expect(todo).toContain('409');
    expect(todo).toContain('401');
    expect(todo).not.toContain(SECRETO);
  });

  it('tampoco se filtra el secreto cuando sale bien', async () => {
    const { registro } = await ejecutar([200]);

    expect(registro.join('\n')).not.toContain(SECRETO);
  });
});

describe('el script', () => {
  const fuente = readFileSync(
    path.resolve(process.cwd(), 'scripts/publication-finalize.mjs'),
    'utf8',
  );

  it('no imprime el secreto por ningun camino', () => {
    expect(fuente).not.toMatch(/console\.\w+\([^)]*secret/i);
  });

  it('solo reintenta el 409', () => {
    expect(fuente).toContain('respuesta.status !== 409');
    // Hay un unico `await sleep(...)` por vuelta, y esta en la rama del 409.
    expect(fuente.split('await sleep(').length - 1).toBe(1);
  });
});
