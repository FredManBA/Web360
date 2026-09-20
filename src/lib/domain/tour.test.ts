import { describe, expect, it } from 'vitest';
import type { Tour } from './content';
import { addTourNode, removeTourNode, upsertTourLink } from './tour';

const tour: Tour = {
  startMediaId: 1,
  nodes: [
    {
      mediaId: 1,
      name_es: 'Entrada',
      name_en: null,
      initialView: null,
      links: [{ toMediaId: 2, yaw: 1.4, pitch: -0.1 }],
    },
    {
      mediaId: 2,
      name_es: 'Sala',
      name_en: null,
      initialView: null,
      links: [{ toMediaId: 1, yaw: -1.2, pitch: 0 }],
    },
  ],
};

describe('recorrido 360', () => {
  it('al quitar un punto se caen sus enlaces y el inicio pasa al que queda', () => {
    const next = removeTourNode(tour, 1);

    expect(next?.nodes.map((n) => n.mediaId)).toEqual([2]);
    expect(next?.nodes[0]?.links).toEqual([]);
    expect(next?.startMediaId).toBe(2);
  });

  it('un recorrido sin puntos deja de existir', () => {
    expect(removeTourNode(removeTourNode(tour, 1), 2)).toBeNull();
    expect(removeTourNode(null, 1)).toBeNull();
  });

  it('volver a colocar un destino mueve el enlace en vez de duplicarlo', () => {
    const next = upsertTourLink(tour, 1, 2, 0.5, 0.25);

    expect(next.nodes[0]?.links).toEqual([{ toMediaId: 2, yaw: 0.5, pitch: 0.25 }]);
  });

  it('no se enlaza consigo mismo ni con un punto que no existe', () => {
    expect(upsertTourLink(tour, 1, 1, 0.5, 0)).toBe(tour);
    expect(upsertTourLink(tour, 1, 9, 0.5, 0)).toBe(tour);
  });

  it('el primer panorama añadido queda como punto inicial', () => {
    expect(addTourNode(null, 7)).toEqual({
      startMediaId: 7,
      nodes: [{ mediaId: 7, name_es: null, name_en: null, initialView: null, links: [] }],
    });
    expect(addTourNode(tour, 1)).toBe(tour);
  });
});
