/**
 * Tests de autenticacion administrativa.
 *
 * La criptografia se prueba DE VERDAD: se genera un par de claves RSA con
 * `jose`, se firman JWT reales y se verifican contra un JWKS local. No hay
 * mocks que digan "token valido", ni salidas a Internet, ni claves privadas
 * versionadas: todo se crea durante el test.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';

import { normalizeTeamDomain, readAccessConfig } from './access-config';
import { authorizeAdminRequest, isDevBypassAllowed, type AdminAuthEnv } from './authorize';
import { isAdminApiPath, isAdminPagePath, isAdminPath } from './paths';
import { verifyAccessJwt } from './verify-access-jwt';

const TEAM_DOMAIN = 'https://codeloba.cloudflareaccess.com';
const AUDIENCE = 'test-audience-tag';
const ALG = 'RS256';

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;
/** Segundo par de claves, para simular una firma con clave ajena. */
let foreignPrivateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair(ALG, { extractable: true });
  privateKey = pair.privateKey;

  const foreign = await generateKeyPair(ALG, { extractable: true });
  foreignPrivateKey = foreign.privateKey;

  // El JWKS local solo contiene la clave publica LEGITIMA.
  const publicJwk = await exportJWK(pair.publicKey);
  const keySet: JSONWebKeySet = { keys: [{ ...publicJwk, alg: ALG, use: 'sig' }] };
  jwks = createLocalJWKSet(keySet);
});

interface TokenOptions {
  issuer?: string;
  audience?: string;
  subject?: string;
  email?: string | null;
  expiresIn?: string | number;
  notBefore?: string | number;
  key?: CryptoKey;
}

async function signToken(options: TokenOptions = {}): Promise<string> {
  const {
    issuer = TEAM_DOMAIN,
    audience = AUDIENCE,
    subject = 'user-abc-123',
    email = 'admin@codeloba.test',
    expiresIn = '10m',
    notBefore,
    key = privateKey,
  } = options;

  let builder = new SignJWT(email === null ? {} : { email })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setExpirationTime(expiresIn);

  if (notBefore !== undefined) builder = builder.setNotBefore(notBefore);

  return builder.sign(key);
}

function requestWithToken(token?: string): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set('Cf-Access-Jwt-Assertion', token);
  return new Request('https://panel.codeloba.test/api/admin/properties', { headers });
}

function prodEnv(extra: Partial<AdminAuthEnv> = {}): AdminAuthEnv {
  return {
    isDev: false,
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUDIENCE,
    ...extra,
  };
}

/* -------------------------------------------------------------------------- */
/* Bypass de desarrollo                                                       */
/* -------------------------------------------------------------------------- */

