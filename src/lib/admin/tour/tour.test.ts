/**
 * Tests del recorrido 360.
 *
 * Contra SQLite real con las migraciones del proyecto: el indice parcial del
 * nodo inicial, el UNIQUE de un panorama por nodo, el CHECK del autoenlace, el
 * UNIQUE de origen/destino y las cascadas son los de produccion.
 */

import type { DatabaseSync } from 'node:sqlite';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { propertyTourLinks, propertyTourNodeTranslations } from '../../../db/schema';
import { createMedia, deleteMedia } from '../media/media';
import { createPropertyDraft } from '../properties/create-property';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase, AdminResult } from '../types';
import { getPropertyTour } from './get-tour';
import { createTourLink, deleteTourLink, updateTourLink } from './links';
import { createTourNode, deleteTourNode, setStartNode, updateTourNode } from './nodes';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `tour/archivo-${keyCounter}.jpg`;
}

async function newProperty(): Promise<number> {
  const created = await createPropertyDraft(db);
  if (!created.ok) throw new Error('setup: propiedad');
  return created.data.id;
}

async function newPanorama(propertyId: number): Promise<number> {
  const created = await createMedia(db, propertyId, {
    mediaKind: 'panorama',
    sourceProvider: 'r2',
    objectKey: nextKey(),
  });
  if (!created.ok) throw new Error('setup: panorama');
  return created.data.id;
}

async function newImage(propertyId: number): Promise<number> {
  const created = await createMedia(db, propertyId, {
    mediaKind: 'image',
    sourceProvider: 'r2',
    objectKey: nextKey(),
  });
  if (!created.ok) throw new Error('setup: imagen');
  return created.data.id;
}

async function newNode(propertyId: number, nameEs?: string): Promise<number> {
  const created = await createTourNode(db, propertyId, {
    propertyMediaId: await newPanorama(propertyId),
    ...(nameEs === undefined ? {} : { nameEs }),
  });
  if (!created.ok) throw new Error('setup: nodo');
  return created.data.id;
}

function errorOf(result: AdminResult<unknown>): { code: string; message: string } {
  if (result.ok) throw new Error('se esperaba un error');
  return result.error;
}

