/**
 * La marca publica por defecto.
 *
 * `site_settings.business_name` manda cuando existe; esto es lo que se ve
 * cuando no hay nada configurado, que es el estado de un sitio recien
 * desplegado. Vive en un test propio porque es identidad, no copia suelta:
 * cambiarla por descuido renombra el sitio entero.
 */

import { describe, expect, it } from 'vitest';

import { labelsFor } from './labels';
import { LOCALES } from './home';

describe('la marca por defecto', () => {
  it('es "Costa Rica 360" en los dos idiomas', () => {
    expect(labelsFor('es').brandName).toBe('Costa Rica 360');
    expect(labelsFor('en').brandName).toBe('Costa Rica 360');
  });

  it('ningun idioma se quedo con el nombre anterior', () => {
    for (const locale of LOCALES) {
      expect(labelsFor(locale).brandName).not.toContain('Loba');
    }
  });
});
