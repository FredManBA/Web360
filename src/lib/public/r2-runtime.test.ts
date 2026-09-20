/** QA HTTP sobre Astro + workerd + D1/R2 locales, en una copia temporal aislada. */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { promisify, stripVTControlCharacters } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const project = process.cwd();
const temporary = mkdtempSync(path.join(tmpdir(), 'codeloba-r2-runtime-'));
const astro = path.join(project, 'node_modules/astro/bin/astro.mjs');
const wrangler = path.join(project, 'node_modules/wrangler/bin/wrangler.js');
const env = Object.fromEntries(
  // Vitest inyecta DEV/PROD en process.env; no deben definir el modo del build hijo.
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(CODELOBA_|CF_|CLOUDFLARE_|PUBLIC_MAPBOX_|ADMIN_|GITHUB_|RESEND_|VITE_|VITEST)/.test(
        key,
      ) && !['DEV', 'PROD', 'MODE', 'TEST'].includes(key),
  ),
);
Object.assign(env, {
  CI: 'true',
  ASTRO_DEV_BACKGROUND: '1',
  NODE_ENV: 'production',
  ASTRO_TELEMETRY_DISABLED: '1',
  WRANGLER_SEND_METRICS: 'false',
  CODELOBA_SITE_URL: 'https://runtime.example.test',
});
let server: ChildProcess | undefined;
let output = '';
let origin = '';

