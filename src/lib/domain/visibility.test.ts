import { describe, expect, it } from 'vitest';

import { isPubliclyVisible } from './visibility';
import { COMMERCIAL_STATUSES, PUBLICATION_STATUSES } from './vocabularies';

describe('isPubliclyVisible', () => {
  it('solo `published` puede ser publico', () => {
    for (const status of PUBLICATION_STATUSES) {
      const visible = isPubliclyVisible({
        publicationStatus: status,
        commercialStatus: 'available',
        showWhenSold: false,
      });
      expect(visible).toBe(status === 'published');
    }
  });

  it('vendida con showWhenSold=false queda oculta', () => {
    expect(
      isPubliclyVisible({
        publicationStatus: 'published',
        commercialStatus: 'sold',
        showWhenSold: false,
      }),
    ).toBe(false);
  });

  it('vendida con showWhenSold=true sigue visible', () => {
    expect(
      isPubliclyVisible({
        publicationStatus: 'published',
        commercialStatus: 'sold',
        showWhenSold: true,
      }),
    ).toBe(true);
  });

  it('offer_received y reserved siguen visibles', () => {
    for (const commercial of ['offer_received', 'reserved'] as const) {
      expect(
        isPubliclyVisible({
          publicationStatus: 'published',
          commercialStatus: commercial,
          showWhenSold: false,
        }),
      ).toBe(true);
    }
  });

  it('showWhenSold no publica una propiedad no publicada', () => {
    for (const status of PUBLICATION_STATUSES) {
      if (status === 'published') continue;
      expect(
        isPubliclyVisible({
          publicationStatus: status,
          commercialStatus: 'sold',
          showWhenSold: true,
        }),
      ).toBe(false);
    }
  });

  it('publicada y no vendida es visible en cualquier estado comercial', () => {
    for (const commercial of COMMERCIAL_STATUSES) {
      if (commercial === 'sold') continue;
      expect(
        isPubliclyVisible({
          publicationStatus: 'published',
          commercialStatus: commercial,
          showWhenSold: false,
        }),
      ).toBe(true);
    }
  });
});
