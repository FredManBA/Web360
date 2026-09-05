import { describe, expect, it } from 'vitest';

import {
  validateFeatureGroup,
  validateMediaGroup,
  validateMediaRoles,
  validateTourForPublication,
  validateTourLink,
  validateTourNode,
} from './consistency';
import type { MediaLike, TourNodeLike } from './consistency';

function media(overrides: Partial<MediaLike> & Pick<MediaLike, 'id' | 'propertyId'>): MediaLike {
  return {
    mediaKind: 'image',
    isHero: false,
    isCatalogCover: false,
    ...overrides,
  };
}

function node(
  overrides: Partial<TourNodeLike> & Pick<TourNodeLike, 'id' | 'propertyId' | 'propertyMediaId'>,
): TourNodeLike {
  return { isStart: false, ...overrides };
}

describe('validateFeatureGroup', () => {
  it('sin grupo siempre es valido', () => {
    expect(validateFeatureGroup({ propertyId: 1, groupId: null }, null)).toEqual([]);
  });

  it('acepta un grupo de la misma propiedad', () => {
    expect(validateFeatureGroup({ propertyId: 1, groupId: 9 }, { propertyId: 1 })).toEqual([]);
  });

  it('rechaza un grupo de otra propiedad', () => {
    expect(validateFeatureGroup({ propertyId: 1, groupId: 9 }, { propertyId: 2 })).toEqual([
      'group_belongs_to_other_property',
    ]);
  });

  it('rechaza un groupId que no corresponde a ningun grupo', () => {
    expect(validateFeatureGroup({ propertyId: 1, groupId: 9 }, null)).toEqual([
      'group_belongs_to_other_property',
    ]);
  });
});

describe('validateMediaGroup', () => {
  it('aplica la misma regla que las caracteristicas', () => {
    expect(validateMediaGroup({ propertyId: 5, groupId: null }, null)).toEqual([]);
    expect(validateMediaGroup({ propertyId: 5, groupId: 7 }, { propertyId: 5 })).toEqual([]);
    expect(validateMediaGroup({ propertyId: 5, groupId: 7 }, { propertyId: 6 })).toEqual([
      'group_belongs_to_other_property',
    ]);
  });
});

describe('validateTourNode', () => {
  it('acepta un panorama de la misma propiedad', () => {
    expect(
      validateTourNode(
        node({ id: 1, propertyId: 1, propertyMediaId: 10 }),
        media({ id: 10, propertyId: 1, mediaKind: 'panorama' }),
      ),
    ).toEqual([]);
  });

  it('rechaza un archivo de otra propiedad', () => {
    expect(
      validateTourNode(
        node({ id: 1, propertyId: 1, propertyMediaId: 10 }),
        media({ id: 10, propertyId: 2, mediaKind: 'panorama' }),
      ),
    ).toContain('media_belongs_to_other_property');
  });

  it('rechaza un archivo que no es panorama', () => {
    expect(
      validateTourNode(
        node({ id: 1, propertyId: 1, propertyMediaId: 10 }),
        media({ id: 10, propertyId: 1, mediaKind: 'image' }),
      ),
    ).toContain('media_is_not_panorama');
  });

  it('acumula los dos problemas cuando ambos se dan', () => {
    expect(
      validateTourNode(
        node({ id: 1, propertyId: 1, propertyMediaId: 10 }),
        media({ id: 10, propertyId: 2, mediaKind: 'video' }),
      ),
    ).toEqual(['media_belongs_to_other_property', 'media_is_not_panorama']);
  });
});

describe('validateTourLink', () => {
  const nodes = [
    node({ id: 1, propertyId: 1, propertyMediaId: 10 }),
    node({ id: 2, propertyId: 1, propertyMediaId: 11 }),
    node({ id: 3, propertyId: 99, propertyMediaId: 12 }),
  ];

  it('acepta un enlace entre nodos de la misma propiedad', () => {
    expect(validateTourLink({ fromNodeId: 1, toNodeId: 2 }, nodes)).toEqual([]);
  });

  it('rechaza un enlace que cruza propiedades', () => {
    expect(validateTourLink({ fromNodeId: 1, toNodeId: 3 }, nodes)).toEqual([
      'link_crosses_properties',
    ]);
  });

  it('rechaza un enlace a un nodo inexistente', () => {
    expect(validateTourLink({ fromNodeId: 1, toNodeId: 404 }, nodes)).toEqual([
      'link_node_not_found',
    ]);
  });
});

