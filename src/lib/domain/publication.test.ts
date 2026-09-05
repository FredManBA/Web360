import { describe, expect, it } from 'vitest';

import type { MediaLike } from './consistency';
import { validatePropertyForPublication } from './publication';
import type { PropertyForPublication } from './publication';

/** Propiedad minima pero COMPLETA: el caso valido de referencia. */
function publishableProperty(
  overrides: Partial<PropertyForPublication> = {},
): PropertyForPublication {
  const media: MediaLike[] = [
    { id: 10, propertyId: 1, mediaKind: 'image', isHero: true, isCatalogCover: true },
  ];

  return {
    id: 1,
    code: 'LOBA-001',
    propertyTypeId: 3,
    publicationStatus: 'approved',
    priceMode: 'exact',
    priceAmountMinor: 12_500_000,
    currencyCode: 'USD',
    areaSquareMeters: 5000,
    publicLatitude: 9.75,
    publicLongitude: -83.75,
    locationPrecision: 'approximate',
    translations: [{ locale: 'es', slug: 'lote-vista-al-mar', title: 'Lote con vista al mar' }],
    media,
    ...overrides,
  };
}

function codes(property: PropertyForPublication): string[] {
  return validatePropertyForPublication(property).issues.map((issue) => issue.code);
}

describe('validatePropertyForPublication', () => {
  it('acepta una propiedad simple y completa', () => {
    const result = validatePropertyForPublication(publishableProperty());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('NO exige ingles', () => {
    const result = validatePropertyForPublication(publishableProperty());
    expect(result.valid).toBe(true);
    expect(codes(publishableProperty())).not.toContain('translation_en_missing');
  });

  it('NO exige video, 360, documentos ni caracteristicas', () => {
    // La propiedad de referencia no tiene nada de eso y es valida.
    expect(validatePropertyForPublication(publishableProperty()).valid).toBe(true);
  });

  it('exige codigo', () => {
    expect(codes(publishableProperty({ code: '   ' }))).toContain('code_missing');
  });

  it('exige tipo de propiedad', () => {
    expect(codes(publishableProperty({ propertyTypeId: null }))).toContain('property_type_missing');
  });

  it('exige traduccion espanola', () => {
    expect(codes(publishableProperty({ translations: [] }))).toContain('translation_es_missing');
  });

  it('exige titulo espanol no vacio', () => {
    const withBlankTitle = publishableProperty({
      translations: [{ locale: 'es', slug: 'lote', title: '   ' }],
    });
    expect(codes(withBlankTitle)).toContain('title_es_missing');
  });

  it('exige slug espanol y valido', () => {
    expect(
      codes(publishableProperty({ translations: [{ locale: 'es', slug: null, title: 'Lote' }] })),
    ).toContain('slug_es_missing');

    expect(
      codes(
        publishableProperty({ translations: [{ locale: 'es', slug: 'Mal Slug', title: 'Lote' }] }),
      ),
    ).toContain('slug_es_invalid');
  });

  it('una propiedad solo en ingles no es publicable', () => {
    const onlyEnglish = publishableProperty({
      translations: [{ locale: 'en', slug: 'sea-view-lot', title: 'Sea view lot' }],
    });
    expect(codes(onlyEnglish)).toContain('translation_es_missing');
  });

  it('exige superficie valida', () => {
    expect(codes(publishableProperty({ areaSquareMeters: null }))).toContain('area_missing');
    expect(codes(publishableProperty({ areaSquareMeters: 0 }))).toContain('area_invalid');
  });

  it('exige coordenada publica', () => {
    const noCoords = publishableProperty({ publicLatitude: null, publicLongitude: null });
    expect(codes(noCoords)).toContain('coordinates_missing');
  });

  it('exige coordenada publica tambien con precision aproximada', () => {
    const noCoords = publishableProperty({
      publicLatitude: null,
      publicLongitude: null,
      locationPrecision: 'approximate',
    });
    expect(codes(noCoords)).toContain('coordinates_missing');
  });

  it('exige precio coherente', () => {
    const exactWithoutAmount = publishableProperty({ priceMode: 'exact', priceAmountMinor: null });
    expect(codes(exactWithoutAmount)).toContain('amount_required');
  });

  it('acepta priceMode contact sin importe', () => {
    const contact = publishableProperty({
      priceMode: 'contact',
      priceAmountMinor: null,
      currencyCode: null,
    });
    expect(validatePropertyForPublication(contact).valid).toBe(true);
  });

  it('exige al menos una imagen publica', () => {
    const noImages = publishableProperty({
      media: [{ id: 10, propertyId: 1, mediaKind: 'video', isHero: true, isCatalogCover: false }],
    });
    expect(codes(noImages)).toContain('image_missing');
  });

  it('exige hero y portada', () => {
    const noRoles = publishableProperty({
      media: [{ id: 10, propertyId: 1, mediaKind: 'image', isHero: false, isCatalogCover: false }],
    });
    expect(codes(noRoles)).toEqual(
      expect.arrayContaining(['hero_not_found', 'catalog_cover_not_found']),
    );
  });

  it('exige estado apropiado para publicar', () => {
    for (const status of ['draft', 'in_review', 'archived'] as const) {
      expect(codes(publishableProperty({ publicationStatus: status }))).toContain(
        'status_not_publishable',
      );
    }
  });

  it('acepta revalidar una propiedad ya publicada', () => {
    expect(
      validatePropertyForPublication(publishableProperty({ publicationStatus: 'published' })).valid,
    ).toBe(true);
  });

  it('un tour incompleto invalida la publicacion', () => {
    const withBrokenTour = publishableProperty({
      media: [
        { id: 10, propertyId: 1, mediaKind: 'image', isHero: true, isCatalogCover: true },
        { id: 11, propertyId: 1, mediaKind: 'panorama', isHero: false, isCatalogCover: false },
      ],
      tourNodes: [{ id: 1, propertyId: 1, propertyMediaId: 11, isStart: false }],
    });
    expect(codes(withBrokenTour)).toContain('tour_has_no_start_node');
  });

  it('un tour correcto no estorba', () => {
    const withTour = publishableProperty({
      media: [
        { id: 10, propertyId: 1, mediaKind: 'image', isHero: true, isCatalogCover: true },
        { id: 11, propertyId: 1, mediaKind: 'panorama', isHero: false, isCatalogCover: false },
      ],
      tourNodes: [{ id: 1, propertyId: 1, propertyMediaId: 11, isStart: true }],
    });
    expect(validatePropertyForPublication(withTour).valid).toBe(true);
  });

  it('cada problema indica su seccion', () => {
    const broken = publishableProperty({
      code: '',
      areaSquareMeters: null,
      publicLatitude: null,
      publicLongitude: null,
    });
    const sections = validatePropertyForPublication(broken).issues.map((i) => i.section);
    expect(sections).toEqual(expect.arrayContaining(['identity', 'area', 'location']));
  });

  it('acumula todos los problemas, no solo el primero', () => {
    const empty: PropertyForPublication = {
      id: 1,
      code: '',
      propertyTypeId: null,
      publicationStatus: 'draft',
      priceMode: 'exact',
      priceAmountMinor: null,
      currencyCode: null,
      areaSquareMeters: null,
      publicLatitude: null,
      publicLongitude: null,
      locationPrecision: 'approximate',
      translations: [],
      media: [],
    };

    const result = validatePropertyForPublication(empty);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(8);
  });

  it('es una funcion pura: no modifica la entrada', () => {
    const property = publishableProperty();
    const snapshot = JSON.stringify(property);
    validatePropertyForPublication(property);
    expect(JSON.stringify(property)).toBe(snapshot);
  });
});
