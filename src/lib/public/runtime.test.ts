/** QA HTTP sobre Astro + workerd + D1/R2 locales, en una copia temporal aislada. */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { promisify, stripVTControlCharacters } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const project = process.cwd();
const temporary = mkdtempSync(path.join(tmpdir(), 'codeloba-r1-runtime-'));
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
  // Primero se construye sin datos, sin .env/.dev.vars y sin fuente de contenido.
  expect(existsSync(path.join(temporary, '.wrangler/state'))).toBe(false);
  await run(astro, ['build']);
  expect(existsSync(path.join(temporary, 'dist/client/index.html'))).toBe(true);
  expect(existsSync(path.join(temporary, 'dist/client/es/index.html'))).toBe(false);
  // Solo despues del build se crean las fixtures locales; nunca se usa --remote.
  await run(wrangler, ['d1', 'migrations', 'apply', 'codeloba-db', '--local']);
  await run(wrangler, ['d1', 'execute', 'codeloba-db', '--local', '--file=src/db/seed/seed.sql']);
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
    !path.basename(temporary).startsWith('codeloba-r1-runtime-')
  )
    throw new Error('Unsafe temporary path');
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function api(route: string, method = 'GET', body?: object | FormData, status = 200) {
  const multipart = body instanceof FormData;
  const response = await fetch(origin + route, {
    method,
    headers: {
      origin,
      ...(body === undefined || multipart ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
  });
  const data = (await response.json()) as { data: { id: number; publicationStatus: string } };
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

describe('HTML runtime con contenido vivo', () => {
  it('guardar configuracion cambia el siguiente HTML y conserva SEO inicial', async () => {
    await api('/api/admin/settings', 'PATCH', { businessName: 'Fixture R1' });
    await api('/api/admin/settings/translations/es', 'PUT', {
      homeHeroTitle: 'Portada viva R1',
      globalSeoTitle: 'SEO R1',
      globalSeoDescription: 'Descripcion R1',
    });
    const html = await page('/es/');
    for (const text of [
      'Portada viva R1',
      'SEO R1',
      'Descripcion R1',
      'rel="canonical"',
      'hreflang="en"',
      'hreflang="x-default"',
      'property="og:title"',
      'name="twitter:title"',
      'name="robots"',
      'application/ld+json',
      'Organization',
    ])
      expect(html).toContain(text);
    await api('/api/admin/settings/translations/es', 'PUT', {
      homeHeroTitle: 'Portada cambiada R1',
    });
    expect(await page('/es/')).toContain('Portada cambiada R1');
    expect(await page('/en/')).toContain('Fixture R1');
    await page('/es/contacto');
    await page('/en/contact');
    const settings = await page('/admin/configuracion');
    expect(settings).not.toContain('id="site-publication"');
  }, 30_000);

  it('draft → publicar → catalogo/ficha/mapa/sitemap/media → retirar → 404, ES y EN', async () => {
    for (const english of [false, true]) {
      const slug = english ? 'lote-bilingue-r1' : 'lote-solo-es-r1';
      const draft = await api(
        '/api/admin/properties',
        'POST',
        { propertyTypeId: 1, title: slug },
        201,
      );
      const id = draft.data.id as number;
      const base = `/api/admin/properties/${id}`;
      await api(`${base}/publication/publish`, 'POST', undefined, 422);
      await api(base, 'PATCH', {
        priceMode: 'contact',
        areaSquareMeters: 1200,
        locationPrecision: 'approximate',
        publicLatitude: 9.9,
        publicLongitude: -84.1,
        privateLatitude: 9.87654321,
        privateLongitude: -84.98765432,
        isFeatured: true,
      });
      await api(`${base}/translations/es`, 'PUT', {
        title: 'Lote de prueba R1',
        slug,
        marketingDescription: 'Descripcion de la ficha R1.',
      });
      if (english)
        await api(`${base}/translations/en`, 'PUT', {
          title: 'Test lot R1',
          slug: 'test-lot-r1',
          marketingDescription: 'Runtime test lot.',
        });
      const form = new FormData();
      // PNG real de 1x1: solo fixture de entrega, sin servicios de imagen externos.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0L8AAAAASUVORK5CYII=',
        'base64',
      );
      form.set('file', new Blob([png], { type: 'image/png' }), 'fixture.png');
      form.set('mediaKind', 'image');
      const upload = await api(`${base}/media/upload`, 'POST', form, 201);
      const mediaId = upload.data.id as number;
      await api(`${base}/media/${mediaId}/roles`, 'PUT', { isHero: true, isCatalogCover: true });
      const editor = await page(`/admin/propiedades/${id}`);
      expect(editor).not.toContain('id="editor-review"');
      await page(`/es/propiedades/${slug}`, 404);
      await page(`/media/${mediaId}`, 404);
      expect((await api(`${base}/publication/publish`, 'POST')).data.publicationStatus).toBe(
        'published',
      );
      for (const route of ['/es/', '/es/propiedades', '/es/mapa', '/sitemap.xml'])
        expect(await page(route)).toContain(slug);
      const detail = await page(`/es/propiedades/${slug}`);
      for (const text of [
        'rel="canonical"',
        'application/ld+json',
        'og:title',
        'twitter:card',
        'Descripcion de la ficha R1.',
      ])
        expect(detail).toContain(text);
      expect(detail).toContain(`https://runtime.example.test/es/propiedades/${slug}`);
      if (english) {
        expect(detail).toContain('hreflang="en"');
        expect(await page('/en/propiedades/test-lot-r1')).toContain('hreflang="es"');
        for (const route of ['/en/propiedades', '/en/map', '/sitemap.xml'])
          expect(await page(route)).toContain('test-lot-r1');
      } else {
        expect(detail).not.toContain('hreflang="en"');
        await page(`/en/propiedades/${slug}`, 404);
        expect(await page('/en/propiedades')).not.toContain(slug);
      }
      const media = await fetch(`${origin}/media/${mediaId}`);
      expect(media.status).toBe(200);
      expect(media.headers.get('x-content-type-options')).toBe('nosniff');
      expect(media.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=86400');
      const etag = media.headers.get('etag');
      expect(etag).toBeTruthy();
      expect(
        (await fetch(`${origin}/media/${mediaId}`, { headers: { 'if-none-match': etag! } })).status,
      ).toBe(304);
      expect((await api(`${base}/publication/unpublish`, 'POST')).data.publicationStatus).toBe(
        'draft',
      );
      for (const route of ['/es/', '/es/propiedades', '/es/mapa', '/sitemap.xml'])
        expect(await page(route)).not.toContain(slug);
      const missing = await page(`/es/propiedades/${slug}`, 404);
      expect(missing).toContain('noindex, follow');
      expect(missing).not.toContain('rel="canonical"');
      await page(`/media/${mediaId}`, 404);
      if (english) {
        await page('/en/propiedades/test-lot-r1', 404);
        for (const route of ['/en/propiedades', '/en/map', '/sitemap.xml'])
          expect(await page(route)).not.toContain('test-lot-r1');
      }
    }
    const result = await run(wrangler, [
      'd1',
      'execute',
      'codeloba-db',
      '--local',
      '--command=SELECT count(*) AS total FROM publication_requests',
      '--json',
    ]);
    expect(JSON.parse(result.stdout)[0].results[0].total).toBe(0);
    expect(readFileSync(path.join(temporary, 'astro.config.mjs'), 'utf8')).not.toContain(
      'publicSnapshotPlugin',
    );
  }, 60_000);

  it('el Worker construido sirve D1 vivo y sigue cerrado aunque se configure el bypass', async () => {
    await stopServer();
    output = '';
    server = spawn(
      process.execPath,
      [
        wrangler,
        'dev',
        '--config',
        'dist/server/wrangler.json',
        '--local',
        '--ip',
        '127.0.0.1',
        '--port',
        '0',
        '--inspector-port',
        '0',
        '--persist-to',
        path.join(temporary, '.wrangler/state'),
        '--var',
        'ADMIN_DEV_BYPASS:true',
      ],
      {
        cwd: temporary,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    server.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    server.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    let ready = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      const match = stripVTControlCharacters(output).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        origin = `http://127.0.0.1:${match[1]}`;
        try {
          if ((await fetch(origin)).ok) {
            ready = true;
            break;
          }
        } catch {
          /* Arrancando. */
        }
      }
      if (server.exitCode !== null) throw new Error(output);
      await delay(250);
    }
    expect(ready, output).toBe(true);
    expect(await page('/es/')).toContain('Portada cambiada R1');
    for (const route of [
      '/admin',
      '/admin/configuracion',
      '/admin/propiedades/1',
      '/api/admin/properties',
    ]) {
      const response = await fetch(origin + route);
      expect(
        response.status,
        `${route} ${response.url} ${JSON.stringify([...response.headers])}\n${output.slice(-6000)}`,
      ).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    await api('/api/admin/properties/1/publication/publish', 'POST', undefined, 403);
  }, 60_000);
});