async function tour(propertyId: number) {
  const result = await getPropertyTour(db, propertyId);
  if (!result.ok) throw new Error('lectura');
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Lectura                                                                    */
/* -------------------------------------------------------------------------- */

describe('lectura del recorrido', () => {
  it('una propiedad inexistente devuelve error, no una lista vacia', async () => {
    const result = await getPropertyTour(db, 9999);

    expect(errorOf(result).code).toBe('not_found');
  });

  it('una propiedad sin recorrido devuelve la estructura vacia', async () => {
    const propertyId = await newProperty();

    expect(await tour(propertyId)).toEqual({ propertyId, nodes: [], startNodeId: null });
  });

  it('cada nodo llega con su panorama, sus nombres y sus enlaces', async () => {
    const propertyId = await newProperty();

    const first = await createTourNode(db, propertyId, {
      propertyMediaId: await newPanorama(propertyId),
      nameEs: 'Entrada',
      nameEn: 'Entrance',
      initialFov: 75,
    });
    if (!first.ok) throw new Error('setup');

    const second = await newNode(propertyId, 'Mirador');
    await createTourLink(db, propertyId, { fromNodeId: first.data.id, toNodeId: second, yaw: 1.2 });

    const data = await tour(propertyId);
    const node = data.nodes[0];

    expect(node?.panorama?.id).toBe(first.data.propertyMediaId);
    expect(node?.panorama?.mediaKind).toBe('panorama');
    expect(node?.names).toEqual({ es: 'Entrada', en: 'Entrance' });
    expect(node?.initialFov).toBe(75);
    expect(node?.links.map((link) => link.toNodeId)).toEqual([second]);
    expect(node?.links[0]?.yaw).toBe(1.2);
  });

  it('ordena nodos por sortOrder y desempata por id', async () => {
    const propertyId = await newProperty();

    const a = await createTourNode(db, propertyId, {
      propertyMediaId: await newPanorama(propertyId),
      sortOrder: 5,
    });
    const b = await createTourNode(db, propertyId, {
      propertyMediaId: await newPanorama(propertyId),
      sortOrder: 1,
    });
    // Misma posicion que el anterior: manda el id mas bajo.
    const c = await createTourNode(db, propertyId, {
      propertyMediaId: await newPanorama(propertyId),
      sortOrder: 1,
    });

    if (!a.ok || !b.ok || !c.ok) throw new Error('setup');

    expect((await tour(propertyId)).nodes.map((node) => node.id)).toEqual([
      b.data.id,
      c.data.id,
      a.data.id,
    ]);
  });

  it('ordena los enlaces salientes de cada nodo', async () => {
    const propertyId = await newProperty();
    const from = await newNode(propertyId);
    const first = await newNode(propertyId);
    const second = await newNode(propertyId);

    await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: first, sortOrder: 3 });
    await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: second, sortOrder: 0 });

    const node = (await tour(propertyId)).nodes.find((item) => item.id === from);
    expect(node?.links.map((link) => link.toNodeId)).toEqual([second, first]);
  });

  it('el recorrido de una propiedad no arrastra nodos ni enlaces de otra', async () => {
    const first = await newProperty();
    const second = await newProperty();

    const mine = await newNode(first, 'Mío');
    const otherFrom = await newNode(second);
    const otherTo = await newNode(second);
    await createTourLink(db, second, { fromNodeId: otherFrom, toNodeId: otherTo });

    const data = await tour(first);
    expect(data.nodes.map((node) => node.id)).toEqual([mine]);
    expect(data.nodes[0]?.links).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Nodos                                                                      */
/* -------------------------------------------------------------------------- */

describe('nodos', () => {
  it('se crea un nodo sobre un panorama de la propiedad', async () => {
    const propertyId = await newProperty();
    const mediaId = await newPanorama(propertyId);

    const created = await createTourNode(db, propertyId, { propertyMediaId: mediaId });

    expect(created.ok).toBe(true);
    if (created.ok) expect(created.data.isStart).toBe(false);
  });

  it('una imagen normal no puede ser nodo', async () => {
    const propertyId = await newProperty();
    const mediaId = await newImage(propertyId);

    const result = await createTourNode(db, propertyId, { propertyMediaId: mediaId });

    expect(errorOf(result).code).toBe('tour_media_not_panorama');
    expect((await tour(propertyId)).nodes).toHaveLength(0);
  });

  it('un documento tampoco', async () => {
    const propertyId = await newProperty();
    const created = await createMedia(db, propertyId, {
      mediaKind: 'document',
      sourceProvider: 'r2',
      objectKey: nextKey(),
    });
    if (!created.ok) throw new Error('setup');

    const result = await createTourNode(db, propertyId, { propertyMediaId: created.data.id });

    expect(errorOf(result).code).toBe('tour_media_not_panorama');
  });

  it('un panorama de otra propiedad se rechaza', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const foreign = await newPanorama(second);

    const result = await createTourNode(db, first, { propertyMediaId: foreign });

    expect(errorOf(result).code).toBe('tour_media_property_mismatch');
  });

  it('un panorama inexistente se rechaza', async () => {
    const propertyId = await newProperty();

    const result = await createTourNode(db, propertyId, { propertyMediaId: 9999 });

    expect(errorOf(result).code).toBe('tour_media_property_mismatch');
  });

  it('un panorama solo sostiene un nodo', async () => {
    const propertyId = await newProperty();
    const mediaId = await newPanorama(propertyId);

    await createTourNode(db, propertyId, { propertyMediaId: mediaId });
    const second = await createTourNode(db, propertyId, { propertyMediaId: mediaId });

    expect(errorOf(second).code).toBe('tour_media_in_use');
    expect((await tour(propertyId)).nodes).toHaveLength(1);
  });

  it('sin sortOrder, el nodo nuevo va al final', async () => {
    const propertyId = await newProperty();

    await newNode(propertyId);
    await newNode(propertyId);
    const third = await createTourNode(db, propertyId, {
      propertyMediaId: await newPanorama(propertyId),
    });

    if (!third.ok) throw new Error('setup');
    expect(third.data.sortOrder).toBe(2);
  });

  it('guarda nombre en espanol y en ingles, y el vacio como null', async () => {
    const propertyId = await newProperty();
    const nodeId = await newNode(propertyId);

    await updateTourNode(db, propertyId, nodeId, { nameEs: 'Entrada', nameEn: 'Entrance' });
    expect((await tour(propertyId)).nodes[0]?.names).toEqual({ es: 'Entrada', en: 'Entrance' });

    await updateTourNode(db, propertyId, nodeId, { nameEs: '   ' });
    expect((await tour(propertyId)).nodes[0]?.names.es).toBeNull();
  });

  it('el ingles es opcional y puede llegar despues', async () => {
    const propertyId = await newProperty();
    const nodeId = await newNode(propertyId);

    await updateTourNode(db, propertyId, nodeId, { nameEs: 'Entrada' });
    await updateTourNode(db, propertyId, nodeId, { nameEn: 'Entrance' });

    expect((await tour(propertyId)).nodes[0]?.names).toEqual({ es: 'Entrada', en: 'Entrance' });
  });

  it('guarda la camara inicial y su posicion', async () => {
    const propertyId = await newProperty();
    const nodeId = await newNode(propertyId);

    await updateTourNode(db, propertyId, nodeId, {
      initialYaw: 0.5,
      initialPitch: -0.1,
      initialFov: 80,
      sortOrder: 3,
    });

    const node = (await tour(propertyId)).nodes[0];
    expect(node?.initialYaw).toBe(0.5);
    expect(node?.initialPitch).toBe(-0.1);
    expect(node?.initialFov).toBe(80);
    expect(node?.sortOrder).toBe(3);
  });

  it('un nodo de otra propiedad no se puede tocar', async () => {
    const first = await newProperty();
    const second = await newProperty();
    const foreign = await newNode(second);

    expect(errorOf(await updateTourNode(db, first, foreign, { nameEs: 'x' })).code).toBe(
      'tour_node_not_found',
    );
    expect(errorOf(await deleteTourNode(db, first, foreign)).code).toBe('tour_node_not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Nodo inicial                                                               */
/* -------------------------------------------------------------------------- */

describe('nodo inicial', () => {
  it('se marca uno como inicial', async () => {
    const propertyId = await newProperty();
    const nodeId = await newNode(propertyId);

    const result = await setStartNode(db, propertyId, nodeId, true);

    expect(result.ok).toBe(true);
    expect((await tour(propertyId)).startNodeId).toBe(nodeId);
  });

  it('marcar otro retira el anterior: solo hay uno', async () => {
    const propertyId = await newProperty();
    const first = await newNode(propertyId);
    const second = await newNode(propertyId);

    await setStartNode(db, propertyId, first, true);
    const swap = await setStartNode(db, propertyId, second, true);

    expect(swap.ok).toBe(true);

    const data = await tour(propertyId);
    expect(data.startNodeId).toBe(second);
    expect(data.nodes.filter((node) => node.isStart)).toHaveLength(1);
  });

  it('el intercambio va en un solo lote', async () => {
    const propertyId = await newProperty();
    const first = await newNode(propertyId);
    const second = await newNode(propertyId);

    await setStartNode(db, propertyId, first, true);

    const batch = vi.spyOn(db, 'batch');
    await setStartNode(db, propertyId, second, true);

    expect(batch).toHaveBeenCalledTimes(1);
    // Retirar el anterior y marcar el nuevo.
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
    batch.mockRestore();
  });

  it('se puede dejar el recorrido sin nodo inicial', async () => {
    const propertyId = await newProperty();
    const nodeId = await newNode(propertyId);

    await setStartNode(db, propertyId, nodeId, true);
    await setStartNode(db, propertyId, nodeId, false);

    expect((await tour(propertyId)).startNodeId).toBeNull();
  });

  it('cada propiedad tiene su propio nodo inicial', async () => {
    const first = await newProperty();
    const second = await newProperty();

    const a = await newNode(first);
    const b = await newNode(second);

    await setStartNode(db, first, a, true);
    await setStartNode(db, second, b, true);

    expect((await tour(first)).startNodeId).toBe(a);
    expect((await tour(second)).startNodeId).toBe(b);
  });

  it('un nodo de otra propiedad no puede marcarse como inicial', async () => {
    const first = await newProperty();
    const foreign = await newNode(await newProperty());

    expect(errorOf(await setStartNode(db, first, foreign, true)).code).toBe('tour_node_not_found');
  });
});

/* -------------------------------------------------------------------------- */
/* Enlaces                                                                    */
/* -------------------------------------------------------------------------- */

describe('enlaces', () => {
  it('se crea un enlace entre dos nodos de la propiedad', async () => {
    const propertyId = await newProperty();
    const from = await newNode(propertyId);
    const to = await newNode(propertyId);

    const created = await createTourLink(db, propertyId, {
      fromNodeId: from,
      toNodeId: to,
      yaw: 1.5,
      pitch: -0.2,
    });

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.data.yaw).toBe(1.5);
      expect(created.data.pitch).toBe(-0.2);
    }
  });

  it('sin posicion, el hotspot nace en el origen', async () => {
    const propertyId = await newProperty();
    const from = await newNode(propertyId);
    const to = await newNode(propertyId);

    const created = await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: to });

    if (!created.ok) throw new Error('setup');
    expect(created.data.yaw).toBe(0);
    expect(created.data.pitch).toBe(0);
  });

  it('un nodo no puede enlazar consigo mismo', async () => {
    const propertyId = await newProperty();
    const nodeId = await newNode(propertyId);

    const result = await createTourLink(db, propertyId, {
      fromNodeId: nodeId,
      toNodeId: nodeId,
    });

    expect(errorOf(result).code).toBe('tour_link_invalid');
    expect((await tour(propertyId)).nodes[0]?.links).toHaveLength(0);
  });

  it('no se pueden enlazar nodos de propiedades distintas', async () => {
    const first = await newProperty();
    const second = await newProperty();

    const mine = await newNode(first);
    const foreign = await newNode(second);

    const result = await createTourLink(db, first, { fromNodeId: mine, toNodeId: foreign });

    expect(errorOf(result).code).toBe('tour_link_invalid');
  });

  it('los dos extremos tienen que ser de ESTA propiedad', async () => {
    const first = await newProperty();
    const second = await newProperty();

    const a = await newNode(second);
    const b = await newNode(second);

    // Ambos de la segunda propiedad, pero la peticion es de la primera.
    const result = await createTourLink(db, first, { fromNodeId: a, toNodeId: b });

    expect(errorOf(result).code).toBe('tour_node_not_found');
  });

  it('un nodo inexistente se rechaza', async () => {
    const propertyId = await newProperty();
    const from = await newNode(propertyId);

    const result = await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: 9999 });

    expect(errorOf(result).code).toBe('tour_node_not_found');
  });

  it('no hay dos enlaces con el mismo origen y destino', async () => {
    const propertyId = await newProperty();
    const from = await newNode(propertyId);
    const to = await newNode(propertyId);

    await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: to });
    const second = await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: to });

    expect(errorOf(second).code).toBe('tour_link_duplicate');
  });

  it('el sentido contrario si es otro enlace', async () => {
    const propertyId = await newProperty();
    const a = await newNode(propertyId);
    const b = await newNode(propertyId);

    await createTourLink(db, propertyId, { fromNodeId: a, toNodeId: b });
    const back = await createTourLink(db, propertyId, { fromNodeId: b, toNodeId: a });

    expect(back.ok).toBe(true);
  });

  it('sin sortOrder, el enlace va al final de los de su nodo', async () => {
    const propertyId = await newProperty();
    const from = await newNode(propertyId);
    const first = await newNode(propertyId);
    const second = await newNode(propertyId);

    await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: first });
    const later = await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: second });

    if (!later.ok) throw new Error('setup');
    expect(later.data.sortOrder).toBe(1);
  });

  it('se puede mover el hotspot y recolocar el enlace', async () => {
    const propertyId = await newProperty();
    const from = await newNode(propertyId);
    const to = await newNode(propertyId);

    const created = await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: to });
    if (!created.ok) throw new Error('setup');

    const updated = await updateTourLink(db, propertyId, created.data.id, {
      yaw: 2.1,
      pitch: 0.3,
      sortOrder: 4,
    });

    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.data.yaw).toBe(2.1);
      expect(updated.data.sortOrder).toBe(4);
      // Los extremos no cambian.
      expect(updated.data.fromNodeId).toBe(from);
      expect(updated.data.toNodeId).toBe(to);
    }
  });

  it('un enlace de otra propiedad no se puede tocar', async () => {
    const first = await newProperty();
    const second = await newProperty();

    const a = await newNode(second);
    const b = await newNode(second);
    const created = await createTourLink(db, second, { fromNodeId: a, toNodeId: b });
    if (!created.ok) throw new Error('setup');

    expect(errorOf(await updateTourLink(db, first, created.data.id, { yaw: 1 })).code).toBe(
      'tour_link_not_found',
    );
    expect(errorOf(await deleteTourLink(db, first, created.data.id)).code).toBe(
      'tour_link_not_found',
    );
  });

  it('se borra un enlace sin tocar sus nodos', async () => {
    const propertyId = await newProperty();
    const from = await newNode(propertyId);
    const to = await newNode(propertyId);

    const created = await createTourLink(db, propertyId, { fromNodeId: from, toNodeId: to });
    if (!created.ok) throw new Error('setup');

    const deleted = await deleteTourLink(db, propertyId, created.data.id);

    expect(deleted.ok).toBe(true);
    const data = await tour(propertyId);
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0]?.links).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Borrado y cascadas                                                         */
/* -------------------------------------------------------------------------- */

