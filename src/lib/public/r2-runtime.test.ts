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
  const migration = 'drizzle/0008_r2_simple_core.sql';
  rmSync(path.join(temporary, migration));
  await run(wrangler, ['d1', 'migrations', 'apply', 'codeloba-db', '--local']);
  for (const file of ['legacy-seed.sql', 'r2-legacy-fixture.sql'])
    await run(wrangler, ['d1', 'execute', 'codeloba-db', '--local', `--file=src/db/tests/${file}`]);
  const excluded = await sql(
    "SELECT count(*) AS total FROM property_media WHERE source_provider='r2' AND media_kind IN ('document','video')",
  );
  expect(excluded[0]?.total).toBe(0);
  cpSync(path.join(project, migration), path.join(temporary, migration));
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

// Solo la fixture de migracion y un ciclo de publicacion, sin matriz historica.
describe('R2: migracion y smoke minimo', () => {
  it('conserva la ficha ES/EN, media, features, tour, settings y contacto', async () => {
    const tables = await sql(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_KV','_cf_METADATA') ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(['contacts', 'media', 'properties', 'site_settings']);
    expect(await sql('PRAGMA foreign_key_check')).toEqual([]);
    const [p] = await sql('SELECT * FROM properties WHERE id=7');
    expect(p).toMatchObject({
      id: 7,
      code: 'CR360-012',
      status: 'published',
      commercial_status: 'sold',
      type: 'lot',
      featured: 1,
      price_amount_minor: 1234500,
      area_square_meters: 1250,
      map_latitude: 9.9,
      map_longitude: -84.1,
      slug_es: 'lote-migrado',
      slug_en: 'migrated-lot',
      title_en: 'Migrated lot',
      description_en: 'Preserved description',
      details_en: 'Preserved details',
    });
    expect(p).not.toHaveProperty('private_latitude');
    expect(JSON.parse(p!.features_json as string)).toEqual([
      {
        label_es: 'Servicios: Agua',
        label_en: 'Utilities: Water',
        value_es: 'S\u00ed',
        value_en: 'Yes',
      },
    ]);
    expect(JSON.parse(p!.tour_json as string)).toEqual({
      startMediaId: 13,
      nodes: [
        {
          mediaId: 12,
          name_es: 'Entrada',
          name_en: 'Entrance',
          initialView: { yaw: 0.5, pitch: -0.1, fov: 70 },
          links: [{ toMediaId: 13, yaw: 1.4, pitch: -0.1 }],
        },
        {
          mediaId: 13,
          name_es: 'Mirador',
          name_en: 'Lookout',
          initialView: { yaw: 1.4, pitch: 0.2, fov: 80 },
          links: [{ toMediaId: 12, yaw: -1.2, pitch: 0.2 }],
        },
      ],
    });
    const files = await sql(
      'SELECT id,kind,is_cover,alt_es,alt_en,youtube_video_id FROM media ORDER BY sort_order,id',
    );
    expect(files.map((m) => [m.id, m.kind, m.is_cover])).toEqual([
      [10, 'image', 1],
      [12, 'panorama', 0],
      [13, 'panorama', 0],
      [14, 'youtube', 0],
    ]);
    expect(files[0]).toMatchObject({ alt_es: 'Vista del lote', alt_en: 'Lot view' });
    expect(files[3]?.youtube_video_id).toBe('abcdefghijk');
    const [settings] = await sql('SELECT * FROM site_settings');
    expect(settings).toMatchObject({
      business_name: 'Fixture R2',
      logo_object_key: 'fixture/logo.png',
      favicon_object_key: 'fixture/favicon.png',
      social_image_object_key: 'fixture/social.png',
      hero_object_key: 'fixture/hero.png',
      hero_title_es: 'Portada migrada',
      hero_title_en: 'Migrated home',
    });
    expect(JSON.parse(settings!.social_links_json as string)).toEqual([
      { platform: 'Instagram', url: 'https://instagram.com/example' },
    ]);
    expect((await sql('SELECT * FROM contacts'))[0]).toMatchObject({
      id: 8,
      property_id: 7,
      name: 'Ana',
      message: 'Consulta conservada',
      locale: 'es',
      status: 'new',
    });
    // Una vendida publicada sigue visible; el tour migrado usa mediaId.
    const detail = await page('/es/propiedades/lote-migrado');
    expect(detail).toContain('Servicios: Agua');
    const tour = JSON.parse(detail.match(/id="tour-data"[^>]*>([\s\S]*?)<\/script>/)![1]!);
    expect(tour.start).toBe('13');
    expect(tour.nodes.map((n: { key: string }) => n.key)).toEqual(['12', '13']);
    expect(tour.nodes[0].links).toEqual([{ to: '13', yaw: 1.4, pitch: -0.1 }]);
    expect(await page('/en/propiedades/migrated-lot')).toContain('Migrated lot');
    expect(detail).not.toContain('internal@example.test');
  }, 30_000);

  it('crea, guarda toda la ficha, sube una imagen, publica y retira de inmediato', async () => {
    const created = await api('/api/admin/properties', 'POST', {}, 201);
    expect(created.data.code).toBe('CR360-013');
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
