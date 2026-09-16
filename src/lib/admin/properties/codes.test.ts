import { describe, expect, it } from 'vitest';

import { nextPropertyCode, PROPERTY_CODE_PREFIX, validatePropertyCode } from './codes';

describe('nextPropertyCode', () => {
  it('empieza en CR360-001', () => {
    expect(nextPropertyCode([])).toBe('CR360-001');
  });

  it('continua la secuencia', () => {
    expect(nextPropertyCode(['CR360-001'])).toBe('CR360-002');
    expect(nextPropertyCode(['CR360-001', 'CR360-002'])).toBe('CR360-003');
  });

  it('deriva del MAXIMO, no del numero de codigos', () => {
    // Si contara filas, con 2 codigos devolveria CR360-003 y colisionaria.
    expect(nextPropertyCode(['CR360-001', 'CR360-009'])).toBe('CR360-010');
  });

  it('no reutiliza el hueco de un codigo eliminado', () => {
    expect(nextPropertyCode(['CR360-001', 'CR360-003'])).toBe('CR360-004');
  });

  it('ignora los codigos editados a mano', () => {
    expect(nextPropertyCode(['CR360-001', 'FINCA-SUR', 'lote-a'])).toBe('CR360-002');
  });

  it('crece mas alla de tres digitos sin truncar', () => {
    expect(nextPropertyCode(['CR360-999'])).toBe('CR360-1000');
    expect(nextPropertyCode(['CR360-1000'])).toBe('CR360-1001');
  });

  it('no se confunde con codigos parecidos', () => {
    expect(nextPropertyCode(['CR360-01A', 'CR360-', 'CR360X-002'])).toBe('CR360-001');
  });

  it('el orden de la entrada no importa', () => {
    expect(nextPropertyCode(['CR360-005', 'CR360-002'])).toBe('CR360-006');
    expect(nextPropertyCode(['CR360-002', 'CR360-005'])).toBe('CR360-006');
  });
});

describe('validatePropertyCode', () => {
  it('acepta codigos generados y manuales razonables', () => {
    for (const code of ['CR360-001', 'FINCA-SUR-2', 'lote_12', 'A.1']) {
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
    expect(validatePropertyCode('  CR360-001  ')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* La identidad publica del codigo                                            */
/* -------------------------------------------------------------------------- */

describe('el prefijo de los codigos nuevos', () => {
  it('es CR360', () => {
    expect(PROPERTY_CODE_PREFIX).toBe('CR360');
  });

  it('ningun codigo generado vuelve a decir LOBA', () => {
    const generados = [
      nextPropertyCode([]),
      nextPropertyCode(['CR360-041']),
      // Y tampoco cuando la base todavia arrastra codigos del nombre viejo.
      nextPropertyCode(['LOBA-007', 'LOBA-120']),
    ];

    for (const codigo of generados) {
      expect(codigo.startsWith('CR360-')).toBe(true);
      expect(codigo).not.toContain('LOBA');
    }
  });

  /*
   * Los codigos antiguos siguen siendo validos y nadie los renombra, pero no
   * mandan sobre la secuencia nueva: `LOBA-120` no hace que el siguiente sea
   * el 121.
   */
  it('los codigos del nombre anterior no arrastran la secuencia', () => {
    expect(nextPropertyCode(['LOBA-007', 'LOBA-120'])).toBe('CR360-001');
    expect(nextPropertyCode(['LOBA-120', 'CR360-004'])).toBe('CR360-005');
  });

  it('cuenta los digitos de verdad, no una letra `d`', () => {
    // El patron se construye con `String.raw`; sin el, `\d` seria la letra.
    expect(nextPropertyCode(['CR360-009'])).toBe('CR360-010');
    expect(nextPropertyCode(['CR360-ddd'])).toBe('CR360-001');
  });
});