describe('bypass de desarrollo', () => {
  it('(1) dev + bypass exacto "true" -> permitido sin JWT', async () => {
    const result = await authorizeAdminRequest(requestWithToken(), {
      isDev: true,
      ADMIN_DEV_BYPASS: 'true',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.method).toBe('dev_bypass');
      expect(result.identity).toBeNull();
    }
  });

  it('(2) dev + bypass "false" -> no hay bypass', async () => {
    const result = await authorizeAdminRequest(requestWithToken(), {
      isDev: true,
      ADMIN_DEV_BYPASS: 'false',
    });

    expect(result.ok).toBe(false);
  });

  it('(3) produccion + bypass "true" -> NO hay bypass', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await authorizeAdminRequest(requestWithToken(), {
      isDev: false,
      ADMIN_DEV_BYPASS: 'true',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('access_not_configured');

    consoleError.mockRestore();
  });

  it('(4) produccion + bypass "false" -> NO hay bypass', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await authorizeAdminRequest(requestWithToken(), {
      isDev: false,
      ADMIN_DEV_BYPASS: 'false',
    });

    expect(result.ok).toBe(false);
    consoleError.mockRestore();
  });

  it('en produccion, un JWT valido sigue siendo el unico camino', async () => {
    const token = await signToken();
    const result = await authorizeAdminRequest(
      requestWithToken(token),
      prodEnv({ ADMIN_DEV_BYPASS: 'true' }),
      { keyResolver: jwks },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.method).toBe('cloudflare_access');
  });

  it('la tabla de verdad del bypass es exactamente dev AND "true"', () => {
    expect(isDevBypassAllowed({ isDev: true, ADMIN_DEV_BYPASS: 'true' })).toBe(true);
    expect(isDevBypassAllowed({ isDev: true, ADMIN_DEV_BYPASS: 'false' })).toBe(false);
    expect(isDevBypassAllowed({ isDev: false, ADMIN_DEV_BYPASS: 'true' })).toBe(false);
    expect(isDevBypassAllowed({ isDev: false, ADMIN_DEV_BYPASS: 'false' })).toBe(false);
    expect(isDevBypassAllowed({ isDev: true })).toBe(false);
  });

  it('valores parecidos a "true" no abren nada', () => {
    for (const value of ['TRUE', 'True', '1', 'yes', ' true', 'true ']) {
      expect(isDevBypassAllowed({ isDev: true, ADMIN_DEV_BYPASS: value })).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Configuracion ausente                                                      */
/* -------------------------------------------------------------------------- */

describe('configuracion de Access', () => {
  it('(5) sin configuracion -> denegado, sin fallback', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const token = await signToken();

    for (const env of [
      { isDev: false },
      { isDev: false, CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN },
      { isDev: false, CF_ACCESS_AUD: AUDIENCE },
      { isDev: false, CF_ACCESS_TEAM_DOMAIN: '', CF_ACCESS_AUD: '' },
    ]) {
      const result = await authorizeAdminRequest(requestWithToken(token), env, {
        keyResolver: jwks,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('access_not_configured');
    }

    consoleError.mockRestore();
  });

  it('el log de configuracion ausente no dice que variable falta', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await authorizeAdminRequest(requestWithToken(), { isDev: false });

    const logged = consoleError.mock.calls.flat().join(' ');
    expect(logged).not.toContain('CF_ACCESS_TEAM_DOMAIN');
    expect(logged).not.toContain('CF_ACCESS_AUD');

    consoleError.mockRestore();
  });

  it('(1) acepta un team domain con la forma de Cloudflare Access', () => {
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com')).toBe(
      'https://mi-equipo.cloudflareaccess.com',
    );
    expect(normalizeTeamDomain(TEAM_DOMAIN)).toBe(TEAM_DOMAIN);
  });

  it('(2) normaliza la barra final y los espacios', () => {
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com/')).toBe(
      'https://mi-equipo.cloudflareaccess.com',
    );
    expect(normalizeTeamDomain(`  ${TEAM_DOMAIN}  `)).toBe(TEAM_DOMAIN);
    expect(normalizeTeamDomain('https://MI-EQUIPO.CloudflareAccess.com')).toBe(
      'https://mi-equipo.cloudflareaccess.com',
    );
  });

  it('(3) rechaza HTTP', () => {
    expect(normalizeTeamDomain('http://mi-equipo.cloudflareaccess.com')).toBeNull();
  });

  it('(4) rechaza un host HTTPS arbitrario', () => {
    for (const raw of [
      'https://example.com',
      'https://169.254.169.254',
      'https://localhost',
      'https://interno.codeloba.test',
    ]) {
      expect(normalizeTeamDomain(raw)).toBeNull();
    }
  });

  it('(5) rechaza el hostname raiz cloudflareaccess.com', () => {
    expect(normalizeTeamDomain('https://cloudflareaccess.com')).toBeNull();
  });

  it('(6)(7) rechaza el sufijo usado como prefijo de otro dominio', () => {
    expect(normalizeTeamDomain('https://cloudflareaccess.com.evil.example')).toBeNull();
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com.evil.example')).toBeNull();
  });

  it('no basta con contener el sufijo en cualquier posicion', () => {
    for (const raw of [
      'https://cloudflareaccess.com.attacker.test',
      'https://falsocloudflareaccess.com',
      'https://evil.example/mi-equipo.cloudflareaccess.com',
    ]) {
      expect(normalizeTeamDomain(raw)).toBeNull();
    }
  });

  it('(8) rechaza un puerto explicito', () => {
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com:8443')).toBeNull();
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com:1337')).toBeNull();
  });

  it('(9) rechaza credenciales', () => {
    expect(normalizeTeamDomain('https://user:pass@mi-equipo.cloudflareaccess.com')).toBeNull();
    expect(normalizeTeamDomain('https://user@mi-equipo.cloudflareaccess.com')).toBeNull();
  });

  it('(10) rechaza un path arbitrario', () => {
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com/path')).toBeNull();
    expect(
      normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com/cdn-cgi/access/certs'),
    ).toBeNull();
  });

  it('(11) rechaza query', () => {
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com/?a=1')).toBeNull();
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com?a=1')).toBeNull();
  });

  it('(12) rechaza fragment', () => {
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com/#frag')).toBeNull();
    expect(normalizeTeamDomain('https://mi-equipo.cloudflareaccess.com#frag')).toBeNull();
  });

  it('rechaza entradas que no son una URL', () => {
    for (const raw of [
      'file:///etc/passwd',
      'mi-equipo.cloudflareaccess.com',
      '',
      '   ',
      'https://',
    ]) {
      expect(normalizeTeamDomain(raw)).toBeNull();
    }
  });

  it('rechaza una etiqueta de equipo vacia o con forma invalida', () => {
    for (const raw of [
      'https://.cloudflareaccess.com',
      'https://-equipo.cloudflareaccess.com',
      'https://equipo-.cloudflareaccess.com',
      'https://sub.equipo.cloudflareaccess.com',
    ]) {
      expect(normalizeTeamDomain(raw)).toBeNull();
    }
  });

  it('no fija ningun nombre de equipo concreto', () => {
    for (const team of ['a', 'codeloba', 'mi-equipo', 'equipo123', 'x-y-z']) {
      expect(normalizeTeamDomain(`https://${team}.cloudflareaccess.com`)).toBe(
        `https://${team}.cloudflareaccess.com`,
      );
    }
  });

  it('la URL del JWKS se deriva del origin normalizado', () => {
    const config = readAccessConfig({
      CF_ACCESS_TEAM_DOMAIN: `${TEAM_DOMAIN}/`,
      CF_ACCESS_AUD: AUDIENCE,
    });

    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.config.jwksUrl).toBe(`${TEAM_DOMAIN}/cdn-cgi/access/certs`);
      expect(config.config.teamDomain).toBe(TEAM_DOMAIN);
    }
  });

  it('un team domain invalido se rechaza igual que si faltara', () => {
    const config = readAccessConfig({
      CF_ACCESS_TEAM_DOMAIN: 'http://inseguro.test',
      CF_ACCESS_AUD: AUDIENCE,
    });

    expect(config.ok).toBe(false);
    if (!config.ok) expect(config.problem).toBe('team_domain_invalid');
  });
});

/* -------------------------------------------------------------------------- */
/* Verificacion criptografica                                                 */
/* -------------------------------------------------------------------------- */

describe('verificacion del JWT de Access', () => {
  const config = {
    teamDomain: TEAM_DOMAIN,
    jwksUrl: `${TEAM_DOMAIN}/cdn-cgi/access/certs`,
    audience: AUDIENCE,
  };

  const verify = (request: Request) => verifyAccessJwt(request, config, { keyResolver: jwks });

  it('(6) sin token -> rechazado', async () => {
    const result = await verify(requestWithToken());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token_missing');
  });

  it('una cabecera vacia cuenta como token ausente', async () => {
    const result = await verify(requestWithToken('   '));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token_missing');
  });

  it('(7) token valido -> aceptado', async () => {
    const result = await verify(requestWithToken(await signToken()));
    expect(result.ok).toBe(true);
  });

  it('(8) firmado con otra clave -> rechazado', async () => {
    const token = await signToken({ key: foreignPrivateKey });
    const result = await verify(requestWithToken(token));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token_invalid');
  });

  it('(9) issuer incorrecto -> rechazado', async () => {
    const token = await signToken({ issuer: 'https://otro-equipo.cloudflareaccess.com' });
    const result = await verify(requestWithToken(token));
    expect(result.ok).toBe(false);
  });

  it('(10) audience incorrecto -> rechazado', async () => {
    const token = await signToken({ audience: 'otro-audience-tag' });
    const result = await verify(requestWithToken(token));
    expect(result.ok).toBe(false);
  });

  it('(11) token expirado -> rechazado', async () => {
    const token = await signToken({ expiresIn: '-1m' });
    const result = await verify(requestWithToken(token));
    expect(result.ok).toBe(false);
  });

  it('(12) token aun no valido (nbf futuro) -> rechazado', async () => {
    const token = await signToken({ notBefore: '10m' });
    const result = await verify(requestWithToken(token));
    expect(result.ok).toBe(false);
  });

  it('(13) token manipulado despues de firmarse -> rechazado', async () => {
    const token = await signToken({ email: 'admin@codeloba.test' });
    const [header, payload, signature] = token.split('.');

    // Se reescribe el payload conservando la firma original.
    const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    decoded.email = 'atacante@malo.test';
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

    const result = await verify(requestWithToken(`${header}.${forged}.${signature}`));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token_invalid');
  });

  it('un token "alg: none" no pasa', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8').toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'x', iss: TEAM_DOMAIN, aud: AUDIENCE, exp: 4102444800 }),
      'utf8',
    ).toString('base64url');

    const result = await verify(requestWithToken(`${header}.${payload}.`));
    expect(result.ok).toBe(false);
  });

  it('basura en la cabecera no pasa', async () => {
    for (const token of ['no-es-un-jwt', 'a.b.c', '...']) {
      const result = await verify(requestWithToken(token));
      expect(result.ok).toBe(false);
    }
  });

  it('(14) extrae la identidad de un token valido', async () => {
    const token = await signToken({ subject: 'sub-123', email: 'admin@codeloba.test' });
    const result = await verify(requestWithToken(token));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.sub).toBe('sub-123');
      expect(result.identity.email).toBe('admin@codeloba.test');
    }
  });

  it('el email es opcional', async () => {
    const token = await signToken({ email: null });
    const result = await verify(requestWithToken(token));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.sub).toBe('user-abc-123');
      expect(result.identity.email).toBeUndefined();
    }
  });

  it('NO acepta el token por query string, cuerpo ni cabecera inventada', async () => {
    const token = await signToken();

    const porQuery = new Request(`https://panel.codeloba.test/api/admin/properties?token=${token}`);
    expect((await verify(porQuery)).ok).toBe(false);

    const porCabeceraInventada = new Request('https://panel.codeloba.test/api/admin/properties', {
      headers: { 'x-access-token': token },
    });
    expect((await verify(porCabeceraInventada)).ok).toBe(false);

    const porCookie = new Request('https://panel.codeloba.test/api/admin/properties', {
      headers: { cookie: `CF_Authorization=${token}` },
    });
    expect((await verify(porCookie)).ok).toBe(false);
  });

  it('la cabecera se lee sin distinguir mayusculas', async () => {
    const token = await signToken();
    const request = new Request('https://panel.codeloba.test/api/admin/properties', {
      headers: { 'CF-ACCESS-JWT-ASSERTION': token },
    });

    expect((await verify(request)).ok).toBe(true);
  });

  it('(15)(16) el fallo no devuelve el token, el JWKS ni la traza', async () => {
    const token = await signToken({ audience: 'audience-equivocado' });
    const result = await verify(requestWithToken(token));

    expect(result.ok).toBe(false);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('cloudflareaccess');
    expect(serialized).not.toContain('cdn-cgi');
    expect(serialized).not.toContain('at ');
    // Solo un motivo escueto, sin detalle de la causa criptografica.
    expect(serialized).toBe(JSON.stringify({ ok: false, reason: 'token_invalid' }));
  });

  it('la verificacion no escribe el token en consola', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const token = await signToken({ key: foreignPrivateKey });
    await verify(requestWithToken(token));

    const logged = [...consoleError.mock.calls, ...consoleLog.mock.calls, ...consoleWarn.mock.calls]
      .flat()
      .join(' ');

    expect(logged).not.toContain(token);

    consoleError.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */
/* Autorizacion completa                                                      */
/* -------------------------------------------------------------------------- */

describe('authorizeAdminRequest', () => {
  it('acepta un JWT valido y devuelve la identidad', async () => {
    const token = await signToken({ subject: 'sub-xyz', email: 'admin@codeloba.test' });
    const result = await authorizeAdminRequest(requestWithToken(token), prodEnv(), {
      keyResolver: jwks,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.method).toBe('cloudflare_access');
      expect(result.identity?.sub).toBe('sub-xyz');
      expect(result.identity?.email).toBe('admin@codeloba.test');
    }
  });

  it('rechaza un token invalido aun con la configuracion correcta', async () => {
    const token = await signToken({ key: foreignPrivateKey });
    const result = await authorizeAdminRequest(requestWithToken(token), prodEnv(), {
      keyResolver: jwks,
    });

    expect(result.ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Rutas protegidas                                                           */
/* -------------------------------------------------------------------------- */

describe('superficie administrativa', () => {
  it('(17)(18) /admin y /admin/... son rutas de panel', () => {
    for (const path of ['/admin', '/admin/', '/admin/propiedades', '/admin/propiedades/1']) {
      expect(isAdminPagePath(path)).toBe(true);
      expect(isAdminPath(path)).toBe(true);
    }
  });

  it('(19) /api/admin/... es superficie administrativa', () => {
    for (const path of ['/api/admin', '/api/admin/properties', '/api/admin/property-types']) {
      expect(isAdminApiPath(path)).toBe(true);
      expect(isAdminPath(path)).toBe(true);
    }
  });

  it('(20)(21) las rutas publicas quedan fuera de Access', () => {
    for (const path of ['/', '/es/', '/es/lote-vista-al-mar', '/en/', '/en/sea-view-lot']) {
      expect(isAdminPath(path)).toBe(false);
      expect(isAdminPagePath(path)).toBe(false);
      expect(isAdminApiPath(path)).toBe(false);
    }
  });

  it('no se protege de mas por coincidencia de prefijo', () => {
    for (const path of ['/administracion', '/admin-publico', '/api/administrar', '/es/admin']) {
      expect(isAdminPath(path)).toBe(false);
    }
  });

  it('el middleware cubre paginas y los handlers cubren la API', () => {
    // Reparto explicito para no verificar el mismo JWT dos veces.
    expect(isAdminPagePath('/api/admin/properties')).toBe(false);
    expect(isAdminApiPath('/admin/propiedades')).toBe(false);
  });
});
