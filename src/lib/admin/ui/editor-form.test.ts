/**
 * Tests de precio, superficie y ubicacion en el editor.
 *
 * Funciones puras sobre el formulario mas comprobaciones estructurales de la
 * pagina. Sin navegador ni E2E.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatArea } from '../../domain/area';
import { formatMoney } from '../../domain/money';
import {
  areaPreview,
  fieldsToRaw,
  parseEditorForm,
  parseOptionalNumber,
  parseOptionalText,
  pricePreview,
  type EditorFormRaw,
} from './editor-form';
import { buildPatch, isDirty, toEditorFields, type EditorFields } from './editor-state';

const EDITOR_PAGE = 'src/pages/admin/propiedades/[id].astro';
const EDITOR_SCRIPT = 'src/lib/admin/ui/editor-page.ts';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

function raw(overrides: Partial<EditorFormRaw> = {}): EditorFormRaw {
  return {
    code: 'LOBA-001',
    propertyTypeId: '',
    commercialStatus: 'available',
    isFeatured: false,
    showWhenSold: false,

    priceMode: 'contact',
    priceAmount: '',
    currencyCode: '',

    areaSquareMeters: '',

    province: '',
    canton: '',
    district: '',
    locality: '',

    privateLatitude: '',
    privateLongitude: '',
    publicLatitude: '',
    publicLongitude: '',
    locationPrecision: 'approximate',
    ...overrides,
  };
}

function parse(overrides: Partial<EditorFormRaw> = {}) {
  return parseEditorForm(raw(overrides));
}

function errorFor(result: ReturnType<typeof parseEditorForm>, field: string): string | undefined {
  return result.ok ? undefined : result.errors.find((error) => error.field === field)?.message;
}

/* -------------------------------------------------------------------------- */
/* Precio                                                                     */
/* -------------------------------------------------------------------------- */

