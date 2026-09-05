/**
 * Conversion y presentacion de superficies.
 *
 * La unica fuente de verdad es `properties.area_square_meters`. Nada de esto
 * se guarda en base de datos: se deriva al mostrar.
 */

import type { Locale } from './vocabularies';

export const AREA_UNITS = ['m2', 'ha', 'ft2', 'acre'] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];

export type UnitSystem = 'metric' | 'imperial';

/** Factores exactos por definicion internacional (1 ft = 0.3048 m exactos). */
const SQUARE_METERS_PER_HECTARE = 10_000;
const SQUARE_METERS_PER_SQUARE_FOOT = 0.09290304;
const SQUARE_METERS_PER_ACRE = 4046.8564224;

/**
 * Umbral para pasar de la unidad pequena a la grande.
 *
 * Una hectarea (10.000 m2) es el punto natural en metrico; en imperial se usa
 * el equivalente de un acre, para que ambos sistemas cambien de unidad con
 * superficies parecidas.
 */
const METRIC_LARGE_THRESHOLD_M2 = SQUARE_METERS_PER_HECTARE;
const IMPERIAL_LARGE_THRESHOLD_M2 = SQUARE_METERS_PER_ACRE;

export function squareMetersTo(squareMeters: number, unit: AreaUnit): number {
  switch (unit) {
    case 'm2':
      return squareMeters;
    case 'ha':
      return squareMeters / SQUARE_METERS_PER_HECTARE;
    case 'ft2':
      return squareMeters / SQUARE_METERS_PER_SQUARE_FOOT;
    case 'acre':
      return squareMeters / SQUARE_METERS_PER_ACRE;
  }
}

/**
 * Unidad que mejor representa una superficie dentro de un sistema.
 *
 * Metrico:  < 1 ha  -> m2,   >= 1 ha  -> ha
 * Imperial: < 1 acre -> ft2, >= 1 acre -> acre
 */
export function pickAreaUnit(squareMeters: number, system: UnitSystem): AreaUnit {
  if (system === 'imperial') {
    return squareMeters < IMPERIAL_LARGE_THRESHOLD_M2 ? 'ft2' : 'acre';
  }
  return squareMeters < METRIC_LARGE_THRESHOLD_M2 ? 'm2' : 'ha';
}

/**
 * Decimales por unidad. Las unidades pequenas se cuentan en enteros; las
 * grandes conservan dos decimales para no perder precision util
 * (0.5 ha son 5.000 m2: redondear a entero seria inaceptable).
 */
function fractionDigitsFor(unit: AreaUnit): number {
  return unit === 'ha' || unit === 'acre' ? 2 : 0;
}

const UNIT_SUFFIX: Record<AreaUnit, string> = {
  m2: 'm²',
  ha: 'ha',
  ft2: 'ft²',
  acre: 'acres',
};

export interface FormatAreaOptions {
  /** Fuerza una unidad concreta en lugar de elegirla automaticamente. */
  unit?: AreaUnit;
  /** Sistema usado cuando no se fuerza unidad. Por defecto metrico. */
  system?: UnitSystem;
  locale?: Locale;
}

export interface FormattedArea {
  value: number;
  unit: AreaUnit;
  /** Texto ya listo para mostrar, p. ej. "1,25 ha". */
  text: string;
}

/**
 * Devuelve la superficie convertida y formateada.
 *
 * Sin `unit`, elige la mas legible dentro del sistema pedido.
 */
export function formatArea(squareMeters: number, options: FormatAreaOptions = {}): FormattedArea {
  const { unit: forcedUnit, system = 'metric', locale = 'es' } = options;

  const unit = forcedUnit ?? pickAreaUnit(squareMeters, system);
  const value = squareMetersTo(squareMeters, unit);
  const fractionDigits = fractionDigitsFor(unit);

  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

  return { value, unit, text: `${number} ${UNIT_SUFFIX[unit]}` };
}
