/**
 * Tests del workflow de publicacion y de lo que le rodea.
 *
 * Estructurales: se lee el fichero, no se ejecuta nada. Un workflow no se
 * puede probar en local, pero si se puede comprobar que dice lo que tiene que
 * decir —y sobre todo que NO dice lo que no debe—, que es donde estan los
 * errores caros: migrar la base sin querer, reconstruir despues de desplegar,
 * o dar por fallida una operacion que ya esta en linea.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const WORKFLOW = read('.github/workflows/publicar.yml');
const ENV_EXAMPLE = read('.env.example');
const PACKAGE = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

/** El indice del paso que contiene un texto, para poder ordenarlos. */
function stepIndex(needle: string): number {
  return WORKFLOW.indexOf(needle);
}

/* -------------------------------------------------------------------------- */
/* Como se dispara                                                            */
/* -------------------------------------------------------------------------- */

describe('el disparo del workflow', () => {
  it('solo se lanza a mano o por la API, con un unico input', () => {
    expect(WORKFLOW).toContain('workflow_dispatch:');
    expect(WORKFLOW).toContain('publicationRequestId:');

    // Ni la propiedad ni la accion: eso lo lee el build de la base.
    expect(WORKFLOW).not.toContain('propertyId:');
    expect(WORKFLOW).not.toContain('action:\n');
  });

  it('no se dispara solo con un push', () => {
    expect(WORKFLOW).not.toMatch(/^\s*push:/m);
    expect(WORKFLOW).not.toMatch(/^\s*schedule:/m);
  });

  it('el run lleva el numero de la operacion, para poder encontrarlo', () => {
    expect(WORKFLOW).toContain('run-name:');
    expect(WORKFLOW).toContain('${{ inputs.publicationRequestId }}');
  });
});

/* -------------------------------------------------------------------------- */
/* Exclusion global                                                           */
/* -------------------------------------------------------------------------- */

describe('la exclusion de despliegues', () => {
  it('es global, no por propiedad', () => {
    const concurrency = WORKFLOW.slice(
      WORKFLOW.indexOf('concurrency:'),
      WORKFLOW.indexOf('permissions:'),
    );

    expect(concurrency).toContain('group: codeloba-publicacion');
    // Sin nada variable dentro del grupo: si no, no excluiria nada.
    expect(concurrency).not.toContain('${{');
  });

  it('no cancela una ejecucion en marcha', () => {
    expect(WORKFLOW).toContain('cancel-in-progress: false');
  });

  it('el job pide los permisos minimos', () => {
    expect(WORKFLOW).toContain('permissions:\n  contents: read');
  });
});

/* -------------------------------------------------------------------------- */
/* Lo que hace, y en que orden                                                */
/* -------------------------------------------------------------------------- */

