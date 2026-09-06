/**
 * Conversion entre el formulario del editor y el modelo de dominio.
 *
 * Todo lo que el usuario escribe llega como cadena. Aqui se valida y se
 * convierte, sin tocar el DOM, de modo que las reglas se pueden probar.
 *
 * El dinero NUNCA pasa por `parseFloat(value) * 100`: se usa
 * `parseAmountToMinor` de la Fase 2A, que hace la conversion con aritmetica
 * de cadenas. Las reglas de coherencia del precio salen de `validatePrice`,
 * no se reescriben aqui.
 */

import { formatArea } from '../../domain/area';
import {
  formatMinorAsDecimal,
  formatMoney,
  parseAmountToMinor,
  validatePrice,
} from '../../domain/money';
import { isValidLatitude, isValidLongitude } from '../../domain/location';
import { COMMERCIAL_STATUSES, LOCATION_PRECISIONS, PRICE_MODES } from '../../domain/vocabularies';
import type { CommercialStatus, LocationPrecision, PriceMode } from '../../domain/vocabularies';
import { validateCodeLocally, type EditorFields } from './editor-state';

/** Lo que se lee literalmente de los controles del formulario. */
export interface EditorFormRaw {
  code: string;
  propertyTypeId: string;
  commercialStatus: string;
  isFeatured: boolean;
  showWhenSold: boolean;

  priceMode: string;
  /** Importe decimal humano: "125000", "125000.50". */
  priceAmount: string;
  currencyCode: string;

  areaSquareMeters: string;

  province: string;
  canton: string;
  district: string;
  locality: string;

  privateLatitude: string;
  privateLongitude: string;
  publicLatitude: string;
  publicLongitude: string;
  locationPrecision: string;
}

export interface FieldError {
  field: string;
  message: string;
}

export type ParseFormResult =
  { ok: true; fields: EditorFields } | { ok: false; errors: FieldError[] };

const PRICE_PROBLEM_FIELD: Record<string, string> = {
  amount_required: 'priceAmount',
  amount_negative: 'priceAmount',
  currency_required: 'currencyCode',
  currency_invalid: 'currencyCode',
};

const PRICE_PROBLEM_MESSAGE: Record<string, string> = {
  amount_required: 'Este modo de precio exige un importe.',
  amount_negative: 'El importe no puede ser negativo.',
  currency_required: 'Este modo de precio exige una moneda.',
  currency_invalid: 'La moneda no es válida.',
};

/** Texto opcional: vacio se guarda como `null`, nunca como cadena vacia. */
export function parseOptionalText(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

type NumberParse = { ok: true; value: number | null } | { ok: false };

/**
 * Numero opcional.
 *
 * Un campo vacio es `null`, no `0` ni `NaN`. Se admite la coma como separador
 * decimal porque es lo natural al teclear en espanol.
 */
export function parseOptionalNumber(raw: string): NumberParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };

  const normalized = trimmed.replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(normalized)) return { ok: false };

  const value = Number(normalized);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

