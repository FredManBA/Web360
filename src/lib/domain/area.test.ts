import { describe, expect, it } from 'vitest';

import { formatArea, pickAreaUnit, squareMetersTo } from './area';

describe('squareMetersTo', () => {
  it('deja los metros cuadrados intactos', () => {
    expect(squareMetersTo(1234, 'm2')).toBe(1234);
  });

  it('convierte a hectareas', () => {
    expect(squareMetersTo(10_000, 'ha')).toBe(1);
    expect(squareMetersTo(25_000, 'ha')).toBe(2.5);
  });

  it('convierte a pies cuadrados con el factor exacto', () => {
    // 1 ft = 0.3048 m exactos -> 1 m2 = 10.7639... ft2
    expect(squareMetersTo(1, 'ft2')).toBeCloseTo(10.763910416709722, 9);
    expect(squareMetersTo(0.09290304, 'ft2')).toBeCloseTo(1, 12);
  });

  it('convierte a acres', () => {
    expect(squareMetersTo(4046.8564224, 'acre')).toBeCloseTo(1, 12);
    expect(squareMetersTo(10_000, 'acre')).toBeCloseTo(2.4710538146717, 9);
  });

  it('una hectarea son 2,471 acres', () => {
    const ha = squareMetersTo(10_000, 'ha');
    const acres = squareMetersTo(10_000, 'acre');
    expect(ha).toBe(1);
    expect(acres / ha).toBeCloseTo(2.4710538146717, 9);
  });
});

describe('pickAreaUnit', () => {
  it('metrico: por debajo de una hectarea usa m2', () => {
    expect(pickAreaUnit(500, 'metric')).toBe('m2');
    expect(pickAreaUnit(9_999, 'metric')).toBe('m2');
  });

  it('metrico: a partir de una hectarea usa ha', () => {
    expect(pickAreaUnit(10_000, 'metric')).toBe('ha');
    expect(pickAreaUnit(250_000, 'metric')).toBe('ha');
  });

  it('imperial: por debajo de un acre usa ft2', () => {
    expect(pickAreaUnit(500, 'imperial')).toBe('ft2');
    expect(pickAreaUnit(4000, 'imperial')).toBe('ft2');
  });

  it('imperial: a partir de un acre usa acres', () => {
    expect(pickAreaUnit(4046.8564224, 'imperial')).toBe('acre');
    expect(pickAreaUnit(100_000, 'imperial')).toBe('acre');
  });

  it('por defecto el sistema es metrico', () => {
    expect(formatArea(500).unit).toBe('m2');
    expect(formatArea(50_000).unit).toBe('ha');
  });
});

describe('formatArea', () => {
  it('elige la unidad automaticamente', () => {
    expect(formatArea(800, { system: 'metric' }).unit).toBe('m2');
    expect(formatArea(80_000, { system: 'metric' }).unit).toBe('ha');
  });

  it('respeta la unidad pedida explicitamente', () => {
    const forced = formatArea(80_000, { unit: 'm2' });
    expect(forced.unit).toBe('m2');
    expect(forced.value).toBe(80_000);
  });

  it('devuelve el valor convertido sin redondear', () => {
    expect(formatArea(12_500, { unit: 'ha' }).value).toBe(1.25);
  });

  it('no redondea las unidades grandes a entero', () => {
    // Media hectarea son 5.000 m2: perderlo seria inaceptable.
    expect(formatArea(5_000, { unit: 'ha' }).text).toContain('0,5');
  });

  it('incluye el sufijo de la unidad en el texto', () => {
    expect(formatArea(800, { unit: 'm2' }).text).toContain('m²');
    expect(formatArea(80_000, { unit: 'ha' }).text).toContain('ha');
    expect(formatArea(800, { unit: 'ft2' }).text).toContain('ft²');
    expect(formatArea(80_000, { unit: 'acre' }).text).toContain('acres');
  });

  it('usa el separador decimal del locale', () => {
    expect(formatArea(12_500, { unit: 'ha', locale: 'es' }).text).toBe('1,25 ha');
    expect(formatArea(12_500, { unit: 'ha', locale: 'en' }).text).toBe('1.25 ha');
  });
});
