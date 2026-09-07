/**
 * Bandeja de consultas del panel.
 *
 * Es una bandeja de entrada, no un CRM: listar, leer, marcar como atendida y
 * borrar. Sin notas, sin asignaciones y sin estados intermedios; el modelo
 * solo tiene `new` y `reviewed` a proposito.
 *
 * El borrado es de verdad: no hay soft delete en `contacts`, y quien borra una
 * consulta espera que desaparezca.
 */

import { desc, eq } from 'drizzle-orm';

import { contacts, properties, propertyTranslations } from '../../../db/schema';
import type { ContactMethod, ContactStatus, Locale } from '../../domain/vocabularies';
import { fail, ok, type AdminDatabase, type AdminResult } from '../types';

export interface ContactListItem {
  id: number;
  name: string;
  preferredContactMethod: ContactMethod;
  contactValue: string;
  /** Recortado: el listado no necesita el mensaje entero. */
  messagePreview: string | null;
  locale: Locale;
  status: ContactStatus;

  propertyId: number | null;
  propertyCode: string | null;
  propertyTitle: string | null;

  createdAt: Date;
}

export interface ContactDetail extends Omit<ContactListItem, 'messagePreview'> {
  message: string | null;
  consentAcceptedAt: Date | null;
  updatedAt: Date;
}

const PREVIEW_LENGTH = 120;

function preview(message: string | null): string | null {
  if (message === null) return null;

  const clean = message.trim();
  if (clean.length === 0) return null;

  return clean.length <= PREVIEW_LENGTH ? clean : `${clean.slice(0, PREVIEW_LENGTH)}…`;
}

/**
 * Titulo de la propiedad consultada.
 *
 * Se busca en el idioma en que se escribio la consulta, que es el que vio
 * quien pregunto. Si esa traduccion no existe, se deja `null` en vez de
 * ensenar el titulo de otro idioma como si fuera el que vio.
 */
async function propertyTitles(db: AdminDatabase): Promise<Map<string, string>> {
  const rows = await db
    .select({
      propertyId: propertyTranslations.propertyId,
      locale: propertyTranslations.locale,
      title: propertyTranslations.title,
    })
    .from(propertyTranslations);

  const titles = new Map<string, string>();
  for (const row of rows) {
    if (row.title !== null) titles.set(`${row.propertyId}:${row.locale}`, row.title);
  }

  return titles;
}

/**
 * Listado completo.
 *
 * Sin paginacion: con el volumen previsto cabe entero, igual que en
 * propiedades. Ordenado por fecha descendente, que es como se lee una bandeja.
 */
export async function listContacts(
  db: AdminDatabase,
  filters: { status?: ContactStatus } = {},
): Promise<ContactListItem[]> {
  const base = db
    .select({
      id: contacts.id,
      name: contacts.name,
      preferredContactMethod: contacts.preferredContactMethod,
      contactValue: contacts.contactValue,
      message: contacts.message,
      locale: contacts.locale,
      status: contacts.status,
      propertyId: contacts.propertyId,
      propertyCode: properties.code,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .leftJoin(properties, eq(contacts.propertyId, properties.id));

  const rows =
    filters.status === undefined
      ? await base.orderBy(desc(contacts.createdAt), desc(contacts.id))
      : await base
          .where(eq(contacts.status, filters.status))
          .orderBy(desc(contacts.createdAt), desc(contacts.id));

  const titles = await propertyTitles(db);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    preferredContactMethod: row.preferredContactMethod,
    contactValue: row.contactValue,
    messagePreview: preview(row.message),
    locale: row.locale,
    status: row.status,
    propertyId: row.propertyId,
    propertyCode: row.propertyCode,
    propertyTitle:
      row.propertyId === null ? null : (titles.get(`${row.propertyId}:${row.locale}`) ?? null),
    createdAt: row.createdAt,
  }));
}

export async function getContact(
  db: AdminDatabase,
  id: number,
): Promise<AdminResult<ContactDetail>> {
  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      preferredContactMethod: contacts.preferredContactMethod,
      contactValue: contacts.contactValue,
      message: contacts.message,
      locale: contacts.locale,
      status: contacts.status,
      propertyId: contacts.propertyId,
      propertyCode: properties.code,
      consentAcceptedAt: contacts.consentAcceptedAt,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
    })
    .from(contacts)
    .leftJoin(properties, eq(contacts.propertyId, properties.id))
    .where(eq(contacts.id, id))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    return fail({ code: 'contact_not_found', message: 'La consulta no existe.', field: 'id' });
  }

  const titles = await propertyTitles(db);

  return ok({
    id: row.id,
    name: row.name,
    preferredContactMethod: row.preferredContactMethod,
    contactValue: row.contactValue,
    message: row.message,
    locale: row.locale,
    status: row.status,
    propertyId: row.propertyId,
    propertyCode: row.propertyCode,
    propertyTitle:
      row.propertyId === null ? null : (titles.get(`${row.propertyId}:${row.locale}`) ?? null),
    consentAcceptedAt: row.consentAcceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Cambia el estado.
 *
 * Los dos sentidos valen: marcar como atendida y devolverla a pendiente. No
 * es una maquina de estados, son dos casillas.
 */
export async function setContactStatus(
  db: AdminDatabase,
  id: number,
  status: ContactStatus,
): Promise<AdminResult<ContactDetail>> {
  const found = await getContact(db, id);
  if (!found.ok) return found;

  await db.update(contacts).set({ status, updatedAt: new Date() }).where(eq(contacts.id, id));

  return getContact(db, id);
}

export async function deleteContact(db: AdminDatabase, id: number): Promise<AdminResult<null>> {
  const found = await getContact(db, id);
  if (!found.ok) return found;

  await db.delete(contacts).where(eq(contacts.id, id));

  return ok(null);
}
