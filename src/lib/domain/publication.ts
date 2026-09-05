/**
 * "¿Esta propiedad puede publicarse?"
 *
 * Funcion pura: recibe la ficha ya cargada y devuelve el veredicto con los
 * problemas encontrados. NO escribe en base de datos ni cambia estados.
 *
 * Filosofia: la propiedad debe poder ser SIMPLE. Se exige lo imprescindible
 * para que la ficha publica no salga rota, y nada mas. No hacen falta ingles,
 * video, 360, documentos, caracteristicas, POI ni redes sociales.
 */

import { validateMediaRoles, validateTourForPublication } from './consistency';
import type { MediaLike, TourNodeLike } from './consistency';
import { validatePublicLocation } from './location';
import { validatePrice } from './money';
import { isValidSlug } from './slug';
import type { LocationPrecision, Locale, PriceMode, PublicationStatus } from './vocabularies';

export type PublicationSection =
  'identity' | 'content' | 'price' | 'area' | 'location' | 'media' | 'tour' | 'status';

export interface PublicationIssue {
  /** Codigo estable, apto para traducir el mensaje mas adelante. */
  code: string;
  section: PublicationSection;
  field?: string;
  /** Texto en espanol para el panel. */
  message: string;
}

export interface PublicationCheckResult {
  valid: boolean;
  issues: PublicationIssue[];
}

export interface PropertyTranslationLike {
  locale: Locale;
  slug: string | null;
  title: string | null;
}

export interface PropertyForPublication {
  id: number;
  code: string;
  propertyTypeId: number | null;
  publicationStatus: PublicationStatus;
  priceMode: PriceMode;
  priceAmountMinor: number | null;
  currencyCode: string | null;
  areaSquareMeters: number | null;
  publicLatitude: number | null;
  publicLongitude: number | null;
  locationPrecision: LocationPrecision;
  translations: PropertyTranslationLike[];
  media: MediaLike[];
  tourNodes?: TourNodeLike[];
}

/** El idioma obligatorio para publicar. El ingles es opcional. */
const REQUIRED_LOCALE: Locale = 'es';

/** Estados desde los que tiene sentido comprobar si la ficha esta lista. */
const PUBLISHABLE_STATUSES: PublicationStatus[] = ['approved', 'published'];

const PRICE_MESSAGES: Record<string, string> = {
  amount_required: 'El modo de precio elegido exige un importe.',
  currency_required: 'El modo de precio elegido exige una moneda.',
  currency_invalid: 'La moneda no es un codigo ISO 4217 valido.',
  amount_negative: 'El importe no puede ser negativo.',
};

const TOUR_MESSAGES: Record<string, string> = {
  tour_has_no_start_node: 'El recorrido 360 no tiene nodo inicial.',
  tour_has_multiple_start_nodes: 'El recorrido 360 tiene mas de un nodo inicial.',
  media_is_not_panorama: 'Un nodo del recorrido apunta a un archivo que no es un panorama.',
  media_belongs_to_other_property: 'Un nodo del recorrido apunta a un archivo de otra propiedad.',
};

const MEDIA_ROLE_MESSAGES: Record<string, string> = {
  hero_not_found: 'Falta elegir la imagen o el video principal (hero).',
  hero_belongs_to_other_property: 'El hero pertenece a otra propiedad.',
  hero_invalid_kind: 'El hero solo puede ser una imagen o un video.',
  catalog_cover_not_found: 'Falta elegir la portada del catalogo.',
  catalog_cover_belongs_to_other_property: 'La portada pertenece a otra propiedad.',
  catalog_cover_invalid_kind: 'La portada del catalogo debe ser una imagen.',
};

export function validatePropertyForPublication(
  property: PropertyForPublication,
): PublicationCheckResult {
  const issues: PublicationIssue[] = [];

  const add = (
    code: string,
    section: PublicationSection,
    message: string,
    field?: string,
  ): void => {
    issues.push(
      field === undefined ? { code, section, message } : { code, section, field, message },
    );
  };

  // -- Identidad -----------------------------------------------------------
  if (property.code.trim().length === 0) {
    add('code_missing', 'identity', 'La propiedad necesita un codigo.', 'code');
  }

  if (property.propertyTypeId === null) {
    add(
      'property_type_missing',
      'identity',
      'Falta asignar el tipo de propiedad.',
      'propertyTypeId',
    );
  }

  // -- Contenido en espanol (el ingles es opcional) ------------------------
  const spanish = property.translations.find((t) => t.locale === REQUIRED_LOCALE);

  if (spanish === undefined) {
    add('translation_es_missing', 'content', 'Falta la traduccion en espanol.', 'translations.es');
  } else {
    if (spanish.title === null || spanish.title.trim().length === 0) {
      add(
        'title_es_missing',
        'content',
        'El titulo en espanol no puede estar vacio.',
        'translations.es.title',
      );
    }
    if (spanish.slug === null || spanish.slug.trim().length === 0) {
      add('slug_es_missing', 'content', 'Falta el slug en espanol.', 'translations.es.slug');
    } else if (!isValidSlug(spanish.slug)) {
      add(
        'slug_es_invalid',
        'content',
        'El slug en espanol no tiene un formato valido.',
        'translations.es.slug',
      );
    }
  }

  // -- Precio --------------------------------------------------------------
  for (const problem of validatePrice(property)) {
    add(
      problem,
      'price',
      PRICE_MESSAGES[problem] ?? 'Configuracion de precio incoherente.',
      'price',
    );
  }

  // -- Superficie ----------------------------------------------------------
  if (property.areaSquareMeters === null) {
    add('area_missing', 'area', 'Falta la superficie en metros cuadrados.', 'areaSquareMeters');
  } else if (!(property.areaSquareMeters > 0)) {
    add('area_invalid', 'area', 'La superficie debe ser mayor que cero.', 'areaSquareMeters');
  }

  // -- Ubicacion publica ---------------------------------------------------
  for (const problem of validatePublicLocation(property)) {
    add(
      problem,
      'location',
      problem === 'coordinates_missing'
        ? 'Falta la coordenada publica.'
        : 'La coordenada publica esta fuera de rango.',
      'publicLatitude',
    );
  }

  // -- Multimedia ----------------------------------------------------------
  const ownMedia = property.media.filter((item) => item.propertyId === property.id);

  if (!ownMedia.some((item) => item.mediaKind === 'image')) {
    add('image_missing', 'media', 'Hace falta al menos una imagen publica.', 'media');
  }

  for (const problem of validateMediaRoles(property.id, property.media)) {
    add(problem, 'media', MEDIA_ROLE_MESSAGES[problem] ?? 'Multimedia incoherente.', 'media');
  }

  // -- Recorrido 360 (opcional, pero si existe debe estar bien) ------------
  const tourNodes = property.tourNodes ?? [];
  if (tourNodes.length > 0) {
    const mediaById = new Map(property.media.map((item) => [item.id, item]));
    for (const problem of validateTourForPublication(tourNodes, mediaById)) {
      add(problem, 'tour', TOUR_MESSAGES[problem] ?? 'Recorrido 360 incoherente.', 'tourNodes');
    }
  }

  // -- Estado editorial ----------------------------------------------------
  if (!PUBLISHABLE_STATUSES.includes(property.publicationStatus)) {
    add(
      'status_not_publishable',
      'status',
      'La propiedad debe estar aprobada antes de publicarse.',
      'publicationStatus',
    );
  }

  return { valid: issues.length === 0, issues };
}
