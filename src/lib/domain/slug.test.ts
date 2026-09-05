import { describe, expect, it } from 'vitest';

import { isValidSlug, SLUG_MAX_LENGTH, toSlug } from './slug';

describe('toSlug', () => {
  it('normaliza el ejemplo de referencia', () => {
    expect(toSlug('Lote Vista al Mar')).toBe('lote-vista-al-mar');
  });

  it('quita acentos y enes', () => {
    expect(toSlug('Finca Añeja')).toBe('finca-aneja');
    expect(toSlug('Ñandú')).toBe('nandu');
    expect(toSlug('ÁÉÍÓÚ üö')).toBe('aeiou-uo');
  });

  it('colapsa separadores y recorta los extremos', () => {
    expect(toSlug('  ¡Casa   Bonita!  ')).toBe('casa-bonita');
    expect(toSlug('---a---b---')).toBe('a-b');
    expect(toSlug('100% terreno')).toBe('100-terreno');
  });

  it('conserva digitos', () => {
    expect(toSlug('Lote 12B')).toBe('lote-12b');
  });

  it('devuelve cadena vacia cuando no queda nada utilizable', () => {
    expect(toSlug('¡¿!?')).toBe('');
    expect(toSlug('   ')).toBe('');
  });

  it('recorta al maximo sin dejar un guion colgando', () => {
    const slug = toSlug('palabra '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('es idempotente: aplicar toSlug a un slug lo deja igual', () => {
    for (const input of ['Lote Vista al Mar', 'Finca Añeja, 100%', 'Ñandú']) {
      const once = toSlug(input);
      expect(toSlug(once)).toBe(once);
    }
  });

  it('todo lo que produce es un slug valido, salvo la cadena vacia', () => {
    for (const input of ['Lote Vista al Mar', 'Casa   Bonita', '100% terreno', 'Ñandú']) {
      expect(isValidSlug(toSlug(input))).toBe(true);
    }
  });
});

describe('isValidSlug', () => {
  it('acepta minusculas, digitos y guiones simples', () => {
    expect(isValidSlug('lote-vista-al-mar')).toBe(true);
    expect(isValidSlug('lote12')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
  });

  it('rechaza mayusculas, acentos y espacios', () => {
    expect(isValidSlug('Lote-Vista')).toBe(false);
    expect(isValidSlug('lote añejo')).toBe(false);
    expect(isValidSlug('lote_vista')).toBe(false);
  });

  it('rechaza guiones dobles o en los extremos', () => {
    expect(isValidSlug('-lote')).toBe(false);
    expect(isValidSlug('lote-')).toBe(false);
    expect(isValidSlug('lote--vista')).toBe(false);
  });

  it('rechaza la cadena vacia y lo que exceda el maximo', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('a'.repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });
});
