/**
 * Modelo de vista de una fila del listado.
 *
 * Convierte lo que devuelve `GET /api/admin/properties` en texto ya listo
 * para pintar. Es una funcion pura, de modo que el formato se puede probar
 * sin navegador ni DOM.
 *
 * Reutiliza los helpers de la Fase 2A (`formatArea`, `formatMoney`): aqui no
 * se formatea dinero ni superficie a mano.
 */

import { formatArea } from '../../domain/area';
import { formatMoney } from '../../domain/money';
import type {
  CommercialStatus,
  Locale,
  PriceMode,
  PublicationStatus,
} from '../../domain/vocabularies';
import { commercialStatusLabel, publicationStatusLabel } from './labels';

/** Forma de la fila tal y como llega por JSON (las fechas son cadenas ISO). */
export interface PropertyListPayload {
  id: number;
  code: string;
  titleEs: string | null;
  titleEn: string | null;
  propertyTypeId: number | null;
  publicationStatus: PublicationStatus;
  commercialStatus: CommercialStatus;
  isFeatured: boolean;
  priceMode: PriceMode;
  priceAmountMinor: number | null;
  currencyCode: string | null;
  areaSquareMeters: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  publishedAt: string | Date | null;
}

export interface PropertyTypePayload {
  id: number;
  systemKey: string | null;
  names: Partial<Record<Locale, string>>;
}

export interface TitleView {
  text: string;
  /** Idioma del texto mostrado, o `null` cuando no hay ninguno. */
  locale: Locale | null;
  /** Cierto cuando se muestra ingles porque falta el espanol. */
  missingSpanish: boolean;
}

export interface PropertyRowView {
  id: number;
  code: string;
  title: TitleView;
  typeName: string | null;
  publicationStatus: PublicationStatus;
  publicationLabel: string;
  commercialStatus: CommercialStatus;
  commercialLabel: string;
  /** Superficie formateada, o `null` si todavia no se ha indicado. */
  area: string | null;
  price: PriceView;
  updatedAt: string;
}

export interface PriceView {
  text: string;
  /** Nota discreta junto al importe, hoy solo "Negociable". */
  note: string | null;
}

const NO_TITLE = 'Sin título';

/**
 * Titulo a mostrar.
 *
 * Se prefiere espanol. Si solo hay ingles se muestra ese, marcando que falta
 * el espanol para que el admin lo vea sin tener que abrir la ficha. Nunca se
 * inventa un nombre.
 */
export function resolveTitle(row: Pick<PropertyListPayload, 'titleEs' | 'titleEn'>): TitleView {
  const es = row.titleEs?.trim();
  if (es !== undefined && es.length > 0) {
    return { text: es, locale: 'es', missingSpanish: false };
  }

  const en = row.titleEn?.trim();
  if (en !== undefined && en.length > 0) {
    return { text: en, locale: 'en', missingSpanish: true };
  }

  return { text: NO_TITLE, locale: null, missingSpanish: true };
}

/**
 * Precio segun el modo.
 *
 * - `exact`      -> importe y moneda;
 * - `negotiable` -> importe y moneda, con la nota "Negociable";
 * - `contact`    -> "Consultar".
 *
 * Sin conversion de moneda. Un modo con importe incompleto cae a "Consultar"
 * en lugar de mostrar un precio a medias.
 */
export function resolvePrice(
  row: Pick<PropertyListPayload, 'priceMode' | 'priceAmountMinor' | 'currencyCode'>,
): PriceView {
  if (row.priceMode === 'contact') return { text: 'Consultar', note: null };

  const { priceAmountMinor, currencyCode } = row;
  if (priceAmountMinor === null || currencyCode === null) {
    return { text: 'Consultar', note: null };
  }

  const text = formatMoney(priceAmountMinor, currencyCode, 'es');
  return { text, note: row.priceMode === 'negotiable' ? 'Negociable' : null };
}

/** Superficie en metrico, con las reglas de la Fase 2A. */
export function resolveArea(areaSquareMeters: number | null): string | null {
  if (areaSquareMeters === null || !(areaSquareMeters > 0)) return null;
  return formatArea(areaSquareMeters, { system: 'metric', locale: 'es' }).text;
}

export function formatUpdatedAt(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(date);
}

/** Nombre del tipo en espanol, con el ingles como respaldo. */
export function resolveTypeName(
  propertyTypeId: number | null,
  types: readonly PropertyTypePayload[],
): string | null {
  if (propertyTypeId === null) return null;

  const type = types.find((candidate) => candidate.id === propertyTypeId);
  if (type === undefined) return null;

  return type.names.es ?? type.names.en ?? null;
}

export function toPropertyRowView(
  row: PropertyListPayload,
  types: readonly PropertyTypePayload[] = [],
): PropertyRowView {
  return {
    id: row.id,
    code: row.code,
    title: resolveTitle(row),
    typeName: resolveTypeName(row.propertyTypeId, types),
    publicationStatus: row.publicationStatus,
    publicationLabel: publicationStatusLabel(row.publicationStatus),
    commercialStatus: row.commercialStatus,
    commercialLabel: commercialStatusLabel(row.commercialStatus),
    area: resolveArea(row.areaSquareMeters),
    price: resolvePrice(row),
    updatedAt: formatUpdatedAt(row.updatedAt),
  };
}