async function run(cli: string, args: string[]) {
  return exec(process.execPath, [cli, ...args], {
    cwd: temporary,
    env,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

beforeAll(async () => {
  for (const entry of [
    'src',
    'public',
    'drizzle',
    'package.json',
    'astro.config.mjs',
    'wrangler.jsonc',
    'tsconfig.json',
  ]) {
    cpSync(path.join(project, entry), path.join(temporary, entry), { recursive: true });
  }
  symlinkSync(path.join(project, 'node_modules'), path.join(temporary, 'node_modules'), 'junction');
  // Compartimos paquetes instalados, pero nunca los caches de Vite/Astro.
  const config = path.join(temporary, 'astro.config.mjs');
  writeFileSync(
    config,
    readFileSync(config, 'utf8').replace(
      'defineConfig({',
      "defineConfig({ cacheDir: './.astro-cache', vite: { cacheDir: './.vite-cache' },",
    ),
  );
  // Base vacia: el baseline crea las cuatro tablas y no hay datos previos.
  await run(wrangler, ['d1', 'migrations', 'apply', 'codeloba-db', '--local']);
  writeFileSync(path.join(temporary, '.dev.vars'), 'ADMIN_DEV_BYPASS=true\n');
  server = spawn(process.execPath, [astro, 'dev', '--host', '127.0.0.1', '--port', '0'], {
    cwd: temporary,
    env: { ...env, NODE_ENV: 'development' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (data: Buffer) => {
    output += data.toString();
  });
  server.stderr?.on('data', (data: Buffer) => {
    output += data.toString();
  });
  for (let attempt = 0; attempt < 180; attempt++) {
    const match = stripVTControlCharacters(output).match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      origin = `http://127.0.0.1:${match[1]}`;
      try {
        if ((await fetch(origin)).ok) return;
      } catch {
        /* Aun arrancando. */
      }
    }
    if (server.exitCode !== null) throw new Error(output);
    await delay(250);
  }
  throw new Error(`Astro no arranco: ${output}`);
}, 180_000);

async function stopServer() {
  if (server?.pid !== undefined && server.exitCode === null) {
    const closed = once(server, 'close');
    if (process.platform === 'win32')
      await exec('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true }).catch(
        () => {},
      );
    else server.kill('SIGTERM');
    await closed;
    await delay(250);
  }
}

afterAll(async () => {
  await stopServer();
  // Se comprueba el destino antes del borrado recursivo de la fixture.
  if (
    path.dirname(temporary) !== path.resolve(tmpdir()) ||
    !path.basename(temporary).startsWith('codeloba-r2-runtime-')
  )
    throw new Error('Unsafe temporary path');
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function api<T = { id: number; status: string; code: string }>(
  route: string,
  method = 'GET',
  body?: object | FormData,
  status = 200,
) {
  const multipart = body instanceof FormData;
  const response = await fetch(origin + route, {
    method,
    headers: {
      origin,
      ...(body === undefined || multipart ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
  });
  const data = (await response.json()) as { data: T };
  expect(response.status, JSON.stringify(data)).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return data;
}

async function page(route: string, status = 200) {
  const response = await fetch(origin + route);
  const html = await response.text();
  expect(response.status, html.slice(0, 600)).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  if (!route.startsWith('/admin')) {
    expect(html).not.toMatch(/privateLatitude|privateLongitude|9\.87654321|-84\.98765432/);
  }
  return html;
}

async function sql(command: string): Promise<Record<string, unknown>[]> {
  const result = await run(wrangler, [
    'd1',
    'execute',
    'codeloba-db',
    '--local',
    `--command=${command}`,
    '--json',
  ]);
  return JSON.parse(result.stdout)[0].results;
}

// Base nueva y un ciclo de publicacion; no hay historia que simular.
describe('Runtime: base nueva y smoke minimo', () => {
  it('el baseline deja solo las cuatro tablas y ningun dato previo', async () => {
    const tables = await sql(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_KV','_cf_METADATA') ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(['contacts', 'media', 'properties', 'site_settings']);
    expect(await sql('PRAGMA foreign_key_check')).toEqual([]);
    expect((await sql('SELECT count(*) AS total FROM properties'))[0]?.total).toBe(0);
  }, 30_000);

  it('crea, guarda toda la ficha, sube una imagen, publica y retira de inmediato', async () => {
    const created = await api('/api/admin/properties', 'POST', {}, 201);
    expect(created.data.code).toBe('CR360-001');
    expect(created.data.status).toBe('draft');
    const base = `/api/admin/properties/${created.data.id}`;
    const data = {
      type: 'lot',
      commercialStatus: 'available',
      featured: false,
      priceMode: 'contact',
      priceAmountMinor: null,
      currencyCode: 'USD',
      areaSquareMeters: 1200,
      province: 'Guanacaste',
      canton: null,
      district: null,
      locality: null,
      mapLatitude: 9.9,
      mapLongitude: -84.1,
      locationPrecision: 'approximate',
      titleEs: 'Lote smoke R2',
      slugEs: 'lote-smoke-r2',
      descriptionEs: 'Descripcion smoke R2',
      detailsEs: null,
      titleEn: null,
      slugEn: null,
      descriptionEn: null,
      detailsEn: null,
      featuresJson: [],
    };
    await api(base, 'PUT', data);
    await page(`/admin/propiedades/${created.data.id}`);
    const form = new FormData();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0L8AAAAASUVORK5CYII=',
      'base64',
    );
    form.set('file', new Blob([png], { type: 'image/png' }), 'fixture.png');
    form.set('kind', 'image');
    const upload = await api(`${base}/media`, 'POST', form, 201);
    await api(`${base}/media/${upload.data.id}`, 'PATCH', { isCover: true });
    expect((await api(`${base}/publish`, 'POST')).data.status).toBe('published');
    expect(await page('/es/propiedades')).toContain('lote-smoke-r2');
    const detail = await page('/es/propiedades/lote-smoke-r2');
    for (const text of ['Descripcion smoke R2', 'rel="canonical"', 'application/ld+json'])
      expect(detail).toContain(text);
    expect((await fetch(`${origin}/media/${upload.data.id}`)).status).toBe(200);
    expect((await api(`${base}/unpublish`, 'POST')).data.status).toBe('draft');
    expect(await page('/es/propiedades')).not.toContain('lote-smoke-r2');
    await page('/es/propiedades/lote-smoke-r2', 404);
    await page(`/media/${upload.data.id}`, 404);
  }, 30_000);
});
