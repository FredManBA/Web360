/**
 * Tests HTTP de la bandeja de consultas.
 *
 * Handlers reales con `Request` reales sobre SQLite real. Lo que mas importa
 * aqui es que la bandeja NO sea publica: contiene nombres, telefonos y correos
 * de personas que escribieron.
 */

import type { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { createLead } from '../../contacts/lead';
import { createMemoryBucket } from '../media/bucket';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import type { AdminHttpContext } from './handlers';
import {
  handleDeleteContact,
  handleGetContact,
  handleListContacts,
  handleUpdateContactStatus,
} from './contact-handlers';

const BASE = 'https://panel.codeloba.test';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

function ctx(
  request: Request,
  params: Record<string, string | undefined> = {},
  bypass = true,
): AdminHttpContext {
  return {
    request,
    params,
    db,
    bucket: createMemoryBucket(),
    env: bypass ? { isDev: true, ADMIN_DEV_BYPASS: 'true' } : { isDev: true },
  };
}

function request(method: string, path = '/api/admin/contacts', body?: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Una consulta guardada por el camino publico de verdad. */
async function newLead(name = 'Ana Rojas'): Promise<number> {
  const result = await createLead(db, {
    name,
    method: 'email',
    contactValue: 'ana@example.com',
    message: 'Hola, me interesa.',
    locale: 'es',
    consent: true,
  });

  if (!result.ok || result.stored === null) throw new Error('setup: consulta');
  return result.stored.id;
}

async function jsonOf(response: Response): Promise<{ data?: unknown; error?: { code: string } }> {
  return (await response.json()) as { data?: unknown; error?: { code: string } };
}

/* -------------------------------------------------------------------------- */
/* Proteccion                                                                 */
/* -------------------------------------------------------------------------- */

describe('la bandeja no es publica', () => {
  it('sin acceso no se listan las consultas', async () => {
    await newLead();

    const response = await handleListContacts(ctx(request('GET'), {}, false));

    expect(response.status).toBe(403);
    // Ni un nombre se escapa en el cuerpo del rechazo.
    expect(await response.text()).not.toContain('Ana');
  });

  it('sin acceso tampoco se lee, se cambia ni se borra', async () => {
    const id = await newLead();
    const params = { contactId: String(id) };

    expect((await handleGetContact(ctx(request('GET'), params, false))).status).toBe(403);
    expect(
      (
        await handleUpdateContactStatus(
          ctx(request('PATCH', '/x', { status: 'reviewed' }), params, false),
        )
      ).status,
    ).toBe(403);
    expect((await handleDeleteContact(ctx(request('DELETE'), params, false))).status).toBe(403);
  });

  it('nada de esto se cachea', async () => {
    await newLead();

    const response = await handleListContacts(ctx(request('GET')));

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rechaza escrituras de otro origen', async () => {
    const id = await newLead();
    const patch = request('PATCH', '/x', { status: 'reviewed' });
    patch.headers.set('origin', 'https://otro.example');

    const response = await handleUpdateContactStatus(ctx(patch, { contactId: String(id) }));

    expect(response.status).toBe(403);
  });
});

/* -------------------------------------------------------------------------- */
/* Listado y detalle                                                          */
/* -------------------------------------------------------------------------- */

describe('listado', () => {
  it('devuelve las consultas pendientes', async () => {
    await newLead('Primera');
    await newLead('Segunda');

    const response = await handleListContacts(ctx(request('GET')));
    const rows = (await jsonOf(response)).data as { name: string; status: string }[];

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'new')).toBe(true);
  });

  it('se puede filtrar por estado', async () => {
    const id = await newLead('Atendida');
    await newLead('Pendiente');

    await handleUpdateContactStatus(
      ctx(request('PATCH', '/x', { status: 'reviewed' }), { contactId: String(id) }),
    );

    const response = await handleListContacts(
      ctx(request('GET', '/api/admin/contacts?status=new')),
    );
    const rows = (await jsonOf(response)).data as { name: string }[];

    expect(rows.map((row) => row.name)).toEqual(['Pendiente']);
  });

  it('un filtro que no existe se rechaza', async () => {
    const response = await handleListContacts(
      ctx(request('GET', '/api/admin/contacts?status=archivada')),
    );

    expect(response.status).toBe(422);
  });

  it('el detalle trae el mensaje entero', async () => {
    const id = await newLead();

    const response = await handleGetContact(ctx(request('GET'), { contactId: String(id) }));
    const detail = (await jsonOf(response)).data as { message: string };

    expect(response.status).toBe(200);
    expect(detail.message).toBe('Hola, me interesa.');
  });

  it('una consulta que no existe responde 404', async () => {
    const response = await handleGetContact(ctx(request('GET'), { contactId: '999' }));

    expect(response.status).toBe(404);
  });

  it('un identificador que no es un entero positivo no llega a consultar', async () => {
    const response = await handleGetContact(ctx(request('GET'), { contactId: '-1' }));

    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Estado y borrado                                                           */
/* -------------------------------------------------------------------------- */

describe('atender y borrar', () => {
  it('de pendiente a atendida, y de vuelta', async () => {
    const id = await newLead();
    const params = { contactId: String(id) };

    const reviewed = await handleUpdateContactStatus(
      ctx(request('PATCH', '/x', { status: 'reviewed' }), params),
    );
    expect(((await jsonOf(reviewed)).data as { status: string }).status).toBe('reviewed');

    // Volver atras vale: son dos casillas, no un embudo.
    const back = await handleUpdateContactStatus(
      ctx(request('PATCH', '/x', { status: 'new' }), params),
    );
    expect(((await jsonOf(back)).data as { status: string }).status).toBe('new');
  });

  it('un estado inventado se rechaza', async () => {
    const id = await newLead();

    const response = await handleUpdateContactStatus(
      ctx(request('PATCH', '/x', { status: 'en_curso' }), { contactId: String(id) }),
    );

    expect(response.status).toBe(422);
  });

  it('borrar la elimina de verdad', async () => {
    const id = await newLead();
    const params = { contactId: String(id) };

    const deleted = await handleDeleteContact(ctx(request('DELETE'), params));
    expect(deleted.status).toBe(204);

    const after = await handleGetContact(ctx(request('GET'), params));
    expect(after.status).toBe(404);
  });

  it('borrar algo que ya no esta responde 404, no 204', async () => {
    const response = await handleDeleteContact(ctx(request('DELETE'), { contactId: '999' }));

    expect(response.status).toBe(404);
  });
});
