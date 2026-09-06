/**
 * Mapa entre los campos del modelo y los controles del formulario.
 *
 * Se mantiene en un solo sitio para que el DOM del editor no repita
 * identificadores por todas partes, y para que los errores de la API se
 * puedan asociar al control correcto.
 */

export interface FieldBinding {
  /** Identificador del control. */
  input: string;
  /** Parrafo donde se escribe el error, si lo tiene. */
  error?: string;
}

export const FIELD_BINDINGS: Record<string, FieldBinding> = {
  code: { input: 'field-code', error: 'field-code-error' },
  propertyTypeId: { input: 'field-type' },
  commercialStatus: { input: 'field-commercial' },
  isFeatured: { input: 'field-featured' },
  showWhenSold: { input: 'field-show-when-sold' },

  priceMode: { input: 'field-price-mode' },
  priceAmount: { input: 'field-price-amount', error: 'field-price-amount-error' },
  priceAmountMinor: { input: 'field-price-amount', error: 'field-price-amount-error' },
  currencyCode: { input: 'field-currency', error: 'field-currency-error' },

  areaSquareMeters: { input: 'field-area', error: 'field-area-error' },

  province: { input: 'field-province' },
  canton: { input: 'field-canton' },
  district: { input: 'field-district' },
  locality: { input: 'field-locality' },

  privateLatitude: { input: 'field-private-lat', error: 'field-private-lat-error' },
  privateLongitude: { input: 'field-private-lng', error: 'field-private-lng-error' },
  publicLatitude: { input: 'field-public-lat', error: 'field-public-lat-error' },
  publicLongitude: { input: 'field-public-lng', error: 'field-public-lng-error' },
  locationPrecision: { input: 'field-precision' },

  // Contenido traducible. Los errores de un idioma nunca tocan al otro.
  'es.title': { input: 'field-es-title' },
  'es.slug': { input: 'field-es-slug', error: 'field-es-slug-error' },
  'es.marketingDescription': { input: 'field-es-marketing' },
  'es.technicalDescription': { input: 'field-es-technical' },

  'en.title': { input: 'field-en-title' },
  'en.slug': { input: 'field-en-slug', error: 'field-en-slug-error' },
  'en.marketingDescription': { input: 'field-en-marketing' },
  'en.technicalDescription': { input: 'field-en-technical' },
};

export function bindingFor(field: string): FieldBinding | null {
  return FIELD_BINDINGS[field] ?? null;
}
