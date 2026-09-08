/**
 * Tokens de revision privada.
 *
 * Un token es la unica credencial del reviewer: no tiene cuenta, no entra al
 * panel y no hay sesion. Por eso el enlace se trata como una contrasena.
 *
 * El mecanismo —generacion con CSPRNG, hash SHA-256 y busqueda por hash— vive
 * en `src/lib/security/secret-token.ts`, compartido con el token de callback
 * del flujo de publicacion. Aqui solo queda lo que es propio de la revision:
 * cuanto dura un enlace.
 */

import {
  generateSecretToken,
  hashSecretToken,
  looksLikeSecretToken,
} from '../security/secret-token';

/** Cuanto vive un enlace de revision si nadie lo revoca antes. */
export const TOKEN_TTL_DAYS = 14;

/**
 * Un token nuevo, en claro.
 *
 * Quien llama debe ensenarlo UNA vez y olvidarlo: lo unico que se guarda es
 * su hash.
 */
export function generateReviewToken(): string {
  return generateSecretToken();
}

/** Hash de un token de revision. Es lo unico que llega a la base. */
export function hashReviewToken(token: string): Promise<string> {
  return hashSecretToken(token);
}

/** Descarta rutas obviamente absurdas antes de calcular un hash y consultar. */
export function looksLikeToken(value: string): boolean {
  return looksLikeSecretToken(value);
}

/** Cuando caduca un token creado ahora. */
export function tokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