function asEnum<T extends string>(raw: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * Valida y convierte el formulario completo.
 *
 * Devuelve TODOS los errores encontrados, no solo el primero, para que el
 * usuario pueda corregirlos de una vez.
 */
export function parseEditorForm(raw: EditorFormRaw): ParseFormResult {
  const errors: FieldError[] = [];

  // -- Codigo --------------------------------------------------------------
  const codeProblem = validateCodeLocally(raw.code);
  if (codeProblem !== null) errors.push({ field: 'code', message: codeProblem });

  // -- Vocabularios --------------------------------------------------------
  const priceMode = asEnum<PriceMode>(raw.priceMode, PRICE_MODES, 'contact');
  const commercialStatus = asEnum<CommercialStatus>(
    raw.commercialStatus,
    COMMERCIAL_STATUSES,
    'available',
  );
  const locationPrecision = asEnum<LocationPrecision>(
    raw.locationPrecision,
    LOCATION_PRECISIONS,
    'approximate',
  );

  // -- Precio --------------------------------------------------------------
  const currencyCode = raw.currencyCode.trim().length === 0 ? null : raw.currencyCode.trim();
  let priceAmountMinor: number | null = null;
  const rawAmount = raw.priceAmount.trim();

  if (rawAmount.length > 0) {
    if (currencyCode === null) {
      errors.push({ field: 'currencyCode', message: 'Elige una moneda para el importe.' });
    } else {
      const parsed = parseAmountToMinor(rawAmount, currencyCode);
      if (parsed.ok) {
        priceAmountMinor = parsed.amountMinor;
      } else {
        errors.push({
          field: 'priceAmount',
          message:
            parsed.reason === 'too_many_decimals'
              ? 'El importe tiene más decimales de los que admite la moneda.'
              : 'El importe no es válido.',
        });
      }
    }
  }

  // -- Superficie ----------------------------------------------------------
  const area = parseOptionalNumber(raw.areaSquareMeters);
  let areaSquareMeters: number | null = null;

  if (!area.ok) {
    errors.push({ field: 'areaSquareMeters', message: 'La superficie no es válida.' });
  } else if (area.value !== null && !(area.value > 0)) {
    errors.push({ field: 'areaSquareMeters', message: 'La superficie debe ser mayor que cero.' });
  } else {
    areaSquareMeters = area.value;
  }

  // -- Coordenadas ---------------------------------------------------------
  const coords = {
    privateLatitude: null as number | null,
    privateLongitude: null as number | null,
    publicLatitude: null as number | null,
    publicLongitude: null as number | null,
  };

  const coordinateFields = [
    { key: 'privateLatitude', raw: raw.privateLatitude, isLat: true },
    { key: 'privateLongitude', raw: raw.privateLongitude, isLat: false },
    { key: 'publicLatitude', raw: raw.publicLatitude, isLat: true },
    { key: 'publicLongitude', raw: raw.publicLongitude, isLat: false },
  ] as const;

  for (const field of coordinateFields) {
    const parsed = parseOptionalNumber(field.raw);

    if (!parsed.ok) {
      errors.push({ field: field.key, message: 'La coordenada no es válida.' });
      continue;
    }

    if (parsed.value !== null) {
      const inRange = field.isLat ? isValidLatitude(parsed.value) : isValidLongitude(parsed.value);
      if (!inRange) {
        errors.push({
          field: field.key,
          message: field.isLat
            ? 'La latitud debe estar entre -90 y 90.'
            : 'La longitud debe estar entre -180 y 180.',
        });
        continue;
      }
    }

    coords[field.key] = parsed.value;
  }

  // Los pares deben estar completos: media coordenada no sirve de nada.
  if ((coords.privateLatitude === null) !== (coords.privateLongitude === null)) {
    errors.push({
      field: coords.privateLatitude === null ? 'privateLatitude' : 'privateLongitude',
      message: 'Indica latitud y longitud privadas, o ninguna de las dos.',
    });
  }

  if ((coords.publicLatitude === null) !== (coords.publicLongitude === null)) {
    errors.push({
      field: coords.publicLatitude === null ? 'publicLatitude' : 'publicLongitude',
      message: 'Indica latitud y longitud públicas, o ninguna de las dos.',
    });
  }

  const fields: EditorFields = {
    code: raw.code.trim(),
    propertyTypeId: raw.propertyTypeId.trim().length === 0 ? null : Number(raw.propertyTypeId),
    commercialStatus,
    isFeatured: raw.isFeatured,
    showWhenSold: raw.showWhenSold,

    priceMode,
    priceAmountMinor,
    currencyCode,

    areaSquareMeters,

    province: parseOptionalText(raw.province),
    canton: parseOptionalText(raw.canton),
    district: parseOptionalText(raw.district),
    locality: parseOptionalText(raw.locality),

    ...coords,
    locationPrecision,
  };

  // Coherencia del precio segun el modo: regla del dominio, no reescrita aqui.
  for (const problem of validatePrice(fields)) {
    const field = PRICE_PROBLEM_FIELD[problem] ?? 'priceMode';
    if (errors.some((error) => error.field === field)) continue;

    errors.push({ field, message: PRICE_PROBLEM_MESSAGE[problem] ?? 'Precio incoherente.' });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, fields };
}

/* -------------------------------------------------------------------------- */
/* Del modelo al formulario                                                   */
/* -------------------------------------------------------------------------- */

function numberToInput(value: number | null): string {
  return value === null ? '' : String(value);
}

/** Rellena los controles a partir de la propiedad cargada. */
export function fieldsToRaw(fields: EditorFields): EditorFormRaw {
  return {
    code: fields.code,
    propertyTypeId: fields.propertyTypeId === null ? '' : String(fields.propertyTypeId),
    commercialStatus: fields.commercialStatus,
    isFeatured: fields.isFeatured,
    showWhenSold: fields.showWhenSold,

    priceMode: fields.priceMode,
    priceAmount:
      fields.priceAmountMinor === null || fields.currencyCode === null
        ? ''
        : formatMinorAsDecimal(fields.priceAmountMinor, fields.currencyCode),
    currencyCode: fields.currencyCode ?? '',

    areaSquareMeters: numberToInput(fields.areaSquareMeters),

    province: fields.province ?? '',
    canton: fields.canton ?? '',
    district: fields.district ?? '',
    locality: fields.locality ?? '',

    privateLatitude: numberToInput(fields.privateLatitude),
    privateLongitude: numberToInput(fields.privateLongitude),
    publicLatitude: numberToInput(fields.publicLatitude),
    publicLongitude: numberToInput(fields.publicLongitude),
    locationPrecision: fields.locationPrecision,
  };
}

/* -------------------------------------------------------------------------- */
/* Vistas previas                                                             */
/* -------------------------------------------------------------------------- */

/** Vista previa del importe, con el mismo formateador que el resto del panel. */
export function pricePreview(rawAmount: string, currencyCode: string): string | null {
  const amount = rawAmount.trim();
  if (amount.length === 0 || currencyCode.trim().length === 0) return null;

  const parsed = parseAmountToMinor(amount, currencyCode.trim());
  return parsed.ok ? formatMoney(parsed.amountMinor, currencyCode.trim(), 'es') : null;
}

/** Equivalencia informativa de la superficie, con la regla de la Fase 2A. */
export function areaPreview(rawArea: string): string | null {
  const parsed = parseOptionalNumber(rawArea);
  if (!parsed.ok || parsed.value === null || !(parsed.value > 0)) return null;

  return formatArea(parsed.value, { system: 'metric', locale: 'es' }).text;
}
