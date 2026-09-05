import { describe, expect, it } from 'vitest';

import { getPublicCoordinates, validatePublicLocation } from './location';

describe('getPublicCoordinates', () => {
  it('devuelve la coordenada publica cuando existe', () => {
    expect(getPublicCoordinates({ publicLatitude: 9.75, publicLongitude: -83.75 })).toEqual({
      latitude: 9.75,
      longitude: -83.75,
    });
  });

  it('devuelve null si falta alguna de las dos', () => {
    expect(getPublicCoordinates({ publicLatitude: 9.75, publicLongitude: null })).toBeNull();
    expect(getPublicCoordinates({ publicLatitude: null, publicLongitude: -83.75 })).toBeNull();
    expect(getPublicCoordinates({ publicLatitude: null, publicLongitude: null })).toBeNull();
  });

  it('devuelve null si estan fuera de rango', () => {
    expect(getPublicCoordinates({ publicLatitude: 95, publicLongitude: 0 })).toBeNull();
    expect(getPublicCoordinates({ publicLatitude: 0, publicLongitude: -200 })).toBeNull();
  });

  it('NUNCA usa las coordenadas privadas como respaldo', () => {
    // Se pasan tambien las privadas para simular la fila completa: el
    // resultado debe seguir siendo null.
    const row = {
      publicLatitude: null,
      publicLongitude: null,
      privateLatitude: 9.7489,
      privateLongitude: -83.7534,
    };

    expect(getPublicCoordinates(row)).toBeNull();
  });

  it('el resultado contiene solo latitude y longitude', () => {
    const row = {
      publicLatitude: 9.75,
      publicLongitude: -83.75,
      privateLatitude: 9.7489,
      privateLongitude: -83.7534,
    };

    const result = getPublicCoordinates(row);
    expect(result).not.toBeNull();
    expect(Object.keys(result ?? {}).sort()).toEqual(['latitude', 'longitude']);
    expect(JSON.stringify(result)).not.toContain('9.7489');
  });

  it('acepta el origen de coordenadas', () => {
    expect(getPublicCoordinates({ publicLatitude: 0, publicLongitude: 0 })).toEqual({
      latitude: 0,
      longitude: 0,
    });
  });
});

describe('validatePublicLocation', () => {
  it('exact necesita coordenada publica', () => {
    expect(
      validatePublicLocation({
        publicLatitude: null,
        publicLongitude: null,
        locationPrecision: 'exact',
      }),
    ).toEqual(['coordinates_missing']);
  });

  it('approximate TAMBIEN necesita coordenada publica', () => {
    expect(
      validatePublicLocation({
        publicLatitude: null,
        publicLongitude: null,
        locationPrecision: 'approximate',
      }),
    ).toEqual(['coordinates_missing']);
  });

  it('acepta coordenadas validas en ambas precisiones', () => {
    for (const precision of ['exact', 'approximate'] as const) {
      expect(
        validatePublicLocation({
          publicLatitude: 9.75,
          publicLongitude: -83.75,
          locationPrecision: precision,
        }),
      ).toEqual([]);
    }
  });

  it('detecta coordenadas fuera de rango', () => {
    expect(
      validatePublicLocation({
        publicLatitude: 91,
        publicLongitude: 0,
        locationPrecision: 'exact',
      }),
    ).toEqual(['coordinates_out_of_range']);
  });
});
