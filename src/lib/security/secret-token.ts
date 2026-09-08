/**
 * Secretos con forma de enlace.
 *
 * Este proyecto tiene dos credenciales que no son una cuenta: el enlace de
 * revision, que le da a alguien de fuera acceso a un borrador, y el token de
 * callback, con el que quien construye el sitio confirma el resultado de una
 * publicacion. Ninguno tiene sesion detras, asi que ambos se tratan como una
 * contrasena y comparten el mismo mecanismo, que es este.
 *
 * Tres reglas, y las tres se cumplen aqui:
 *
 * - se genera con el CSPRNG del entorno, nunca con `Math.random`;
 * - en la base solo vive su hash SHA-256, que es lo que garantiza que ni un
 *   volcado de la base permita entrar a nada;
 * - la comprobacion se hace buscando POR HASH en un indice unico. No se
 *   compara el token con nada: se calcula su hash y se busca. Eso evita de
 *   raiz cualquier comparacion filtrable por tiempo sobre el valor secreto.
 *
 * El token crudo existe solo en memoria, el tiempo justo de entregarlo una
 * vez a quien va a usarlo. No se registra en ningun log ni se devuelve al
 * leer.
 */

/**
 * Bytes de aleatoriedad.
 *
 * 32 bytes son 256 bits: mas que suficiente para que adivinarlo no sea una
 * estrategia, y la URL sigue siendo manejable en base64url.
 */
const TOKEN_BYTES = 32;

/** Base64 de URL: sin `+`, sin `/` y sin relleno, para poder ir en una ruta. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Un secreto nuevo, en claro.
 *
 * Quien llama debe entregarlo UNA vez y olvidarlo: lo unico que se guarda es
 * su hash.
 */
export function generateSecretToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);

  return toBase64Url(bytes);
}

/**
 * Hash de un secreto.
 *
 * SHA-256 sin sal ni derivacion lenta a proposito: no es una contrasena
 * elegida por una persona, es un secreto de 256 bits aleatorios. Un ataque de
 * diccionario no tiene por donde empezar, y una derivacion lenta solo
 * castigaria cada uso legitimo.
 */
export async function hashSecretToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Forma minima que puede tener un secreto para molestarse en consultar la base.
 *
 * No valida nada secreto: solo descarta valores obviamente absurdos antes de
 * calcular un hash y consultar.
 */
export function looksLikeSecretToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}
