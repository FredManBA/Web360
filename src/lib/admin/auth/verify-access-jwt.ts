/**
 * Verificacion criptografica de los JWT de Cloudflare Access.
 *
 * El token llega en la cabecera `Cf-Access-Jwt-Assertion` y se comprueba de
 * verdad: firma contra el JWKS publicado por Cloudflare, `iss`, `aud` y las
 * marcas temporales estandar (`exp`, `nbf`) que valida `jose`.
 *
 * Que exista la cabecera no prueba nada, y decodificar el payload sin
 * verificar la firma no prueba absolutamente nada.
 *
 * IMPORTANTE: aunque en el futuro Cloudflare Access proteja la ruta antes de
 * llegar al Worker, esta verificacion NO sobra. El perimetro puede estar mal
 * configurado o dejar de aplicarse a una ruta concreta.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { AccessConfig } from './access-config';

/**
 * Access firma con RS256. Se fija explicitamente en vez de aceptar lo que el
 * token declare en su cabecera: dejar que el atacante elija el algoritmo es
 * una via clasica de bypass.
 */
const ALLOWED_ALGORITHMS = ['RS256'];

/**
 * Un `RemoteJWKSet` por team domain, reutilizado dentro del isolate.
 *
 * `jose` ya gestiona por dentro la cache y el refresco cuando aparece un `kid`
 * desconocido, que es como se tolera la rotacion de claves de Cloudflare. No
 * hace falta un sistema propio de refresco ni KV ni Durable Objects.
 */
const jwksCache = new Map<string, JWTVerifyGetKey>();

function getRemoteJwks(config: AccessConfig): JWTVerifyGetKey {
  const cached = jwksCache.get(config.jwksUrl);
  if (cached !== undefined) return cached;

  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  jwksCache.set(config.jwksUrl, jwks);
  return jwks;
}

/** Identidad minima. No hay usuarios propios, roles ni sesiones. */
export interface AccessIdentity {
  sub: string;
  email?: string;
}

export type AccessVerifyFailure = 'token_missing' | 'token_invalid' | 'identity_missing';

export type AccessVerifyResult =
  { ok: true; identity: AccessIdentity } | { ok: false; reason: AccessVerifyFailure };

export interface VerifyAccessJwtOptions {
  /**
   * Resolver de claves alternativo.
   *
   * Existe para que los tests verifiquen firmas REALES contra un JWKS local,
   * sin salir a Internet. En produccion nunca se pasa, y entonces se usa el
   * JWKS remoto de Cloudflare.
   */
  keyResolver?: JWTVerifyGetKey;
}

export const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion';

/**
 * Extrae el token de la cabecera estandar.
 *
 * `Headers.get` ya es insensible a mayusculas. No se acepta el token desde
 * query string, cuerpo ni ninguna cabecera inventada, y `CF_Authorization` no
 * se usa como fuente: esa cookie es cosa del flujo de navegador que gestiona
 * Cloudflare.
 */
export function readAccessToken(request: Request): string | null {
  const raw = request.headers.get(ACCESS_JWT_HEADER);
  if (raw === null) return null;

  const token = raw.trim();
  return token.length > 0 ? token : null;
}

export async function verifyAccessJwt(
  request: Request,
  config: AccessConfig,
  options: VerifyAccessJwtOptions = {},
): Promise<AccessVerifyResult> {
  const token = readAccessToken(request);
  if (token === null) return { ok: false, reason: 'token_missing' };

  const keyResolver = options.keyResolver ?? getRemoteJwks(config);

  try {
    const { payload } = await jwtVerify(token, keyResolver, {
      issuer: config.teamDomain,
      audience: config.audience,
      algorithms: ALLOWED_ALGORITHMS,
    });

    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (sub.length === 0) return { ok: false, reason: 'identity_missing' };

    const rawEmail = (payload as { email?: unknown }).email;
    const email = typeof rawEmail === 'string' && rawEmail.length > 0 ? rawEmail : undefined;

    return { ok: true, identity: email === undefined ? { sub } : { sub, email } };
  } catch {
    /*
     * Se colapsan todas las causas (firma, issuer, audience, expiracion) en un
     * unico fallo. El motivo concreto no vuelve al cliente, y aqui tampoco se
     * registra el token ni el error de `jose`, que puede incluir fragmentos
     * del JWT.
     */
    return { ok: false, reason: 'token_invalid' };
  }
}