describe('los pasos', () => {
  it('construye la version candidata contra la D1 de produccion', () => {
    expect(WORKFLOW).toContain('CODELOBA_D1_SOURCE: remote');
    expect(WORKFLOW).toContain('CODELOBA_PUBLICATION_REQUEST: ${{ inputs.publicationRequestId }}');
  });

  it('instala del lock, sin resolver dependencias', () => {
    expect(WORKFLOW).toContain('npm ci');
    expect(WORKFLOW).not.toContain('npm install');
  });

  it('comprueba el artefacto ANTES de desplegar', () => {
    expect(stepIndex('publication:verify')).toBeLessThan(stepIndex('wrangler deploy'));
  });

  /*
   * El orden completo, en un solo test, porque el fallo que motivo esto no
   * fue que un paso estuviera mal escrito sino que estaba en el sitio
   * equivocado.
   */
  it('va en el unico orden que funciona', () => {
    const pasos = [
      'actions/checkout',
      'npm ci',
      'publication:wrangler-config',
      'run: npm run build',
      'publication:verify',
      'wrangler deploy',
      '/api/publication/machine',
    ].map((paso) => ({ paso, donde: stepIndex(paso) }));

    for (const { paso, donde } of pasos) {
      expect(donde, `falta el paso ${paso}`).toBeGreaterThan(-1);
    }

    const posiciones = pasos.map((p) => p.donde);
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
  });

  /*
   * El bug de 7B, escrito como test: `@astrojs/cloudflare` congela la
   * configuracion de Wrangler durante el build, asi que escribir el
   * identificador despues no llega a tiempo y el deploy muere quejandose del
   * binding DB.
   */
  it('escribe el identificador de la D1 ANTES de construir', () => {
    expect(stepIndex('publication:wrangler-config')).toBeLessThan(stepIndex('run: npm run build'));
  });

  it('despliega el mismo artefacto que verifico, sin reconstruir', () => {
    const entreVerifyYDeploy = WORKFLOW.slice(
      stepIndex('publication:verify'),
      stepIndex('wrangler deploy'),
    );

    expect(entreVerifyYDeploy).not.toContain('npm run build');
    expect(entreVerifyYDeploy).not.toContain('astro build');
  });

  it('construye una sola vez, y nunca despues del deploy', () => {
    const builds = WORKFLOW.match(/run: npm run build/g) ?? [];

    expect(builds).toHaveLength(1);
    expect(stepIndex('run: npm run build')).toBeLessThan(stepIndex('wrangler deploy'));
  });

  it('NO aplica migraciones de la base', () => {
    expect(WORKFLOW).not.toContain('migrations apply');
    expect(WORKFLOW).not.toContain('db:migrate');
    expect(WORKFLOW).not.toContain('d1 execute');
  });

  it('NO escribe estados editoriales por su cuenta', () => {
    expect(WORKFLOW).not.toContain('publicationStatus');
    expect(WORKFLOW).not.toContain('UPDATE properties');
  });
});

/* -------------------------------------------------------------------------- */
/* La confirmacion                                                            */
/* -------------------------------------------------------------------------- */

describe('como se confirma el resultado', () => {
  it('llama al endpoint de maquina con el secreto en la cabecera', () => {
    expect(WORKFLOW).toContain('/api/publication/machine');
    expect(WORKFLOW).toContain('x-publication-machine-secret');
  });

  it('manda solo la identidad de la operacion y el resultado', () => {
    expect(WORKFLOW).toContain('\\"requestId\\": $REQUEST_ID, \\"ok\\": true');
  });

  it('el parte de fallo solo se manda si NO se llego a desplegar', () => {
    const aviso = WORKFLOW.slice(WORKFLOW.indexOf('Avisar de que no se llegó a desplegar'));

    expect(aviso).toContain("if: failure() && env.CODELOBA_DEPLOYED != 'true'");
    expect(stepIndex('CODELOBA_DEPLOYED=true')).toBeGreaterThan(stepIndex('wrangler deploy'));
  });

  it('el token de un solo uso NO viaja al workflow', () => {
    expect(WORKFLOW).not.toContain('x-publication-token');
    expect(WORKFLOW).not.toContain('callbackToken');
  });
});

/* -------------------------------------------------------------------------- */
/* Secretos                                                                   */
/* -------------------------------------------------------------------------- */