describe('precio', () => {
  it('(1) precio exacto valido', () => {
    const result = parse({ priceMode: 'exact', priceAmount: '125000', currencyCode: 'USD' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.priceMode).toBe('exact');
      expect(result.fields.priceAmountMinor).toBe(12_500_000);
      expect(result.fields.currencyCode).toBe('USD');
    }
  });

  it('(2) exact sin monto se rechaza', () => {
    const result = parse({ priceMode: 'exact', priceAmount: '', currencyCode: 'USD' });

    expect(result.ok).toBe(false);
    expect(errorFor(result, 'priceAmount')).toBe('Este modo de precio exige un importe.');
  });

  it('(3) exact sin moneda se rechaza', () => {
    const result = parse({ priceMode: 'exact', priceAmount: '125000', currencyCode: '' });

    expect(result.ok).toBe(false);
    expect(errorFor(result, 'currencyCode')).toBeDefined();
  });

  it('(4) negociable valido', () => {
    const result = parse({ priceMode: 'negotiable', priceAmount: '85000000', currencyCode: 'CRC' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.priceMode).toBe('negotiable');
      expect(result.fields.priceAmountMinor).toBe(8_500_000_000);
    }
  });

  it('(5) negociable incompleto se rechaza', () => {
    expect(parse({ priceMode: 'negotiable', priceAmount: '', currencyCode: 'CRC' }).ok).toBe(false);
    expect(parse({ priceMode: 'negotiable', priceAmount: '100', currencyCode: '' }).ok).toBe(false);
  });

  it('(6) consultar sin monto es valido', () => {
    const result = parse({ priceMode: 'contact', priceAmount: '', currencyCode: '' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.priceAmountMinor).toBeNull();
      expect(result.fields.currencyCode).toBeNull();
    }
  });

  it('(7) la conversion a unidades menores usa el helper, no float', () => {
    // 125000.10 * 100 en coma flotante da 12500009.999999998.
    const result = parse({ priceMode: 'exact', priceAmount: '125000.10', currencyCode: 'USD' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fields.priceAmountMinor).toBe(12_500_010);

    expect(read('src/lib/admin/ui/editor-form.ts')).toContain('parseAmountToMinor');

    // Importes donde la coma flotante se desviaria si se multiplicara por 100.
    for (const [amount, minor] of [
      ['0.29', 29],
      ['1.005', null],
      ['8.11', 811],
      ['1234567.89', 123456789],
    ] as const) {
      const parsed = parse({ priceMode: 'exact', priceAmount: amount, currencyCode: 'USD' });
      if (minor === null) {
        expect(parsed.ok).toBe(false);
      } else {
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.fields.priceAmountMinor).toBe(minor);
      }
    }
  });

  it('acepta coma como separador decimal', () => {
    const result = parse({ priceMode: 'exact', priceAmount: '125000,50', currencyCode: 'USD' });
    if (result.ok) expect(result.fields.priceAmountMinor).toBe(12_500_050);
  });

  it('(8) un importe con demasiados decimales se rechaza', () => {
    const result = parse({ priceMode: 'exact', priceAmount: '10.005', currencyCode: 'USD' });

    expect(result.ok).toBe(false);
    expect(errorFor(result, 'priceAmount')).toBe(
      'El importe tiene más decimales de los que admite la moneda.',
    );
  });

  it('un importe con letras se rechaza', () => {
    expect(parse({ priceMode: 'exact', priceAmount: 'mucho', currencyCode: 'USD' }).ok).toBe(false);
    expect(parse({ priceMode: 'exact', priceAmount: '-100', currencyCode: 'USD' }).ok).toBe(false);
  });

  it('(9)(10) admite USD y CRC', () => {
    for (const currency of ['USD', 'CRC']) {
      const result = parse({ priceMode: 'exact', priceAmount: '1000', currencyCode: currency });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.fields.currencyCode).toBe(currency);
    }
  });

  it('el formulario solo ofrece USD y CRC', () => {
    const page = read(EDITOR_PAGE);
    expect(page).toContain('SUPPORTED_CURRENCY_CODES');
    expect(page).not.toContain('EUR');
  });

  it('el selector de modo usa etiquetas humanas', () => {
    const page = read(EDITOR_PAGE);

    expect(page).toContain('Precio exacto');
    expect(page).toContain('Negociable');
    expect(page).toContain('Consultar');
    // Los identificadores internos no se muestran como texto.
    expect(page).not.toContain('>exact<');
    expect(page).not.toContain('>negotiable<');
    expect(page).not.toContain('>contact<');
  });

  it('(20) cambiar a Consultar no borra el importe escrito', () => {
    // El mismo formulario, solo cambia el modo: el importe sigue ahi.
    const result = parse({ priceMode: 'contact', priceAmount: '125000', currencyCode: 'USD' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fields.priceAmountMinor).toBe(12_500_000);
  });

  it('(20) la UI desactiva los campos en vez de vaciarlos', () => {
    const script = read(EDITOR_SCRIPT);

    expect(script).toContain('amountInput.disabled = !needsAmount');
    // No se limpia el valor al cambiar de modo.
    expect(script).not.toContain("amountInput.value = ''");
  });

  it('la vista previa reutiliza el formateador existente', () => {
    expect(pricePreview('125000', 'USD')).toBe(formatMoney(12_500_000, 'USD', 'es'));
    expect(pricePreview('', 'USD')).toBeNull();
    expect(pricePreview('125000', '')).toBeNull();
    expect(pricePreview('no-es-un-numero', 'USD')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Superficie                                                                 */
/* -------------------------------------------------------------------------- */

describe('superficie', () => {
  it('(11) superficie valida', () => {
    const result = parse({ areaSquareMeters: '5000' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fields.areaSquareMeters).toBe(5000);
  });

  it('admite decimales', () => {
    const result = parse({ areaSquareMeters: '1250.75' });
    if (result.ok) expect(result.fields.areaSquareMeters).toBe(1250.75);
  });

  it('(12) superficie vacia se guarda como null, no como 0', () => {
    const result = parse({ areaSquareMeters: '' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.areaSquareMeters).toBeNull();
      expect(result.fields.areaSquareMeters).not.toBe(0);
    }
  });

  it('(13) superficie invalida se rechaza', () => {
    expect(errorFor(parse({ areaSquareMeters: 'mucho' }), 'areaSquareMeters')).toBe(
      'La superficie no es válida.',
    );
    expect(errorFor(parse({ areaSquareMeters: '0' }), 'areaSquareMeters')).toBe(
      'La superficie debe ser mayor que cero.',
    );
    expect(parse({ areaSquareMeters: '-10' }).ok).toBe(false);
  });

  it('(14) la equivalencia reutiliza el helper de la Fase 2A', () => {
    expect(areaPreview('12500')).toBe(formatArea(12_500, { system: 'metric', locale: 'es' }).text);
    expect(areaPreview('12500')).toBe('1,25 ha');
    expect(areaPreview('850')).toBe('850 m²');
  });

  it('sin superficie no hay equivalencia', () => {
    expect(areaPreview('')).toBeNull();
    expect(areaPreview('0')).toBeNull();
    expect(areaPreview('abc')).toBeNull();
  });

  it('solo se guardan metros cuadrados', () => {
    const page = read(EDITOR_PAGE);

    expect(page).toContain('Superficie (m²)');
    expect(page).not.toContain('name="areaHectares"');
    expect(page).not.toContain('name="areaAcres"');
  });
});

/* -------------------------------------------------------------------------- */
/* Ubicacion                                                                  */
/* -------------------------------------------------------------------------- */

describe('ubicacion administrativa', () => {
  it('(15) guarda provincia, canton, distrito y localidad', () => {
    const result = parse({
      province: 'Puntarenas',
      canton: 'Garabito',
      district: 'Jacó',
      locality: 'Herradura',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.province).toBe('Puntarenas');
      expect(result.fields.canton).toBe('Garabito');
      expect(result.fields.district).toBe('Jacó');
      expect(result.fields.locality).toBe('Herradura');
    }
  });

  it('(16 bis) los campos vacios se guardan como null', () => {
    const result = parse({ province: '', canton: '   ' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.province).toBeNull();
      expect(result.fields.canton).toBeNull();
    }
  });

  it('recorta los espacios', () => {
    expect(parseOptionalText('  Jacó  ')).toBe('Jacó');
    expect(parseOptionalText('   ')).toBeNull();
  });

  it('son campos de texto libre, sin listas rigidas', () => {
    const page = read(EDITOR_PAGE);
    expect(page).toContain('id="field-province"');
    expect(page).not.toContain('PROVINCIAS');
  });
});

describe('coordenadas', () => {
  it('(16) coordenadas privadas completas', () => {
    const result = parse({ privateLatitude: '9.7489', privateLongitude: '-83.7534' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.privateLatitude).toBe(9.7489);
      expect(result.fields.privateLongitude).toBe(-83.7534);
    }
  });

  it('(17) privada solo con latitud se rechaza', () => {
    const result = parse({ privateLatitude: '9.7489' });

    expect(result.ok).toBe(false);
    expect(errorFor(result, 'privateLongitude')).toBe(
      'Indica latitud y longitud privadas, o ninguna de las dos.',
    );
  });

  it('(18) privada solo con longitud se rechaza', () => {
    const result = parse({ privateLongitude: '-83.7534' });

    expect(result.ok).toBe(false);
    expect(errorFor(result, 'privateLatitude')).toBeDefined();
  });

  it('(19) coordenadas publicas completas', () => {
    const result = parse({ publicLatitude: '9.75', publicLongitude: '-83.75' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.publicLatitude).toBe(9.75);
      expect(result.fields.publicLongitude).toBe(-83.75);
    }
  });

  it('(20)(21) publica incompleta se rechaza en ambos sentidos', () => {
    expect(parse({ publicLatitude: '9.75' }).ok).toBe(false);
    expect(parse({ publicLongitude: '-83.75' }).ok).toBe(false);
  });

  it('(22) latitud fuera de rango se rechaza', () => {
    for (const value of ['95', '-91']) {
      const result = parse({ publicLatitude: value, publicLongitude: '0' });
      expect(result.ok).toBe(false);
      expect(errorFor(result, 'publicLatitude')).toBe('La latitud debe estar entre -90 y 90.');
    }
  });

  it('(23) longitud fuera de rango se rechaza', () => {
    for (const value of ['200', '-181']) {
      const result = parse({ publicLatitude: '0', publicLongitude: value });
      expect(result.ok).toBe(false);
      expect(errorFor(result, 'publicLongitude')).toBe('La longitud debe estar entre -180 y 180.');
    }
  });

  it('acepta los limites exactos y el origen', () => {
    expect(parse({ publicLatitude: '90', publicLongitude: '180' }).ok).toBe(true);
    expect(parse({ publicLatitude: '-90', publicLongitude: '-180' }).ok).toBe(true);
    expect(parse({ publicLatitude: '0', publicLongitude: '0' }).ok).toBe(true);
  });

  it('una coordenada con letras se rechaza', () => {
    expect(parse({ publicLatitude: 'norte', publicLongitude: '0' }).ok).toBe(false);
  });

  it('(24)(25) la precision admite exacta y aproximada', () => {
    for (const precision of ['exact', 'approximate']) {
      const result = parse({ locationPrecision: precision });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.fields.locationPrecision).toBe(precision);
    }

    const page = read(EDITOR_PAGE);
    expect(page).toContain('Exacta');
    expect(page).toContain('Aproximada');
  });

  it('(26) las coordenadas privadas NUNCA se copian a las publicas', () => {
    const result = parse({ privateLatitude: '9.7489', privateLongitude: '-83.7534' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.publicLatitude).toBeNull();
      expect(result.fields.publicLongitude).toBeNull();
    }

    // Y tampoco hay ninguna asignacion de privadas a publicas en el script.
    const script = read(EDITOR_SCRIPT);
    expect(script).not.toContain('publicLatitude = privateLatitude');
    expect(script).not.toContain('publicLongitude = privateLongitude');
  });

  it('cambiar a aproximada no genera ni copia coordenadas', () => {
    const result = parse({
      locationPrecision: 'approximate',
      privateLatitude: '9.7489',
      privateLongitude: '-83.7534',
    });

    if (result.ok) {
      expect(result.fields.publicLatitude).toBeNull();
      expect(result.fields.publicLongitude).toBeNull();
    }
  });

  it('la pagina explica la privacidad y la nota de aproximada', () => {
    const page = read(EDITOR_PAGE);

    expect(page).toContain('Estas coordenadas son internas y nunca se usan como ubicación pública');
    expect(page).toContain(
      'Las coordenadas privadas son internas. El sitio público utiliza únicamente',
    );
    expect(page).toContain('Introduce manualmente la ubicación aproximada');
  });

  it('la nota de aproximada solo se muestra con esa precision', () => {
    expect(read(EDITOR_SCRIPT)).toContain(
      "precisionNote.hidden = inputValue('field-precision') !== 'approximate'",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Numeros vacios                                                             */
/* -------------------------------------------------------------------------- */

describe('campos numericos vacios', () => {
  it('nunca producen NaN, cadena vacia ni cero', () => {
    const result = parse();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const key of [
      'priceAmountMinor',
      'areaSquareMeters',
      'privateLatitude',
      'privateLongitude',
      'publicLatitude',
      'publicLongitude',
    ] as const) {
      expect(result.fields[key]).toBeNull();
      expect(result.fields[key]).not.toBeNaN();
    }
  });

  it('parseOptionalNumber distingue vacio de invalido', () => {
    expect(parseOptionalNumber('')).toEqual({ ok: true, value: null });
    expect(parseOptionalNumber('  ')).toEqual({ ok: true, value: null });
    expect(parseOptionalNumber('12.5')).toEqual({ ok: true, value: 12.5 });
    expect(parseOptionalNumber('-9,75')).toEqual({ ok: true, value: -9.75 });
    expect(parseOptionalNumber('abc').ok).toBe(false);
    expect(parseOptionalNumber('1e5').ok).toBe(false);
    expect(parseOptionalNumber('1.2.3').ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Guardado                                                                   */
/* -------------------------------------------------------------------------- */

describe('guardado con los campos nuevos', () => {
  const loaded: EditorFields = {
    code: 'LOBA-001',
    propertyTypeId: null,
    commercialStatus: 'available',
    isFeatured: false,
    showWhenSold: false,
    priceMode: 'contact',
    priceAmountMinor: null,
    currencyCode: null,
    areaSquareMeters: null,
    province: null,
    canton: null,
    district: null,
    locality: null,
    privateLatitude: null,
    privateLongitude: null,
    publicLatitude: null,
    publicLongitude: null,
    locationPrecision: 'approximate',
  };

  it('(27) el PATCH solo lleva los campos modificados', () => {
    const current = parse({ areaSquareMeters: '5000', province: 'Puntarenas' });
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    expect(buildPatch(loaded, current.fields)).toEqual({
      areaSquareMeters: 5000,
      province: 'Puntarenas',
    });
  });

  it('(27) incluye precio, coordenadas y precision cuando cambian', () => {
    const current = parse({
      priceMode: 'exact',
      priceAmount: '125000',
      currencyCode: 'USD',
      publicLatitude: '9.75',
      publicLongitude: '-83.75',
      locationPrecision: 'exact',
    });
    if (!current.ok) return;

    expect(buildPatch(loaded, current.fields)).toEqual({
      priceMode: 'exact',
      priceAmountMinor: 12_500_000,
      currencyCode: 'USD',
      publicLatitude: 9.75,
      publicLongitude: -83.75,
      locationPrecision: 'exact',
    });
  });

  it('sin cambios el PATCH queda vacio', () => {
    const current = parse();
    if (current.ok) expect(buildPatch(loaded, current.fields)).toEqual({});
  });

  it('(28) el estado sucio detecta cualquiera de los campos nuevos', () => {
    const cases: Partial<EditorFormRaw>[] = [
      { priceMode: 'exact', priceAmount: '100', currencyCode: 'USD' },
      { areaSquareMeters: '5000' },
      { province: 'Puntarenas' },
      { canton: 'Garabito' },
      { district: 'Jacó' },
      { locality: 'Herradura' },
      { privateLatitude: '9.74', privateLongitude: '-83.75' },
      { publicLatitude: '9.75', publicLongitude: '-83.75' },
      { locationPrecision: 'exact' },
    ];

    for (const overrides of cases) {
      const current = parse(overrides);
      expect(current.ok).toBe(true);
      if (current.ok) expect(isDirty(loaded, current.fields)).toBe(true);
    }
  });

  it('(19 bis) una validacion local fallida no envia el PATCH', () => {
    const script = read(EDITOR_SCRIPT);

    // El puerto expone la validacion, que el coordinador consulta antes de
    // escribir; ademas `persist` vuelve a cortar si algo no cuadra.
    expect(script).toContain('return parsed.ok ? [] : parsed.errors');
    expect(script).toContain('if (!parsed.ok) return { ok: false, errors: parsed.errors }');
  });

  it('(29) un fallo conserva los valores locales', () => {
    const script = read(EDITOR_SCRIPT);

    expect(script).not.toContain('location.reload()');

    /*
     * El formulario solo se reescribe al CARGAR. Guardar nunca lo repuebla,
     * asi que lo tecleado durante la peticion no se pierde ni al fallar ni al
     * ir bien.
     */
    expect(script.match(/writeRaw\(fieldsToRaw/g)).toHaveLength(1);
    expect(script.match(/writeTranslation\(locale, loadedTranslations/g)).toHaveLength(1);
  });

  it('(30) el aviso al salir depende del trabajo pendiente', () => {
    expect(read(EDITOR_SCRIPT)).toContain('coordinator?.snapshot().hasPendingWork');
  });

  it('un unico boton de guardar para todo el formulario', () => {
    const page = read(EDITOR_PAGE);
    expect(page.match(/type="submit"/g)).toHaveLength(1);
    expect(page).toContain('Guardar cambios');
  });
});

/* -------------------------------------------------------------------------- */
/* Ida y vuelta                                                               */
/* -------------------------------------------------------------------------- */

describe('modelo y formulario', () => {
  it('rellenar el formulario y volver a leerlo conserva los datos', () => {
    const original: EditorFields = {
      code: 'LOBA-007',
      propertyTypeId: 3,
      commercialStatus: 'reserved',
      isFeatured: true,
      showWhenSold: true,
      priceMode: 'exact',
      priceAmountMinor: 12_500_050,
      currencyCode: 'USD',
      areaSquareMeters: 5000,
      province: 'Puntarenas',
      canton: 'Garabito',
      district: 'Jacó',
      locality: 'Herradura',
      privateLatitude: 9.7489,
      privateLongitude: -83.7534,
      publicLatitude: 9.75,
      publicLongitude: -83.75,
      locationPrecision: 'exact',
    };

    const result = parseEditorForm(fieldsToRaw(original));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fields).toEqual(original);
  });

  it('el importe se devuelve al formulario en decimal humano', () => {
    const rawForm = fieldsToRaw({
      ...toEditorFields({
        id: 1,
        code: 'LOBA-001',
        propertyTypeId: null,
        commercialStatus: 'available',
        isFeatured: false,
        showWhenSold: false,
        priceMode: 'exact',
        priceAmountMinor: 12_500_050,
        currencyCode: 'USD',
        areaSquareMeters: null,
        province: null,
        canton: null,
        district: null,
        locality: null,
        privateLatitude: null,
        privateLongitude: null,
        publicLatitude: null,
        publicLongitude: null,
        locationPrecision: 'approximate',
      }),
    });

    expect(rawForm.priceAmount).toBe('125000.50');
  });
});
