import { describe, expect, it } from 'vitest';

import { propertyDraftSchema, propertyDraftWithCoordinatePairs } from './property';
import { propertyTranslationDraftSchema } from './property';

describe('propertyDraftSchema (permisivo)', () => {
  it('acepta un borrador con solo el codigo', () => {
    const result = propertyDraftSchema.safeParse({ code: 'LOBA-001' });
    expect(result.success).toBe(true);
  });

  it('aplica los mismos defaults que el esquema SQL', () => {
    const parsed = propertyDraftSchema.parse({ code: 'LOBA-001' });
    expect(parsed.publicationStatus).toBe('draft');
    expect(parsed.commercialStatus).toBe('available');
    expect(parsed.priceMode).toBe('contact');
    expect(parsed.locationPrecision).toBe('approximate');
    expect(parsed.isFeatured).toBe(false);
    expect(parsed.showWhenSold).toBe(false);
  });

  it('normaliza a null los textos vacios del formulario', () => {
    const parsed = propertyDraftSchema.parse({ code: 'LOBA-001', province: '', canton: '   ' });
    expect(parsed.province).toBeNull();
    expect(parsed.canton).toBeNull();
  });

  it('recorta los espacios de los textos', () => {
    expect(propertyDraftSchema.parse({ code: 'LOBA-001', locality: '  Jaco  ' }).locality).toBe(
      'Jaco',
    );
  });

  it('exige codigo no vacio', () => {
    expect(propertyDraftSchema.safeParse({ code: '' }).success).toBe(false);
    expect(propertyDraftSchema.safeParse({ code: '   ' }).success).toBe(false);
    expect(propertyDraftSchema.safeParse({}).success).toBe(false);
  });

  it('NO exige precio, superficie ni ubicacion en borrador', () => {
    const parsed = propertyDraftSchema.parse({ code: 'LOBA-001' });
    expect(parsed.priceAmountMinor).toBeNull();
    expect(parsed.areaSquareMeters).toBeNull();
    expect(parsed.publicLatitude).toBeNull();
  });

  it('valida rangos cuando el dato SI viene', () => {
    expect(
      propertyDraftSchema.safeParse({ code: 'X', publicLatitude: 95, publicLongitude: 0 }).success,
    ).toBe(false);
    expect(
      propertyDraftSchema.safeParse({ code: 'X', publicLatitude: 9.75, publicLongitude: -83.75 })
        .success,
    ).toBe(true);
  });

  it('rechaza superficie no positiva y precio negativo', () => {
    expect(propertyDraftSchema.safeParse({ code: 'X', areaSquareMeters: 0 }).success).toBe(false);
    expect(propertyDraftSchema.safeParse({ code: 'X', priceAmountMinor: -1 }).success).toBe(false);
  });

  it('rechaza vocabularios invalidos', () => {
    expect(
      propertyDraftSchema.safeParse({ code: 'X', publicationStatus: 'publicada' }).success,
    ).toBe(false);
    expect(propertyDraftSchema.safeParse({ code: 'X', priceMode: 'gratis' }).success).toBe(false);
  });

  it('limita la moneda a las admitidas por el panel', () => {
    expect(propertyDraftSchema.safeParse({ code: 'X', currencyCode: 'USD' }).success).toBe(true);
    expect(propertyDraftSchema.safeParse({ code: 'X', currencyCode: 'CRC' }).success).toBe(true);
    expect(propertyDraftSchema.safeParse({ code: 'X', currencyCode: 'EUR' }).success).toBe(false);
  });
});

describe('propertyDraftWithCoordinatePairs', () => {
  it('acepta las dos coordenadas o ninguna', () => {
    expect(propertyDraftWithCoordinatePairs.safeParse({ code: 'X' }).success).toBe(true);
    expect(
      propertyDraftWithCoordinatePairs.safeParse({
        code: 'X',
        publicLatitude: 9.75,
        publicLongitude: -83.75,
      }).success,
    ).toBe(true);
  });

  it('rechaza media coordenada', () => {
    expect(
      propertyDraftWithCoordinatePairs.safeParse({ code: 'X', publicLatitude: 9.75 }).success,
    ).toBe(false);
    expect(
      propertyDraftWithCoordinatePairs.safeParse({ code: 'X', privateLongitude: -83.75 }).success,
    ).toBe(false);
  });
});

describe('propertyTranslationDraftSchema', () => {
  it('acepta una traduccion completamente vacia salvo el locale', () => {
    const parsed = propertyTranslationDraftSchema.parse({ locale: 'es' });
    expect(parsed.title).toBeNull();
    expect(parsed.slug).toBeNull();
  });

  it('valida el formato del slug cuando viene', () => {
    expect(
      propertyTranslationDraftSchema.safeParse({ locale: 'es', slug: 'lote-vista-al-mar' }).success,
    ).toBe(true);
    expect(
      propertyTranslationDraftSchema.safeParse({ locale: 'es', slug: 'Mal Slug' }).success,
    ).toBe(false);
  });

  it('rechaza locales fuera de ES/EN', () => {
    expect(propertyTranslationDraftSchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });
});