describe('validateTourForPublication', () => {
  const panoramas = new Map<number, MediaLike>([
    [10, media({ id: 10, propertyId: 1, mediaKind: 'panorama' })],
    [11, media({ id: 11, propertyId: 1, mediaKind: 'panorama' })],
    [12, media({ id: 12, propertyId: 1, mediaKind: 'image' })],
  ]);

  it('una propiedad SIN tour es valida', () => {
    expect(validateTourForPublication([], panoramas)).toEqual([]);
  });

  it('acepta un tour con exactamente un nodo inicial', () => {
    const nodes = [
      node({ id: 1, propertyId: 1, propertyMediaId: 10, isStart: true }),
      node({ id: 2, propertyId: 1, propertyMediaId: 11 }),
    ];
    expect(validateTourForPublication(nodes, panoramas)).toEqual([]);
  });

  it('rechaza un tour sin nodo inicial', () => {
    const nodes = [node({ id: 1, propertyId: 1, propertyMediaId: 10 })];
    expect(validateTourForPublication(nodes, panoramas)).toContain('tour_has_no_start_node');
  });

  it('rechaza un tour con varios nodos iniciales', () => {
    const nodes = [
      node({ id: 1, propertyId: 1, propertyMediaId: 10, isStart: true }),
      node({ id: 2, propertyId: 1, propertyMediaId: 11, isStart: true }),
    ];
    expect(validateTourForPublication(nodes, panoramas)).toContain('tour_has_multiple_start_nodes');
  });

  it('rechaza un nodo que no apunta a un panorama', () => {
    const nodes = [node({ id: 1, propertyId: 1, propertyMediaId: 12, isStart: true })];
    expect(validateTourForPublication(nodes, panoramas)).toContain('media_is_not_panorama');
  });

  it('no repite el mismo problema por cada nodo', () => {
    const nodes = [
      node({ id: 1, propertyId: 1, propertyMediaId: 12, isStart: true }),
      node({ id: 2, propertyId: 1, propertyMediaId: 12 }),
    ];
    const problems = validateTourForPublication(nodes, panoramas);
    expect(problems.filter((p) => p === 'media_is_not_panorama')).toHaveLength(1);
  });
});

describe('validateMediaRoles', () => {
  it('acepta hero imagen y portada imagen', () => {
    const items = [
      media({ id: 1, propertyId: 1, isHero: true }),
      media({ id: 2, propertyId: 1, isCatalogCover: true }),
    ];
    expect(validateMediaRoles(1, items)).toEqual([]);
  });

  it('acepta hero video', () => {
    const items = [
      media({ id: 1, propertyId: 1, mediaKind: 'video', isHero: true }),
      media({ id: 2, propertyId: 1, isCatalogCover: true }),
    ];
    expect(validateMediaRoles(1, items)).toEqual([]);
  });

  it('permite que la MISMA imagen sea hero y portada', () => {
    const items = [media({ id: 1, propertyId: 1, isHero: true, isCatalogCover: true })];
    expect(validateMediaRoles(1, items)).toEqual([]);
  });

  it('detecta la falta de hero y de portada', () => {
    expect(validateMediaRoles(1, [media({ id: 1, propertyId: 1 })])).toEqual(
      expect.arrayContaining(['hero_not_found', 'catalog_cover_not_found']),
    );
  });

  it('rechaza portada que no sea imagen', () => {
    const items = [
      media({ id: 1, propertyId: 1, isHero: true }),
      media({ id: 2, propertyId: 1, mediaKind: 'video', isCatalogCover: true }),
    ];
    expect(validateMediaRoles(1, items)).toContain('catalog_cover_invalid_kind');
  });

  it('rechaza hero documento o panorama', () => {
    for (const kind of ['document', 'panorama'] as const) {
      const items = [
        media({ id: 1, propertyId: 1, mediaKind: kind, isHero: true }),
        media({ id: 2, propertyId: 1, isCatalogCover: true }),
      ];
      expect(validateMediaRoles(1, items)).toContain('hero_invalid_kind');
    }
  });

  it('detecta un hero de otra propiedad', () => {
    const items = [
      media({ id: 1, propertyId: 2, isHero: true }),
      media({ id: 2, propertyId: 1, isCatalogCover: true }),
    ];
    expect(validateMediaRoles(1, items)).toContain('hero_belongs_to_other_property');
  });
});
