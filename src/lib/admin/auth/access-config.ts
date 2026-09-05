/**
 * Configuracion de Cloudflare Access.
 *
 * Dos variables de servidor:
 *
 *   CF_ACCESS_TEAM_DOMAIN=https://mi-equipo.cloudflareaccess.com
 *   CF_ACCESS_AUD=<audience tag de la Access Application>
 *
 * Si falta cualquiera de las dos, la peticion administrativa se rechaza: no
 * existe modo "sin autenticacion". Fallar cerrado es lo unico aceptable en un
 * panel que edita el catalogo.
 */

export interface AccessConfig {
  /** Origin normalizado, sin barra final. Es tambien el `issuer` esperado. */
  teamDomain: string;
  /** URL del JWKS publicado por Cloudflare. */
  jwksUrl: string;
  audience: string;
}

export interface AccessEnv {
  CF_ACCESS_TEAM_DOMAIN?: string | undefined;
  CF_ACCESS_AUD?: string | undefined;
}

export type AccessConfigProblem =
  'team_domain_missing' | 'team_domain_invalid' | 'audience_missing';

export type AccessConfigResult =
  { ok: true; config: AccessConfig } | { ok: false; problem: AccessConfigProblem };

/** Sufijo obligatorio del team domain de Cloudflare Zero Trust. */
const TEAM_DOMAIN_SUFFIX = '.cloudflareaccess.com';

/**
 * Etiqueta del equipo: una sola etiqueta DNS valida.
 *
 * Al no admitir puntos, quedan fuera hosts como `a.b.cloudflareaccess.com`,
 * que no son la forma que emite Cloudflare.
 */
const TEAM_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Normaliza el team domain a un origin HTTPS limpio.
 *
 * El JWKS se descarga desde esta URL, asi que una configuracion descuidada
 * convertiria al cargador en un SSRF de proposito general. Es configuracion
 * del servidor y no entrada de usuario, pero se acota igualmente: el team
 * domain de Access tiene una unica forma posible,
 *
 *   https://<equipo>.cloudflareaccess.com
 *
 * y todo lo demas se rechaza. Que sea HTTPS no basta: un host arbitrario
 * seguiria siendo un destino arbitrario.
 *
 * No se fija ningun nombre de equipo concreto, solo su forma.
 */
export function normalizeTeamDomain(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (url.search.length > 0 || url.hash.length > 0) return null;
  if (url.pathname !== '/' && url.pathname.length > 0) return null;

  // Un puerto explicito no forma parte del team domain de Access.
  if (url.port.length > 0) return null;

  const hostname = url.hostname.toLowerCase();

  /*
   * El sufijo se comprueba con el punto incluido, de modo que:
   *
   *   cloudflareaccess.com                   -> no termina en el sufijo
   *   cloudflareaccess.com.evil.example      -> no termina en el sufijo
   *   equipo.cloudflareaccess.com.evil.test  -> no termina en el sufijo
   */
  if (!hostname.endsWith(TEAM_DOMAIN_SUFFIX)) return null;

  const team = hostname.slice(0, -TEAM_DOMAIN_SUFFIX.length);
  if (!TEAM_LABEL_PATTERN.test(team)) return null;

  // Forma canonica, para que el issuer y la URL del JWKS coincidan siempre.
  return `https://${hostname}`;
}

export function readAccessConfig(env: AccessEnv): AccessConfigResult {
  const rawDomain = env.CF_ACCESS_TEAM_DOMAIN;
  if (rawDomain === undefined || rawDomain.trim().length === 0) {
    return { ok: false, problem: 'team_domain_missing' };
  }

  const teamDomain = normalizeTeamDomain(rawDomain);
  if (teamDomain === null) return { ok: false, problem: 'team_domain_invalid' };

  const audience = env.CF_ACCESS_AUD?.trim();
  if (audience === undefined || audience.length === 0) {
    return { ok: false, problem: 'audience_missing' };
  }

  return {
    ok: true,
    config: {
      teamDomain,
      jwksUrl: `${teamDomain}/cdn-cgi/access/certs`,
      audience,
    },
  };
}
