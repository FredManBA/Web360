/**
 * Tests del ejecutor de GitHub Actions.
 *
 * Con `fetch` inyectado: no se llama a GitHub, no hay credenciales de verdad y
 * no se dispara nada.
 *
 * Lo que mas se mira es lo que NO viaja. Los inputs de un `workflow_dispatch`
 * los ve cualquiera que pueda leer los runs del repositorio, asi que meter ahi
 * el token de callback o una credencial equivaldria a publicarlos.
 */

import { describe, expect, it } from 'vitest';

import {
  gitHubJobRef,
  gitHubPublishTrigger,
  readGitHubTriggerConfig,
  resolvePublishTrigger,
  type GitHubTriggerConfig,
} from './github-trigger';
import type { PublishTriggerJob } from './trigger';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

const ENV = {
  CODELOBA_GITHUB_REPOSITORY: 'ejemplo/sitio',
  CODELOBA_GITHUB_WORKFLOW: 'publicar.yml',
  CODELOBA_GITHUB_REF: 'main',
  CODELOBA_GITHUB_TOKEN: 'token-de-prueba',
};

const JOB: PublishTriggerJob = {
  requestId: 42,
  propertyId: 7,
  action: 'publish',
  callbackToken: 'TOKEN-SECRETO-DE-CALLBACK',
  callbackPath: '/api/publication/callback',
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Un GitHub falso que apunta lo que le llega. */
function fakeGitHub(status = 204, payload: unknown = null, calls: Call[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ''),
    });

    return status === 204
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(payload ?? {}), {
          status,
          headers: { 'content-type': 'application/json' },
        });
  }) as unknown as typeof fetch;
}

