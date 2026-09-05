import { describe, expect, it } from 'vitest';

import { nextPropertyCode, validatePropertyCode } from './codes';

describe('nextPropertyCode', () => {
  it('empieza en LOBA-001', () => {
    expect(nextPropertyCode([])).toBe('LOBA-001');
  });

  it('continua la secuencia', () => {
    expect(nextPropertyCode(['LOBA-001'])).toBe('LOBA-002');
    expect(nextPropertyCode(['LOBA-001', 'LOBA-002'])).toBe('LOBA-003');
  });

  it('deriva del MAXIMO, no del numero de codigos', () => {
    // Si contara filas, con 2 codigos devolveria LOBA-003 y colisionaria.
    expect(nextPropertyCode(['LOBA-001', 'LOBA-009'])).toBe('LOBA-010');
  });

  it('no reutiliza el hueco de un codigo eliminado', () => {
    expect(nextPropertyCode(['LOBA-001', 'LOBA-003'])).toBe('LOBA-004');
  });

  it('ignora los codigos editados a mano', () => {
    expect(nextPropertyCode(['LOBA-001', 'FINCA-SUR', 'lote-a'])).toBe('LOBA-002');
  });

  it('crece mas alla de tres digitos sin truncar', () => {
    expect(nextPropertyCode(['LOBA-999'])).toBe('LOBA-1000');
    expect(nextPropertyCode(['LOBA-1000'])).toBe('LOBA-1001');
  });

  it('no se confunde con codigos parecidos', () => {
    expect(nextPropertyCode(['LOBA-01A', 'LOBA-', 'LOBAX-002'])).toBe('LOBA-001');
  });

  it('el orden de la entrada no importa', () => {
    expect(nextPropertyCode(['LOBA-005', 'LOBA-002'])).toBe('LOBA-006');
    expect(nextPropertyCode(['LOBA-002', 'LOBA-005'])).toBe('LOBA-006');
  });
});

describe('validatePropertyCode', () => {
  it('acepta codigos generados y manuales razonables', () => {
    for (const code of ['LOBA-001', 'FINCA-SUR-2', 'lote_12', 'A.1']) {
      expect(validatePropertyCode(code)).toEqual([]);
    }
  });

  it('rechaza vacio o solo espacios', () => {
    expect(validatePropertyCode('')).toEqual(['empty']);
    expect(validatePropertyCode('   ')).toEqual(['empty']);
  });

  it('rechaza longitudes excesivas', () => {
    expect(validatePropertyCode('A'.repeat(65))).toEqual(['too_long']);
  });

  it('rechaza caracteres inseguros', () => {
    for (const code of ['lote 1', 'lote?1', 'lote#1', '-empieza-mal']) {
      expect(validatePropertyCode(code)).toEqual(['unsafe_characters']);
    }
  });

  it('ignora los espacios de los extremos al validar', () => {
    expect(validatePropertyCode('  LOBA-001  ')).toEqual([]);
  });
});
