import { describe, expect, it } from 'vitest';

import {
  currencyFractionDigits,
  formatMinorAsDecimal,
  formatMoney,
  isValidCurrencyCode,
  parseAmountToMinor,
  validatePrice,
} from './money';

describe('isValidCurrencyCode', () => {
  it('acepta ISO 4217 en mayusculas', () => {
    expect(isValidCurrencyCode('USD')).toBe(true);
    expect(isValidCurrencyCode('CRC')).toBe(true);
  });

  it('rechaza minusculas, longitudes distintas de 3 y basura', () => {
    expect(isValidCurrencyCode('usd')).toBe(false);
    expect(isValidCurrencyCode('USDD')).toBe(false);
    expect(isValidCurrencyCode('US')).toBe(false);
    expect(isValidCurrencyCode('123')).toBe(false);
  });
});

describe('currencyFractionDigits', () => {
  it('USD y CRC usan dos decimales', () => {
    expect(currencyFractionDigits('USD')).toBe(2);
    expect(currencyFractionDigits('CRC')).toBe(2);
  });

  it('detecta monedas sin decimales', () => {
    expect(currencyFractionDigits('JPY')).toBe(0);
  });
});

describe('parseAmountToMinor', () => {
  it('convierte enteros', () => {
    expect(parseAmountToMinor('125000', 'USD')).toEqual({ ok: true, amountMinor: 12_500_000 });
  });

  it('convierte el ejemplo de referencia: USD 125.000,00 -> 12500000', () => {
    expect(parseAmountToMinor('125000.00', 'USD')).toEqual({ ok: true, amountMinor: 12_500_000 });
  });

  it('completa los decimales que falten', () => {
    expect(parseAmountToMinor('125000.5', 'USD')).toEqual({ ok: true, amountMinor: 12_500_050 });
  });

  it('acepta coma como separador decimal', () => {
    expect(parseAmountToMinor('125000,10', 'USD')).toEqual({ ok: true, amountMinor: 12_500_010 });
  });

  it('no pierde centavos por aritmetica de coma flotante', () => {
    // 125000.10 * 100 en float da 12500009.999999998
    expect(parseAmountToMinor('125000.10', 'USD')).toEqual({ ok: true, amountMinor: 12_500_010 });
    expect(parseAmountToMinor('0.29', 'USD')).toEqual({ ok: true, amountMinor: 29 });
    expect(parseAmountToMinor('1.005', 'JPY')).toEqual({ ok: false, reason: 'too_many_decimals' });
  });

  it('trata las monedas sin decimales como enteras', () => {
    expect(parseAmountToMinor('1000', 'JPY')).toEqual({ ok: true, amountMinor: 1000 });
  });

  it('rechaza mas decimales de los que admite la moneda, en vez de redondear', () => {
    expect(parseAmountToMinor('10.005', 'USD')).toEqual({ ok: false, reason: 'too_many_decimals' });
  });

  it('rechaza formatos invalidos', () => {
    for (const bad of ['', 'abc', '-10', '1.2.3', '1,2,3', '125 000', '1e5']) {
      expect(parseAmountToMinor(bad, 'USD').ok).toBe(false);
    }
  });

  it('rechaza monedas invalidas', () => {
    expect(parseAmountToMinor('10', 'usd')).toEqual({ ok: false, reason: 'invalid_currency' });
  });

  it('ignora espacios alrededor', () => {
    expect(parseAmountToMinor('  125000.50  ', 'USD')).toEqual({
      ok: true,
      amountMinor: 12_500_050,
    });
  });
});

describe('formatMinorAsDecimal', () => {
  it('vuelve a la representacion del formulario', () => {
    expect(formatMinorAsDecimal(12_500_000, 'USD')).toBe('125000.00');
    expect(formatMinorAsDecimal(12_500_010, 'USD')).toBe('125000.10');
  });

  it('rellena importes pequenos', () => {
    expect(formatMinorAsDecimal(5, 'USD')).toBe('0.05');
    expect(formatMinorAsDecimal(0, 'USD')).toBe('0.00');
  });

  it('deja las monedas sin decimales como enteros', () => {
    expect(formatMinorAsDecimal(1000, 'JPY')).toBe('1000');
  });

  it('es el inverso exacto de parseAmountToMinor', () => {
    for (const amount of ['0.00', '0.05', '125000.00', '125000.10', '999999.99']) {
      const parsed = parseAmountToMinor(amount, 'USD');
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatMinorAsDecimal(parsed.amountMinor, 'USD')).toBe(amount);
    }
  });
});

describe('formatMoney', () => {
  // Se comprueban los digitos, no el simbolo ni su posicion: eso depende de
  // la version de ICU y haria el test fragil.
  it('incluye el importe formateado', () => {
    const text = formatMoney(12_500_000, 'USD', 'en');
    expect(text).toContain('125,000.00');
  });

  it('respeta el locale', () => {
    expect(formatMoney(12_500_000, 'USD', 'es')).toContain('125.000,00');
  });

  it('formatea CRC', () => {
    expect(formatMoney(8_500_000_000, 'CRC', 'es')).toContain('85.000.000,00');
  });
});

describe('validatePrice', () => {
  it('exact exige importe y moneda', () => {
    expect(
      validatePrice({ priceMode: 'exact', priceAmountMinor: 12_500_000, currencyCode: 'USD' }),
    ).toEqual([]);

    expect(
      validatePrice({ priceMode: 'exact', priceAmountMinor: null, currencyCode: 'USD' }),
    ).toContain('amount_required');

    expect(
      validatePrice({ priceMode: 'exact', priceAmountMinor: 100, currencyCode: null }),
    ).toContain('currency_required');
  });

  it('negotiable tambien exige importe y moneda', () => {
    expect(
      validatePrice({ priceMode: 'negotiable', priceAmountMinor: 100, currencyCode: 'CRC' }),
    ).toEqual([]);

    expect(
      validatePrice({ priceMode: 'negotiable', priceAmountMinor: null, currencyCode: null }),
    ).toEqual(expect.arrayContaining(['amount_required', 'currency_required']));
  });

  it('contact admite importe nulo', () => {
    expect(
      validatePrice({ priceMode: 'contact', priceAmountMinor: null, currencyCode: null }),
    ).toEqual([]);
  });

  it('contact con importe tambien es valido', () => {
    expect(
      validatePrice({ priceMode: 'contact', priceAmountMinor: 100, currencyCode: 'USD' }),
    ).toEqual([]);
  });

  it('rechaza moneda invalida en cualquier modo', () => {
    expect(
      validatePrice({ priceMode: 'contact', priceAmountMinor: null, currencyCode: 'usd' }),
    ).toContain('currency_invalid');
  });

  it('rechaza importes negativos', () => {
    expect(
      validatePrice({ priceMode: 'exact', priceAmountMinor: -1, currencyCode: 'USD' }),
    ).toContain('amount_negative');
  });
});