function trigger(fetchImpl: typeof fetch, overrides: Partial<GitHubTriggerConfig> = {}) {
  return gitHubPublishTrigger({
    repository: 'ejemplo/sitio',
    workflow: 'publicar.yml',
    ref: 'main',
    token: 'token-de-prueba',
    apiBase: 'https://github.example.test',
    fetchImpl,
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* Configuracion                                                              */
/* -------------------------------------------------------------------------- */

describe('la configuracion del ejecutor', () => {
  it('sin ninguna variable no hay ejecutor de GitHub', () => {
    expect(readGitHubTriggerConfig({})).toBeNull();
  });

  it('con las cuatro, la lee entera', () => {
    expect(readGitHubTriggerConfig(ENV)).toEqual({
      repository: 'ejemplo/sitio',
      workflow: 'publicar.yml',
      ref: 'main',
      token: 'token-de-prueba',
    });
  });

  it('admite apuntar a otro GitHub, y por defecto no lo hace', () => {
    expect(readGitHubTriggerConfig(ENV)?.apiBase).toBeUndefined();
    expect(
      readGitHubTriggerConfig({ ...ENV, CODELOBA_GITHUB_API_BASE: 'https://github.example.test' })
        ?.apiBase,
    ).toBe('https://github.example.test');
  });

  it('media configuracion es un error, y dice cual falta', () => {
    const incompleta = { ...ENV, CODELOBA_GITHUB_TOKEN: '' };

    expect(() => readGitHubTriggerConfig(incompleta)).toThrow(/CODELOBA_GITHUB_TOKEN/);
  });

  it('un repositorio con forma rara no se acepta', () => {
    expect(() => readGitHubTriggerConfig({ ...ENV, CODELOBA_GITHUB_REPOSITORY: 'sitio' })).toThrow(
      /propietario\/repositorio/,
    );
  });

  it('sin GitHub configurado se usa el ejecutor manual', () => {
    expect(resolvePublishTrigger({}).name).toBe('manual');
    expect(resolvePublishTrigger(ENV).name).toBe('github-actions');
  });

  it('el ejecutor manual solo enseña el token en desarrollo', async () => {
    const enDev = await resolvePublishTrigger({}, { isDev: true }).start(JOB);
    const enProduccion = await resolvePublishTrigger({}, { isDev: false }).start(JOB);

    expect(enDev.ok && enDev.manual?.callbackToken).toBe(JOB.callbackToken);
    expect(enProduccion.ok && enProduccion.manual).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* El disparo                                                                 */
/* -------------------------------------------------------------------------- */

describe('disparar el workflow', () => {
  it('llama al endpoint de dispatch del workflow configurado', async () => {
    const calls: Call[] = [];
    const result = await trigger(fakeGitHub(204, null, calls)).start(JOB);

    expect(result.ok).toBe(true);

    expect(calls[0]?.url).toBe(
      'https://github.example.test/repos/ejemplo/sitio/actions/workflows/publicar.yml/dispatches',
    );
    expect(calls[0]?.headers.authorization).toBe('Bearer token-de-prueba');
    expect(calls[0]?.headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('manda la rama y SOLO el numero de la operacion', async () => {
    const calls: Call[] = [];
    await trigger(fakeGitHub(204, null, calls)).start(JOB);

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      ref: 'main',
      inputs: { publicationRequestId: '42' },
    });
  });

  it('NUNCA manda el token de callback ni credenciales', async () => {
    const calls: Call[] = [];
    await trigger(fakeGitHub(204, null, calls)).start(JOB);

    const enviado = `${calls[0]?.url} ${calls[0]?.body}`;

    expect(enviado).not.toContain(JOB.callbackToken);
    expect(enviado).not.toContain(JOB.callbackPath);
    // El token de GitHub va en la cabecera, no en la URL ni en el cuerpo.
    expect(enviado).not.toContain('token-de-prueba');
  });

  it('tampoco manda la propiedad ni la accion: eso lo lee el build de la base', async () => {
    const calls: Call[] = [];
    await trigger(fakeGitHub(204, null, calls)).start(JOB);

    const inputs = (JSON.parse(calls[0]?.body ?? '{}') as { inputs: Record<string, string> })
      .inputs;

    expect(Object.keys(inputs)).toEqual(['publicationRequestId']);
  });

  it('devuelve una referencia con la que encontrar el trabajo', async () => {
    const result = await trigger(fakeGitHub()).start(JOB);

    expect(result.ok && result.jobRef).toBe('github:ejemplo/sitio/publicar.yml@main#req-42');
    expect(gitHubJobRef({ ...ENV } as never, 1)).not.toContain('token');
  });

  it('no devuelve instrucciones manuales: aqui no hay nadie copiando nada', async () => {
    const result = await trigger(fakeGitHub()).start(JOB);

    expect(result.ok && result.manual).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Cuando GitHub dice que no                                                  */
/* -------------------------------------------------------------------------- */

describe('fallos de la API de GitHub', () => {
  it('una credencial rechazada se cuenta sin filtrarla', async () => {
    const result = await trigger(fakeGitHub(401, { message: 'Bad credentials' })).start(JOB);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/credencial/i);
      expect(result.error).not.toContain('token-de-prueba');
    }
  });

  it('un repositorio o workflow que no existe se explica', async () => {
    const result = await trigger(fakeGitHub(404, { message: 'Not Found' })).start(JOB);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no encuentra/i);
  });

  it('cualquier otro error lleva el codigo y el motivo de GitHub', async () => {
    const result = await trigger(fakeGitHub(422, { message: 'Required input not provided' })).start(
      JOB,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('422');
  });

  it('una respuesta 200 tampoco vale: el dispatch correcto es 204', async () => {
    const result = await trigger(fakeGitHub(200, {})).start(JOB);

    expect(result.ok).toBe(false);
  });

  it('una caida de red no revienta: se rechaza el trabajo', async () => {
    const offline = (async () => {
      throw new Error('ECONNREFUSED 140.82.121.6:443');
    }) as unknown as typeof fetch;

    const result = await trigger(offline).start(JOB);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('No se pudo contactar con GitHub.');
      expect(result.error).not.toContain('140.82');
    }
  });
});
