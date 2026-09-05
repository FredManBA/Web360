/**
 * Manejo monetario.
 *
 * La fuente de verdad es `properties.price_amount_minor`: un ENTERO en
 * unidades monetarias menores (centavos para USD y CRC). Nunca se usa `float`
 * para representar dinero; la conversion desde el formulario se hace con
 * aritmetica de cadenas para evitar errores del tipo 125000.10 * 100.
 *
 * No hay conversion entre monedas ni tipos de cambio.
 */

import type { Locale, PriceMode } from './vocabularies';

/**
 * Monedas admitidas en el formulario por ahora. Los helpers de este modulo
 * funcionan con cualquier codigo ISO 4217 que conozca `Intl`, pero el panel
 * solo ofrecera estas dos hasta que haga falta otra.
 */
export const SUPPORTED_CURRENCY_CODES = ['USD', 'CRC'] as const;
export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

/** ISO 4217: exactamente tres letras mayusculas (igual que el CHECK del esquema). */
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** Importe del formulario: digitos con un unico separador decimal opcional. */
const DECIMAL_INPUT_PATTERN = /^(\d+)(?:[.,](\d+))?$/;

export function isValidCurrencyCode(code: string): boolean {
  if (!CURRENCY_CODE_PATTERN.test(code)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
}

/**
 * Decimales estandar de la moneda segun `Intl` (2 para USD y CRC, 0 para JPY).
 * Evita mantener a mano una tabla de unidades menores.
 */
export function currencyFractionDigits(currencyCode: string): number {
  const resolved = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currencyCode,
  }).resolvedOptions();

  return resolved.maximumFractionDigits ?? 2;
}

export type MoneyParseResult =
  | { ok: true; amountMinor: number }
  | { ok: false; reason: 'invalid_currency' | 'invalid_format' | 'too_many_decimals' };

/**
 * Convierte el importe escrito en el formulario a unidades menores.
 *
 * "125000"    + USD -> 12500000
 * "125000.5"  + USD -> 12500050
 * "125000,10" + USD -> 12500010
 *
 * Se rechaza (en lugar de redondear en silencio) un importe con mas decimales
 * de los que admite la moneda: perder dinero por un redondeo callado es peor
 * que pedirle al usuario que lo corrija.
 */
export function parseAmountToMinor(input: string, currencyCode: string): MoneyParseResult {
  if (!isValidCurrencyCode(currencyCode)) return { ok: false, reason: 'invalid_currency' };

  const match = DECIMAL_INPUT_PATTERN.exec(input.trim());
  if (!match) return { ok: false, reason: 'invalid_format' };

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  const digits = currencyFractionDigits(currencyCode);

  if (fraction.length > digits) return { ok: false, reason: 'too_many_decimals' };

  // Aritmetica de cadenas: se completa la parte decimal y se concatena.
  const paddedFraction = fraction.padEnd(digits, '0');
  const amountMinor = Number(`${whole}${paddedFraction}`);

  if (!Number.isSafeInteger(amountMinor)) return { ok: false, reason: 'invalid_format' };

  return { ok: true, amountMinor };
}

/**
 * Vuelve de unidades menores a la representacion decimal del formulario.
 * Devuelve cadena, no numero, para no reintroducir imprecision.
 *
 * 12500050 + USD -> "125000.50"
 */
export function formatMinorAsDecimal(
  amountMinor: number,
  currencyCode: string,
): Intl.StringNumericLiteral {
  const digits = currencyFractionDigits(currencyCode);
  if (digits === 0) return String(amountMinor) as Intl.StringNumericLiteral;

  const negative = amountMinor < 0;
  const raw = String(Math.abs(amountMinor)).padStart(digits + 1, '0');
  const whole = raw.slice(0, raw.length - digits);
  const fraction = raw.slice(raw.length - digits);

  /*
   * El resultado siempre tiene la forma `${number}`, pero TypeScript no puede
   * deducirlo de una concatenacion. El tipo se declara explicitamente para que
   * `Intl.NumberFormat.format` acepte la cadena y la formatee de forma exacta,
   * sin pasar por coma flotante.
   */
  return `${negative ? '-' : ''}${whole}.${fraction}` as Intl.StringNumericLiteral;
}

/**
 * Importe listo para mostrar, p. ej. "$125,000.00" o "₡85 000,00".
 *
 * Se pasa la cadena decimal a `Intl` (no un `number`) porque `Intl.NumberFormat`
 * acepta cadenas y las formatea de forma exacta, sin pasar por coma flotante.
 */
export function formatMoney(
  amountMinor: number,
  currencyCode: string,
  locale: Locale = 'es',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
  }).format(formatMinorAsDecimal(amountMinor, currencyCode));
}

export interface PriceInput {
  priceMode: PriceMode;
  priceAmountMinor: number | null;
  currencyCode: string | null;
}

export type PriceProblem =
  'amount_required' | 'currency_required' | 'currency_invalid' | 'amount_negative';

/**
 * Coherencia del precio segun el modo.
 *
 * - `exact` y `negotiable` exigen importe y moneda.
 * - `contact` admite importe nulo; si trae moneda, debe ser valida.
 */
export function validatePrice(input: PriceInput): PriceProblem[] {
  const problems: PriceProblem[] = [];
  const { priceMode, priceAmountMinor, currencyCode } = input;

  if (priceAmountMinor !== null && priceAmountMinor < 0) problems.push('amount_negative');

  if (currencyCode !== null && !isValidCurrencyCode(currencyCode)) {
    problems.push('currency_invalid');
  }

  if (priceMode === 'exact' || priceMode === 'negotiable') {
    if (priceAmountMinor === null) problems.push('amount_required');
    if (currencyCode === null) problems.push('currency_required');
  }

  return problems;
}
