/**
 * Compartir una propiedad: el enlace de su ficha publica.
 *
 * Funciones puras, sin DOM ni base de datos, para que las use tanto la ficha
 * (en el servidor y en el navegador) como el panel, que ademas dibuja el QR.
 *
 * El enlace es SIEMPRE el de la ficha publica normal: no hay enlaces secretos
 * ni vistas aparte. Por eso solo funciona con propiedades publicadas.
 */

import type { Locale } from '../domain/vocabularies';

/**
 * Origen con el que se construyen los enlaces que salen del sitio.
 *
 * En produccion manda el dominio configurado (`site` en `astro.config.mjs`):
 * un QR impreso debe apuntar al dominio publico aunque el panel se abra desde
 * otro host. En desarrollo, en cambio, `site` es el de produccion y una
 * propiedad local no existe alli, asi que se usa el host de la peticion.
 */
export function shareOrigin(input: { site: URL | undefined; request: URL; dev: boolean }): string {
  if (input.dev || input.site === undefined) return input.request.origin;
  return input.site.origin;
}

/**
 * Ruta de la ficha publica. Es la misma forma que `propertyHref` del read
 * model (un test lo comprueba); se repite aqui para no arrastrar el read
 * model, que importa la base de datos, al codigo del navegador.
 */
export function propertySharePath(locale: Locale, slug: string): string {
  return `/${locale}/propiedades/${encodeURIComponent(slug)}`;
}

/** Enlace absoluto de la ficha, listo para copiar, enviar o meter en un QR. */
export function propertyShareUrl(origin: string, locale: Locale, slug: string): string {
  return new URL(propertySharePath(locale, slug), origin).href;
}

/**
 * Compartir por WhatsApp sin destinatario: abre WhatsApp para que la persona
 * elija a quien mandarlo. El mensaje es el titulo y el enlace, nada mas.
 */
export function whatsappShareHref(title: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`;
}