describe('borrado de nodos', () => {
  it('borrar un nodo se lleva sus enlaces, entrantes y salientes', async () => {
    const propertyId = await newProperty();
    const a = await newNode(propertyId);
    const b = await newNode(propertyId);
    const c = await newNode(propertyId);

    await createTourLink(db, propertyId, { fromNodeId: a, toNodeId: b });
    await createTourLink(db, propertyId, { fromNodeId: b, toNodeId: c });
    await createTourLink(db, propertyId, { fromNodeId: c, toNodeId: a });

    await deleteTourNode(db, propertyId, b);

    // Solo sobrevive el enlace que no tocaba a `b`.
    const links = await db.select({ id: propertyTourLinks.id }).from(propertyTourLinks);
    expect(links).toHaveLength(1);

    const data = await tour(propertyId);
    expect(data.nodes.map((node) => node.id)).toEqual([a, c]);
    expect(data.nodes.find((node) => node.id === c)?.links.map((l) => l.toNodeId)).toEqual([a]);
  });

  it('borrar un nodo se lleva sus traducciones', async () => {
    const propertyId = await newProperty();
    const nodeId = await newNode(propertyId, 'Entrada');

    await updateTourNode(db, propertyId, nodeId, { nameEn: 'Entrance' });

    const before = await db
      .select({ id: propertyTourNodeTranslations.id })
      .from(propertyTourNodeTranslations)
      .where(eq(propertyTourNodeTranslations.propertyTourNodeId, nodeId));
    expect(before).toHaveLength(2);

    await deleteTourNode(db, propertyId, nodeId);

    const after = await db
      .select({ id: propertyTourNodeTranslations.id })
      .from(propertyTourNodeTranslations)
      .where(eq(propertyTourNodeTranslations.propertyTourNodeId, nodeId));
    expect(after).toHaveLength(0);
  });

  it('borrar el nodo NO borra su panorama: queda libre para otro', async () => {
    const propertyId = await newProperty();
    const mediaId = await newPanorama(propertyId);

    const created = await createTourNode(db, propertyId, { propertyMediaId: mediaId });
    if (!created.ok) throw new Error('setup');

    await deleteTourNode(db, propertyId, created.data.id);

    // El archivo sigue ahi y vuelve a admitir un nodo.
    const again = await createTourNode(db, propertyId, { propertyMediaId: mediaId });
    expect(again.ok).toBe(true);
  });

  it('borrar el nodo inicial deja el recorrido sin inicio, no roto', async () => {
    const propertyId = await newProperty();
    const nodeId = await newNode(propertyId);

    await setStartNode(db, propertyId, nodeId, true);
    await deleteTourNode(db, propertyId, nodeId);

    expect((await tour(propertyId)).startNodeId).toBeNull();
  });

  it('un panorama con nodo sigue protegido por el RESTRICT', async () => {
    const propertyId = await newProperty();
    const mediaId = await newPanorama(propertyId);

    await createTourNode(db, propertyId, { propertyMediaId: mediaId });

    const result = await deleteMedia(db, propertyId, mediaId);

    expect(errorOf(result).code).toBe('media_in_use');
    expect((await tour(propertyId)).nodes).toHaveLength(1);
  });

  it('al borrar el nodo, su panorama ya se puede eliminar', async () => {
    const propertyId = await newProperty();
    const mediaId = await newPanorama(propertyId);

    const created = await createTourNode(db, propertyId, { propertyMediaId: mediaId });
    if (!created.ok) throw new Error('setup');

    await deleteTourNode(db, propertyId, created.data.id);

    expect((await deleteMedia(db, propertyId, mediaId)).ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Mensajes                                                                   */
/* -------------------------------------------------------------------------- */

describe('mensajes de error', () => {
  it('no mencionan SQL, tablas ni stack traces', async () => {
    const propertyId = await newProperty();
    const nodeId = await newNode(propertyId);

    const results = [
      await createTourNode(db, propertyId, { propertyMediaId: await newImage(propertyId) }),
      await createTourLink(db, propertyId, { fromNodeId: nodeId, toNodeId: nodeId }),
      await deleteTourLink(db, propertyId, 9999),
    ];

    for (const result of results) {
      const { message } = errorOf(result);
      expect(message).not.toMatch(/SQL|SQLITE|property_tour|CHECK|UNIQUE|node:sqlite/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});
