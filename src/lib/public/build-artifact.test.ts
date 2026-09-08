/**
 * Tests del artefacto: que se embebe y que NO se embebe.
 *
 * El plugin es la costura donde los datos del build se convierten en modulos
 * del bundle. Dos cosas que importan y se comprueban aqui:
 *
 * - el snapshot que se prerenderiza y el manifiesto que autoriza los archivos
 *   salen de la MISMA lectura. Si cada uno se leyera por su cuenta podrian
 *   discrepar, que es justo lo que el manifiesto viene a impedir;
 * - lo que viaja dentro del artefacto es lo minimo. Ninguna credencial, y
 *   ninguna clave de R2.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ReleaseManifest } from '../publication/release';
import { EMPTY_SNAPSHOT, type PublicSnapshot } from './read-model';
import { publicSnapshotPlugin, RELEASE_MODULE_ID, SNAPSHOT_MODULE_ID } from './snapshot-plugin';
import type { BuildData } from './snapshot-source';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

type PluginLike = {
  buildStart?: () => Promise<void> | void;
  resolveId?: (id: string) => string | null;
  load?: (id: string) => Promise<string | null> | string | null;
};

const MANIFEST: ReleaseManifest = {
  releaseId: 'publish-p7-r3',
  requestId: 3,
  generatedAt: '2026-02-01T00:00:00.000Z',
  mediaIds: [11, 12],
};

function snapshotWith(code: string): PublicSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    generatedAt: '2026-02-01T00:00:00.000Z',
    properties: {
      es: [{ code } as unknown as PublicSnapshot['properties']['es'][number]],
      en: [],
    },
  };
}

/** Carga un modulo virtual y devuelve el valor que exporta. */
async function loadModule(plugin: PluginLike, id: string): Promise<unknown> {
  const resolved = plugin.resolveId?.(id);
  expect(typeof resolved).toBe('string');

  const code = await plugin.load?.(resolved as string);
  expect(typeof code).toBe('string');

  return JSON.parse((code as string).replace(/^export default /, '').replace(/;$/, ''));
}

/* -------------------------------------------------------------------------- */
/* Los dos modulos                                                            */
/* -------------------------------------------------------------------------- */

describe('lo que el build embebe en el artefacto', () => {
  it('el snapshot y el manifiesto salen de la misma lectura', async () => {
    let reads = 0;

    const plugin = publicSnapshotPlugin({
      read: () => {
        reads += 1;
        return Promise.resolve({ snapshot: snapshotWith('QA-001'), manifest: MANIFEST });
      },
    }) as unknown as PluginLike;

    await plugin.buildStart?.();

    const snapshot = (await loadModule(plugin, SNAPSHOT_MODULE_ID)) as PublicSnapshot;
    const manifest = (await loadModule(plugin, RELEASE_MODULE_ID)) as ReleaseManifest;

    expect(reads).toBe(1);
    expect(snapshot.generatedAt).toBe(manifest.generatedAt);
    expect(manifest.requestId).toBe(3);
  });

  it('un build normal no afirma pertenecer a ninguna release', async () => {
    const plugin = publicSnapshotPlugin({
      read: () => Promise.resolve({ snapshot: EMPTY_SNAPSHOT, manifest: null }),
    }) as unknown as PluginLike;

    await plugin.buildStart?.();

    expect(await loadModule(plugin, RELEASE_MODULE_ID)).toBeNull();
  });

  it('si la frontera de datos falla, el build muere al empezar', async () => {
    const plugin = publicSnapshotPlugin({
      read: () => Promise.reject(new Error('no se pudo leer la D1 de producción')),
    }) as unknown as PluginLike;

    await expect(plugin.buildStart?.()).rejects.toThrow(/D1 de producción/);
  });

  it('no responde por modulos que no son suyos', () => {
    const plugin = publicSnapshotPlugin({
      read: () => Promise.resolve({ snapshot: EMPTY_SNAPSHOT, manifest: null } as BuildData),
    }) as unknown as PluginLike;

    expect(plugin.resolveId?.('virtual:otra-cosa')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Lo que no puede viajar                                                     */
/* -------------------------------------------------------------------------- */

describe('lo que NO viaja en el artefacto', () => {
  it('el manifiesto solo lleva identidad y archivos', async () => {
    const plugin = publicSnapshotPlugin({
      read: () => Promise.resolve({ snapshot: EMPTY_SNAPSHOT, manifest: MANIFEST }),
    }) as unknown as PluginLike;

    await plugin.buildStart?.();

    const manifest = (await loadModule(plugin, RELEASE_MODULE_ID)) as Record<string, unknown>;

    expect(Object.keys(manifest).sort()).toEqual([
      'generatedAt',
      'mediaIds',
      'releaseId',
      'requestId',
    ]);

    // Ni claves de R2 ni hashes de token: solo numeros de fila.
    expect(JSON.stringify(manifest)).not.toMatch(/objectKey|token|hash/i);
  });

  it('las credenciales no entran en el bundle: nadie las importa desde el sitio', () => {
    const remote = read('src/lib/public/d1-remote.ts');

    // El cliente remoto solo lo usa la frontera de datos, que corre en Node.
    expect(read('src/lib/public/snapshot-source.ts')).toContain('createRemoteD1');
    expect(read('src/lib/public/snapshot.ts')).not.toContain('d1-remote');
    expect(read('src/lib/publication/deployed-release.ts')).not.toContain('d1-remote');
    expect(read('src/pages/media/[id].ts')).not.toContain('d1-remote');

    // Y los nombres de las variables viven ahi; los valores, en el entorno.
    expect(remote).toContain('CF_API_TOKEN');
    expect(remote).not.toContain('process.env');
  });

  it('el token nunca se pone en la URL ni en el cuerpo de la consulta', () => {
    const remote = read('src/lib/public/d1-remote.ts');
    const authorization = remote.slice(remote.indexOf('authorization'));

    expect(remote).toContain('authorization: `Bearer ${config.apiToken}`');
    // La URL se compone sin el token.
    expect(remote).not.toContain('${config.apiToken}/');
    expect(authorization).not.toContain('JSON.stringify({ sql, params, apiToken');
  });
});

/* -------------------------------------------------------------------------- */
/* Como lo lee el Worker                                                      */
/* -------------------------------------------------------------------------- */

describe('el Worker lee su propia release', () => {
  it('el modulo desplegado sale del artefacto, no de una consulta', () => {
    const deployed = read('src/lib/publication/deployed-release.ts');

    expect(deployed).toContain("import manifest from 'virtual:release-manifest'");
    // Nada de red ni de base: el artefacto habla de si mismo.
    expect(deployed).not.toContain('fetch(');
    expect(deployed).not.toContain('drizzle');
  });

  it('la puerta de los archivos usa el manifiesto del artefacto', () => {
    expect(read('src/pages/media/[id].ts')).toContain('deployedReleaseManifest()');
    expect(read('src/lib/public/media-delivery.ts')).toContain('releaseAllowsMedia');
  });

  it('el panel recibe la release por el contexto, no la va a buscar', () => {
    expect(read('src/lib/admin/http/astro.ts')).toContain(
      'deployedRelease: deployedReleaseManifest()',
    );
    expect(read('src/lib/admin/http/publication-handlers.ts')).not.toContain('deployed-release');
  });
});
