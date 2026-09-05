/**
 * Autorizacion administrativa: unico punto de decision.
 *
 * Lo usan tanto el middleware que cubre `/admin/*` como los handlers de
 * `/api/admin/*`, de modo que la regla vive en un solo sitio.
 *
 * Solo hay dos formas de pasar:
 *
 *   1. bypass de desarrollo, que exige a la vez build en modo DEV y
 *      ADMIN_DEV_BYPASS === "true";
 *   2. un JWT de Cloudflare Access verificado criptograficamente.
 *
 * Cualquier otra cosa se rechaza. No hay tercer camino ni fallback.
 */

import type { JWTVerifyGetKey } from 'jose';

import { readAccessConfig, type AccessEnv } from './access-config';
import { verifyAccessJwt, type AccessIdentity } from './verify-access-jwt';

export interface AdminAuthEnv extends AccessEnv {
  /**
   * Solo para desarrollo local y tests. No basta por si sola: sin `isDev`
   * no abre nada.
   */
  ADMIN_DEV_BYPASS?: string | undefined;

  /**
   * Senal de entorno, que el puente de Astro rellena con `import.meta.env.DEV`.
   *
   * Se pasa explicitamente en lugar de deducir el entorno aqui dentro: una
   * build productiva no puede quedar abierta porque alguien configure la
   * variable por error, y ademas los tests pueden fijarla sin trucos.
   */
  isDev: boolean;
}

export type AdminAuthMethod = 'dev_bypass' | 'cloudflare_access';

export type AdminAuthDenialReason =
  'access_not_configured' | 'token_missing' | 'token_invalid' | 'identity_missing';

export type AdminAuthResult =
  | { ok: true; method: AdminAuthMethod; identity: AccessIdentity | null }
  | { ok: false; reason: AdminAuthDenialReason };

export interface AuthorizeOptions {
  /** Inyeccion de claves para los tests; en produccion nunca se define. */
  keyResolver?: JWTVerifyGetKey;
}

/**
 * El bypass exige AMBAS condiciones.
 *
 *   dev + "true"  -> permitido sin JWT
 *   dev + otro    -> exige Access
 *   prod + "true" -> exige Access
 *   prod + otro   -> exige Access
 */
export function isDevBypassAllowed(env: AdminAuthEnv): boolean {
  return env.isDev === true && env.ADMIN_DEV_BYPASS === 'true';
}

export async function authorizeAdminRequest(
  request: Request,
  env: AdminAuthEnv,
  options: AuthorizeOptions = {},
): Promise<AdminAuthResult> {
  if (isDevBypassAllowed(env)) {
    return { ok: true, method: 'dev_bypass', identity: null };
  }

  const config = readAccessConfig(env);
  if (!config.ok) {
    /*
     * Falta configuracion de Access: se falla cerrado. Se registra que falta
     * configuracion, pero no que variable concreta, para no describirle el
     * despliegue a nadie que lea los logs.
     */
    console.error('[admin-auth] Cloudflare Access no esta configurado; se deniega el acceso.');
    return { ok: false, reason: 'access_not_configured' };
  }

  const verified = await verifyAccessJwt(request, config.config, options);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  return { ok: true, method: 'cloudflare_access', identity: verified.identity };
}