describe('los secretos', () => {
  it('todos vienen de GitHub, ninguno esta escrito', () => {
    const sensibles = WORKFLOW.match(/^\s+(CF_\w+|CLOUDFLARE_\w+|MACHINE_SECRET|PUBLIC_\w+):.*/gm);

    expect(sensibles?.length).toBeGreaterThan(0);
    for (const linea of sensibles ?? []) {
      expect(linea).toMatch(/\$\{\{ secrets\.\w+ \}\}/);
    }
  });

  it('la configuracion no sensible va en `vars`', () => {
    expect(WORKFLOW).toContain('${{ vars.CODELOBA_SITE_URL }}');
  });

  it('no hay ningun valor con pinta de credencial', () => {
    expect(WORKFLOW).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/);
    expect(WORKFLOW).not.toMatch(/\bpk\.[A-Za-z0-9]{20,}/);
    expect(WORKFLOW).not.toMatch(/[0-9a-f]{32,}/);
  });

  it('la plantilla de entorno documenta nombres, nunca valores', () => {
    const asignaciones = ENV_EXAMPLE.match(/^[A-Z][A-Z0-9_]*=.*$/gm) ?? [];

    expect(asignaciones.length).toBeGreaterThan(0);
    for (const linea of asignaciones) expect(linea).toMatch(/=$/);
  });

  it('la plantilla nombra lo que el build de publicacion necesita', () => {
    for (const nombre of [
      'CODELOBA_D1_SOURCE',
      'CODELOBA_PUBLICATION_REQUEST',
      'CF_ACCOUNT_ID',
      'CF_D1_DATABASE_ID',
      'CF_API_TOKEN',
    ]) {
      expect(ENV_EXAMPLE).toContain(nombre);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Los scripts que usa                                                        */
/* -------------------------------------------------------------------------- */

describe('los scripts del despliegue', () => {
  it('estan declarados en package.json', () => {
    expect(PACKAGE.scripts['publication:verify']).toContain('verify-release.mjs');
    expect(PACKAGE.scripts['publication:wrangler-config']).toContain('wrangler-config.mjs');
  });

  it('la verificacion compara el manifiesto con la operacion pedida', () => {
    const script = read('scripts/verify-release.mjs');

    expect(script).toContain('CODELOBA_PUBLICATION_REQUEST');
    expect(script).toContain('manifiesto.requestId !== esperado');
    expect(script).toContain('process.exit(1)');
  });

  it('la configuracion de Wrangler no inventa identificadores ni los imprime', () => {
    const script = read('scripts/wrangler-config.mjs');

    expect(script).toContain('CF_D1_DATABASE_ID');
    expect(script).toContain('REPLACE_WITH_D1_DATABASE_ID');
    // Nunca se escribe el id en la salida.
    expect(script).not.toMatch(/console\.log\([^)]*\$\{id\}/);
  });

  it('el repositorio sigue con el placeholder, no con un id real', () => {
    expect(read('wrangler.jsonc')).toContain('REPLACE_WITH_D1_DATABASE_ID');
  });

  /*
   * El paso de configuracion modifica un fichero rastreado. Solo es aceptable
   * porque pasa en el workspace del runner, que se tira: si el workflow
   * pudiera devolver ese cambio al repositorio, el identificador acabaria
   * versionado.
   */
  it('el workflow no puede devolver al repositorio el fichero que modifica', () => {
    expect(WORKFLOW).toContain('permissions:\n  contents: read');
    expect(WORKFLOW).not.toContain('git commit');
    expect(WORKFLOW).not.toContain('git push');
    expect(WORKFLOW).not.toContain('git-auto-commit');
    expect(WORKFLOW).not.toContain('create-pull-request');
  });

  it('el id solo entra por el entorno, nunca escrito en el workflow', () => {
    const asignaciones = WORKFLOW.match(/CF_D1_DATABASE_ID:.*/g) ?? [];

    expect(asignaciones.length).toBeGreaterThan(0);
    for (const linea of asignaciones) {
      expect(linea).toBe('CF_D1_DATABASE_ID: ${{ secrets.CF_D1_DATABASE_ID }}');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* La guia operativa                                                          */
/* -------------------------------------------------------------------------- */

describe('la documentacion', () => {
  const guia = read('docs/publicacion.md');

  it('lista los secretos y variables por su nombre', () => {
    for (const nombre of [
      'CF_D1_READ_TOKEN',
      'CLOUDFLARE_API_TOKEN',
      'PUBLICATION_MACHINE_SECRET',
      'CODELOBA_SITE_URL',
      'CODELOBA_GITHUB_TOKEN',
    ]) {
      expect(guia).toContain(nombre);
    }
  });

  it('dice el permiso minimo del token de GitHub', () => {
    expect(guia).toContain('Actions: Read and write');
    expect(guia).toMatch(/fine-grained/i);
  });

  it('explica como volver al ejecutor manual y como recuperar un finalize perdido', () => {
    expect(guia).toContain('Cómo se vuelve al ejecutor manual');
    expect(guia).toContain('Comprobar si ya se publicó');
    expect(guia).toContain('Abandonar operación');
  });

  it('no lleva ningun valor real', () => {
    expect(guia).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/);
    expect(guia).not.toMatch(/[0-9a-f]{32,}/);
  });
});
