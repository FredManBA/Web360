/**
 * Integracion entre Cloudflare Access y la API administrativa.
 *
 * Comprueba que un JWT real firmado llega hasta el handler, y que uno
 * invalido nunca alcanza el CRUD. Los tests de la Fase 2C siguen usando el
 * bypass local para no firmar un token en cada caso.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose';

import { createMemoryBucket } from '../media/bucket';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import type { AdminAuthEnv } from '../auth/authorize';
import {
  handleCreateProperty,
  handleListProperties,
  handleListPropertyTypes,
  type AdminHttpContext,
} from './handlers';

const BASE = 'https://panel.codeloba.test';
const TEAM_DOMAIN = 'https://codeloba.cloudflareaccess.com';
const AUDIENCE = 'test-audience-tag';

let privateKey: CryptoKey;
let foreignPrivateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;

  const foreign = await generateKeyPair('RS256', { extractable: true });
  foreignPrivateKey = foreign.privateKey;

  const publicJwk = await exportJWK(pair.publicKey);
  jwks = createLocalJWKSet({ keys: [{ ...publicJwk, alg: 'RS256', use: 'sig' }] });
});

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

async function accessToken(key: CryptoKey = privateKey): Promise<string> {
  return new SignJWT({ email: 'admin@codeloba.test' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer(TEAM_DOMAIN)
    .setAudience(AUDIENCE)
    .setSubject('sub-admin')
    .setExpirationTime('10m')
    .sign(key);
}

/** Entorno productivo: sin bypass posible, con Access configurado. */
function productionEnv(extra: Partial<AdminAuthEnv> = {}): AdminAuthEnv {
  return {
    isDev: false,
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUDIENCE,
    ...extra,
  };
}

function ctxWith(request: Request, env: AdminAuthEnv): AdminHttpContext {
  return { request, params: {}, db, bucket: createMemoryBucket(), env, accessKeyResolver: jwks };
}

function requestWith(token: string | undefined, method = 'GET'): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token !== undefined) headers.set('Cf-Access-Jwt-Assertion', token);

  return new Request(`${BASE}/api/admin/properties`, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: '{}' }),
  });
}

function countProperties(): number {
  return (sqlite.prepare('SELECT COUNT(*) AS n FROM properties').get() as { n: number }).n;
}

describe('API administrativa con Cloudflare Access', () => {
  it('(22) un JWT valido llega hasta el handler', async () => {
    const token = await accessToken();
    const response = await handleListProperties(ctxWith(requestWith(token), productionEnv()));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('(22) una escritura autenticada se ejecuta de verdad', async () => {
    const token = await accessToken();
    const response = await handleCreateProperty(
      ctxWith(requestWith(token, 'POST'), productionEnv()),
    );

    expect(response.status).toBe(201);
    expect(countProperties()).toBe(1);
  });

  it('(22) tambien protege el endpoint de tipos', async () => {
    const token = await accessToken();
    const autorizado = await handleListPropertyTypes(ctxWith(requestWith(token), productionEnv()));
    expect(autorizado.status).toBe(200);

    const sinToken = await handleListPropertyTypes(
      ctxWith(requestWith(undefined), productionEnv()),
    );
    expect(sinToken.status).toBe(403);
  });

  it('sin token, la peticion no llega al CRUD', async () => {
    const response = await handleCreateProperty(
      ctxWith(requestWith(undefined, 'POST'), productionEnv()),
    );

    expect(response.status).toBe(403);
    expect(countProperties()).toBe(0);
  });

  it('un token firmado con otra clave NUNCA llega al CRUD', async () => {
    const token = await accessToken(foreignPrivateKey);
    const response = await handleCreateProperty(
      ctxWith(requestWith(token, 'POST'), productionEnv()),
    );

    expect(response.status).toBe(403);
    expect(countProperties()).toBe(0);
  });

  it('(3) en produccion el bypass no abre nada aunque este a "true"', async () => {
    const response = await handleCreateProperty(
      ctxWith(requestWith(undefined, 'POST'), productionEnv({ ADMIN_DEV_BYPASS: 'true' })),
    );

    expect(response.status).toBe(403);
    expect(countProperties()).toBe(0);
  });

  it('(5) sin configuracion de Access, falla cerrado', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const token = await accessToken();

    const response = await handleListProperties(ctxWith(requestWith(token), { isDev: false }));

    expect(response.status).toBe(403);
    consoleError.mockRestore();
  });

  it('(23) el bypass local sigue funcionando en desarrollo', async () => {
    const response = await handleListProperties(
      ctxWith(requestWith(undefined), { isDev: true, ADMIN_DEV_BYPASS: 'true' }),
    );

    expect(response.status).toBe(200);
  });

  it('(24) la comprobacion de mismo origen sigue activa tras autenticar', async () => {
    const token = await accessToken();
    const request = new Request(`${BASE}/api/admin/properties`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Cf-Access-Jwt-Assertion': token,
        origin: 'https://atacante.test',
      },
      body: '{}',
    });

    const response = await handleCreateProperty(ctxWith(request, productionEnv()));

    expect(response.status).toBe(403);
    expect(countProperties()).toBe(0);
  });

  it('(25) las respuestas siguen llevando Cache-Control: no-store', async () => {
    const token = await accessToken();

    const autorizada = await handleListProperties(ctxWith(requestWith(token), productionEnv()));
    const denegada = await handleListProperties(ctxWith(requestWith(undefined), productionEnv()));

    expect(autorizada.headers.get('cache-control')).toBe('no-store');
    expect(denegada.headers.get('cache-control')).toBe('no-store');
  });

  it('(15) la respuesta de rechazo no revela la causa ni el token', async () => {
    const token = await accessToken(foreignPrivateKey);
    const response = await handleListProperties(ctxWith(requestWith(token), productionEnv()));

    const text = await response.text();

    expect(text).not.toContain(token);
    expect(text).not.toContain('cloudflareaccess');
    expect(text).not.toContain('signature');
    expect(text).not.toContain('audience');

    const body = JSON.parse(text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toBe('Acceso administrativo denegado.');
  });

  it('el rechazo es identico se deba a lo que se deba', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const cuerpos = await Promise.all(
      [
        // sin token
        handleListProperties(ctxWith(requestWith(undefined), productionEnv())),
        // firma ajena
        handleListProperties(
          ctxWith(requestWith(await accessToken(foreignPrivateKey)), productionEnv()),
        ),
        // sin configuracion
        handleListProperties(ctxWith(requestWith(await accessToken()), { isDev: false })),
      ].map(async (promesa) => (await promesa).text()),
    );

    expect(new Set(cuerpos).size).toBe(1);
    consoleError.mockRestore();
  });
});
