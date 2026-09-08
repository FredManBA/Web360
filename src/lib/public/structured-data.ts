/**
 * JSON-LD del sitio publico.
 *
 * La regla que gobierna este archivo entero: **solo se afirma lo que se sabe**.
 * Schema.org premia la precision, no el relleno; una propiedad con un valor
 * inventado no mejora nada y convierte los datos estructurados en ruido —o en
 * una mentira, si alguien la lee—. Asi que cada campo se omite cuando el dato
 * no existe, y bloques enteros no se emiten si no hay nada que decir.
 *
 * Y una linea que no se cruza: aqui NO entran las coordenadas privadas. Las
 * unicas que existen en este lado son las publicas, y ni siquiera esas se
 * declaran cuando la propiedad se publica con ubicacion aproximada: dar unas
 * coordenadas aproximadas como `geo` seria presentarlas como exactas, que es
 * justo lo que la ficha evita.
 */

import type { PublicContactChannels, PublicPropertyDetail, PublicSite } from './read-model';
import type { Locale } from '../domain/vocabularies';

/** Un nodo JSON-LD. Se serializa tal cual. */
export type JsonLd = Record<string, unknown>;

const CONTEXT = 'https://schema.org';

/** Quita las claves sin valor: lo que no se sabe, no se declara. */
function compact(node: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(node).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;

      return true;
    }),
  );
}

/**
 * Si se puede afirmar un precio.
 *
 * Solo con `exact`: "negociable" y "a consultar" son justamente lo contrario
 * de un precio afirmable, y publicarlos como `price` haria que un buscador
 * ensenara una cifra que el negocio no ha cerrado.
 */
export function canStatePrice(property: PublicPropertyDetail): boolean {
  return (
    property.price.mode === 'exact' &&
    property.price.amountMinor !== null &&
    property.price.currencyCode !== null
  );
}

/**
 * Si se pueden declarar coordenadas.
 *
 * Publicas y exactas. Una ubicacion aproximada se ensena en el mapa como lo
 * que es, pero en `geo` no cabe ese matiz.
 */
export function canStateCoordinates(property: PublicPropertyDetail): boolean {
  return property.location.coordinates !== null && property.location.precision === 'exact';
}

/**
 * Disponibilidad, derivada del estado comercial que ya es publico.
 *
 * `commercialStatus` es `null` cuando la propiedad esta disponible: el read
 * model no anuncia lo normal. Reservada y con oferta se declaran como
 * disponibilidad limitada, que es lo que son: sigue en pie, pero no libre.
 */
function availabilityOf(property: PublicPropertyDetail): string {
  if (property.commercialStatus === 'sold') return `${CONTEXT}/SoldOut`;

  return property.commercialStatus === null
    ? `${CONTEXT}/InStock`
    : `${CONTEXT}/LimitedAvailability`;
}

/** El lugar: direccion administrativa publica y, si procede, coordenadas. */
function placeOf(property: PublicPropertyDetail): JsonLd {
  const { location } = property;

  const address = compact({
    '@type': 'PostalAddress',
    addressCountry: 'CR',
    addressRegion: location.province,
    addressLocality: location.canton,
    // El distrito y la localidad son lo mas fino que se publica.
    streetAddress: location.locality ?? location.district,
  });

  return compact({
    '@type': 'Place',
    name: property.title,
    address: Object.keys(address).length > 1 ? address : null,
    geo: canStateCoordinates(property)
      ? {
          '@type': 'GeoCoordinates',
          latitude: property.location.coordinates?.latitude,
          longitude: property.location.coordinates?.longitude,
        }
      : null,
    /*
     * La superficie va como propiedad medida y con su unidad (MTK, metro
     * cuadrado en UN/CEFACT) en vez de dentro del nombre: asi es un dato y no
     * una cadena que hay que interpretar.
     */
    additionalProperty:
      property.area === null
        ? null
        : [
            {
              '@type': 'PropertyValue',
              name: 'area',
              value: property.area.squareMeters,
              unitCode: 'MTK',
            },
          ],
  });
}

export interface PropertyJsonLdInput {
  property: PublicPropertyDetail;
  locale: Locale;
  /** URL de la ficha; absoluta si hay dominio, relativa si no. */
  url: string;
  /** URLs de las imagenes publicas de la ficha. */
  images: string[];
}

/**
 * La ficha, como `RealEstateListing`.
 *
 * Es el tipo que Schema.org define para "un anuncio que describe una o varias
 * ofertas inmobiliarias", que es exactamente lo que es esta pagina.
 *
 * El precio, cuando se puede afirmar, va en `mainEntity` como una `Offer` cuyo
 * `itemOffered` es el lugar. Es la unica combinacion del vocabulario que
 * relaciona las dos cosas sin inventarse propiedades: `WebPage.mainEntity` y
 * `Offer.itemOffered` existen; `offers` sobre una pagina, no. Cuando no hay
 * precio afirmable, el lugar cuelga de `about` y no se menciona ninguna oferta.
 */
export function propertyJsonLd(input: PropertyJsonLdInput): JsonLd {
  const { property, locale, url, images } = input;
  const place = placeOf(property);

  const listing = compact({
    '@context': CONTEXT,
    '@type': 'RealEstateListing',
    name: property.title,
    description: property.marketingDescription ?? property.technicalDescription,
    url,
    inLanguage: locale,
    image: images,
  });

  if (!canStatePrice(property)) {
    return { ...listing, about: place };
  }

  return {
    ...listing,
    mainEntity: compact({
      '@type': 'Offer',
      url,
      /*
       * El importe se guarda en la unidad menor; aqui se declara en la unidad
       * de la moneda, que es lo que espera `price`.
       */
      price: (property.price.amountMinor ?? 0) / 100,
      priceCurrency: property.price.currencyCode,
      availability: availabilityOf(property),
      itemOffered: place,
    }),
  };
}

export interface OrganizationJsonLdInput {
  site: PublicSite;
  contact: PublicContactChannels;
  locale: Locale;
  /** URL de la portada de este idioma. */
  url: string;
}

/**
 * El negocio, como `Organization`.
 *
 * Se emite SOLO si hay nombre configurado: una organizacion sin nombre no
 * identifica a nadie y no aporta nada. El resto de campos aparecen uno a uno
 * segun esten configurados —telefono, correo, direccion, redes—, y ninguno se
 * rellena con un valor de ejemplo.
 */
export function organizationJsonLd(input: OrganizationJsonLdInput): JsonLd | null {
  const { site, contact, locale, url } = input;

  const name = site.businessName?.trim() ?? '';
  if (name.length === 0) return null;

  const address =
    contact.address === null
      ? null
      : { '@type': 'PostalAddress', addressCountry: 'CR', streetAddress: contact.address };

  return compact({
    '@context': CONTEXT,
    '@type': 'Organization',
    name,
    url,
    description: site.texts[locale].tagline ?? site.texts[locale].seoDescription,
    telephone: contact.phone,
    email: contact.email,
    address,
    sameAs: contact.social.map((link) => link.url),
  });
}
