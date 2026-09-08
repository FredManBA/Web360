/**
 * Configuracion global del sitio.
 *
 * El modelo ya existia desde la Fase 0 y no se toca: `site_settings` con sus
 * traducciones y `site_social_links`. Aqui solo se lee y se escribe.
 *
 * `site_settings` es un singleton LOGICO: la aplicacion garantiza que solo hay
 * una fila, sin constraints artificiales ni triggers. Se crea sola la primera
 * vez que alguien guarda algo; leer no la crea, porque abrir la pantalla de
 * configuracion no es configurar nada.
 *
 * Sobre las claves de objeto de R2 —logo, favicon, imagen social— existen en
 * el esquema pero NO se exponen: editarlas a mano seria pedirle a una persona
 * que escriba una ruta de bucket. Necesitan una subida de archivo, que es la
 * fase de media global y no esta hecha.
 */

import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { siteSettings, siteSettingTranslations, siteSocialLinks } from '../../../db/schema';
import { isValidCurrencyCode } from '../../domain/money';
import type { Locale } from '../../domain/vocabularies';
import { localeSchema } from '../../validation/primitives';
import { fail, ok, type AdminBatchDatabase, type AdminDatabase, type AdminResult } from '../types';

/* -------------------------------------------------------------------------- */
/* Forma                                                                      */
/* -------------------------------------------------------------------------- */

export interface SiteSettingsView {
  businessName: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  reviewerEmail: string | null;
  notificationsEmail: string | null;
  defaultCurrencyCode: string | null;
}

export interface SiteTranslationView {
  locale: Locale;
  brandTagline: string | null;
  homeHeroTitle: string | null;
  homeHeroSubtitle: string | null;
  globalSeoTitle: string | null;
  globalSeoDescription: string | null;
}

export interface SocialLinkView {
  id: number;
  platform: string;
  url: string;
  sortOrder: number;
  isActive: boolean;
}

export interface SiteConfigView {
  settings: SiteSettingsView;
  translations: SiteTranslationView[];
  social: SocialLinkView[];
}

const EMPTY_SETTINGS: SiteSettingsView = {
  businessName: null,
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  reviewerEmail: null,
  notificationsEmail: null,
  defaultCurrencyCode: null,
};

function emptyTranslation(locale: Locale): SiteTranslationView {
  return {
    locale,
    brandTagline: null,
    homeHeroTitle: null,
    homeHeroSubtitle: null,
    globalSeoTitle: null,
    globalSeoDescription: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Validacion                                                                 */
/* -------------------------------------------------------------------------- */

export const SETTINGS_LIMITS = {
  businessName: 120,
  phone: 40,
  email: 200,
  address: 300,
  tagline: 160,
  heroTitle: 160,
  heroSubtitle: 300,
  seoTitle: 160,
  seoDescription: 300,
  platform: 60,
  url: 500,
} as const;

/**
 * Campo de texto opcional.
 *
 * Un formulario envia `""` cuando se vacia un campo, y eso significa "no hay
 * valor", no "cadena vacia": se normaliza a `null` para no guardar blancos
 * que despues habria que limpiar al leerlos.
 */
function optional(max: number): z.ZodType<string | null> {
  return z
    .string()
    .max(max)
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
    });
}

/** Correo opcional, validado solo cuando trae algo. */
function optionalEmail(): z.ZodType<string | null> {
  return optional(SETTINGS_LIMITS.email).refine(
    (value) => value === null || z.email().safeParse(value).success,
    { message: 'Correo invalido.' },
  );
}

/**
 * URL de una red social.
 *
 * Solo `http` y `https`: un `javascript:` acabaria en un enlace del sitio
 * publico, y el resto de esquemas no tienen sentido aqui.
 */
export function isPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const settingsPatchSchema = z.strictObject({
  businessName: optional(SETTINGS_LIMITS.businessName).optional(),
  phone: optional(SETTINGS_LIMITS.phone).optional(),
  whatsapp: optional(SETTINGS_LIMITS.phone).optional(),
  email: optionalEmail().optional(),
  address: optional(SETTINGS_LIMITS.address).optional(),

  // Buzones internos: se editan aqui y no salen nunca al sitio publico.
  reviewerEmail: optionalEmail().optional(),
  notificationsEmail: optionalEmail().optional(),

  defaultCurrencyCode: optional(3)
    .refine((value) => value === null || isValidCurrencyCode(value.toUpperCase()), {
      message: 'Codigo de moneda ISO 4217 invalido.',
    })
    .transform((value) => (value === null ? null : value.toUpperCase()))
    .optional(),
});

export const settingsTranslationSchema = z.strictObject({
  brandTagline: optional(SETTINGS_LIMITS.tagline).optional(),
  homeHeroTitle: optional(SETTINGS_LIMITS.heroTitle).optional(),
  homeHeroSubtitle: optional(SETTINGS_LIMITS.heroSubtitle).optional(),
  globalSeoTitle: optional(SETTINGS_LIMITS.seoTitle).optional(),
  globalSeoDescription: optional(SETTINGS_LIMITS.seoDescription).optional(),
});

export const socialLinkSchema = z.strictObject({
  platform: z.string().min(1).max(SETTINGS_LIMITS.platform),
  url: z.string().min(1).max(SETTINGS_LIMITS.url).refine(isPublicUrl, {
    message: 'La direccion debe empezar por http:// o https://',
  }),
  isActive: z.boolean().optional(),
});

export const socialLinkPatchSchema = socialLinkSchema.partial();

export const socialOrderSchema = z.strictObject({
  ids: z.array(z.number().int().positive()).min(1),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type SettingsTranslationPatch = z.infer<typeof settingsTranslationSchema>;

/* -------------------------------------------------------------------------- */
/* Lectura                                                                    */
/* -------------------------------------------------------------------------- */

/** La fila del singleton, si existe. Leer NO la crea. */
async function currentRow(db: AdminDatabase): Promise<{ id: number } | null> {
  const rows = await db
    .select({ id: siteSettings.id })
    .from(siteSettings)
    .orderBy(asc(siteSettings.id))
    .limit(1);

  return rows[0] ?? null;
}

export async function getSiteConfig(db: AdminDatabase): Promise<SiteConfigView> {
  const rows = await db.select().from(siteSettings).orderBy(asc(siteSettings.id)).limit(1);
  const row = rows[0];

  const translations = await db
    .select()
    .from(siteSettingTranslations)
    .orderBy(asc(siteSettingTranslations.id));

  const social = await db
    .select()
    .from(siteSocialLinks)
    .orderBy(asc(siteSocialLinks.sortOrder), asc(siteSocialLinks.id));

  const settings: SiteSettingsView =
    row === undefined
      ? EMPTY_SETTINGS
      : {
          businessName: row.businessName,
          phone: row.phone,
          whatsapp: row.whatsapp,
          email: row.email,
          address: row.address,
          reviewerEmail: row.reviewerEmail,
          notificationsEmail: row.notificationsEmail,
          defaultCurrencyCode: row.defaultCurrencyCode,
        };

  /*
   * Los dos idiomas salen siempre, aunque no exista la fila: el panel los
   * pinta vacios y solo se escribe cuando alguien teclea algo.
   */
  const byLocale = (locale: Locale): SiteTranslationView => {
    const found = translations.find(
      (entry) => entry.locale === locale && entry.siteSettingsId === row?.id,
    );

    return found === undefined
      ? emptyTranslation(locale)
      : {
          locale,
          brandTagline: found.brandTagline,
          homeHeroTitle: found.homeHeroTitle,
          homeHeroSubtitle: found.homeHeroSubtitle,
          globalSeoTitle: found.globalSeoTitle,
          globalSeoDescription: found.globalSeoDescription,
        };
  };

  return {
    settings,
    translations: [byLocale('es'), byLocale('en')],
    social: social.map((link) => ({
      id: link.id,
      platform: link.platform,
      url: link.url,
      sortOrder: link.sortOrder,
      isActive: link.isActive,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Escritura                                                                  */
/* -------------------------------------------------------------------------- */

/** Crea la fila del singleton la primera vez que hace falta escribir. */
async function ensureRow(db: AdminDatabase): Promise<number> {
  const existing = await currentRow(db);
  if (existing !== null) return existing.id;

  const inserted = await db.insert(siteSettings).values({}).returning({ id: siteSettings.id });

  const id = inserted[0]?.id;
  if (id === undefined) throw new Error('No se pudo crear la configuracion del sitio.');

  return id;
}

export async function updateSiteSettings(
  db: AdminDatabase,
  input: unknown,
): Promise<AdminResult<SiteConfigView>> {
  const parsed = settingsPatchSchema.safeParse(input);
  if (!parsed.success) {
    return fail({
      code: 'validation_failed',
      message: 'Datos de configuracion invalidos.',
      field: parsed.error.issues[0]?.path.join('.'),
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return ok(await getSiteConfig(db));

  const id = await ensureRow(db);
  await db
    .update(siteSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(siteSettings.id, id));

  return ok(await getSiteConfig(db));
}

export async function upsertSiteTranslation(
  db: AdminDatabase,
  locale: Locale,
  input: unknown,
): Promise<AdminResult<SiteConfigView>> {
  const validLocale = localeSchema.safeParse(locale);
  if (!validLocale.success) {
    return fail({ code: 'validation_failed', message: 'Idioma invalido.', field: 'locale' });
  }

  const parsed = settingsTranslationSchema.safeParse(input);
  if (!parsed.success) {
    return fail({
      code: 'validation_failed',
      message: 'Textos invalidos.',
      field: parsed.error.issues[0]?.path.join('.'),
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const settingsId = await ensureRow(db);

  const rows = await db
    .select({ id: siteSettingTranslations.id, locale: siteSettingTranslations.locale })
    .from(siteSettingTranslations)
    .where(eq(siteSettingTranslations.siteSettingsId, settingsId));

  const row = rows.find((entry) => entry.locale === validLocale.data);

  if (row === undefined) {
    await db.insert(siteSettingTranslations).values({
      siteSettingsId: settingsId,
      locale: validLocale.data,
      ...parsed.data,
    });
  } else {
    await db
      .update(siteSettingTranslations)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(siteSettingTranslations.id, row.id));
  }

  return ok(await getSiteConfig(db));
}

/* -------------------------------------------------------------------------- */
/* Redes sociales                                                             */
/* -------------------------------------------------------------------------- */

export async function createSocialLink(
  db: AdminDatabase,
  input: unknown,
): Promise<AdminResult<SocialLinkView>> {
  const parsed = socialLinkSchema.safeParse(input);
  if (!parsed.success) {
    return fail({
      code: 'validation_failed',
      message: 'Enlace invalido.',
      field: parsed.error.issues[0]?.path.join('.'),
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const existing = await db
    .select({ sortOrder: siteSocialLinks.sortOrder })
    .from(siteSocialLinks)
    .orderBy(asc(siteSocialLinks.sortOrder));

  // Al final de la lista, que es donde se espera que aparezca lo nuevo.
  const last = existing.at(-1)?.sortOrder ?? -1;

  const inserted = await db
    .insert(siteSocialLinks)
    .values({
      platform: parsed.data.platform.trim(),
      url: parsed.data.url.trim(),
      isActive: parsed.data.isActive ?? true,
      sortOrder: last + 1,
    })
    .returning();

  const row = inserted[0];
  if (row === undefined) {
    return fail({ code: 'validation_failed', message: 'No se pudo guardar el enlace.' });
  }

  return ok({
    id: row.id,
    platform: row.platform,
    url: row.url,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  });
}

export async function updateSocialLink(
  db: AdminDatabase,
  id: number,
  input: unknown,
): Promise<AdminResult<SocialLinkView>> {
  const parsed = socialLinkPatchSchema.safeParse(input);
  if (!parsed.success) {
    return fail({
      code: 'validation_failed',
      message: 'Enlace invalido.',
      field: parsed.error.issues[0]?.path.join('.'),
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const rows = await db.select().from(siteSocialLinks).where(eq(siteSocialLinks.id, id)).limit(1);
  const current = rows[0];
  if (current === undefined) {
    return fail({ code: 'social_link_not_found', message: 'El enlace no existe.', field: 'id' });
  }

  const patch = parsed.data;
  await db
    .update(siteSocialLinks)
    .set({
      ...(patch.platform === undefined ? {} : { platform: patch.platform.trim() }),
      ...(patch.url === undefined ? {} : { url: patch.url.trim() }),
      ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
      updatedAt: new Date(),
    })
    .where(eq(siteSocialLinks.id, id));

  const after = await db.select().from(siteSocialLinks).where(eq(siteSocialLinks.id, id)).limit(1);
  const row = after[0];
  if (row === undefined) {
    return fail({ code: 'social_link_not_found', message: 'El enlace no existe.', field: 'id' });
  }

  return ok({
    id: row.id,
    platform: row.platform,
    url: row.url,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  });
}

export async function deleteSocialLink(db: AdminDatabase, id: number): Promise<AdminResult<null>> {
  const rows = await db
    .select({ id: siteSocialLinks.id })
    .from(siteSocialLinks)
    .where(eq(siteSocialLinks.id, id))
    .limit(1);

  if (rows[0] === undefined) {
    return fail({ code: 'social_link_not_found', message: 'El enlace no existe.', field: 'id' });
  }

  await db.delete(siteSocialLinks).where(eq(siteSocialLinks.id, id));
  return ok(null);
}

/**
 * Reordena la lista completa.
 *
 * Se exige la lista ENTERA y se escribe en un solo lote: un orden a medias
 * dejaria dos enlaces compartiendo posicion. Es el mismo criterio que ya usan
 * los grupos de caracteristicas.
 */
export async function reorderSocialLinks(
  db: AdminBatchDatabase,
  input: unknown,
): Promise<AdminResult<SocialLinkView[]>> {
  const parsed = socialOrderSchema.safeParse(input);
  if (!parsed.success) {
    return fail({ code: 'validation_failed', message: 'Orden invalido.', field: 'ids' });
  }

  const { ids } = parsed.data;
  if (new Set(ids).size !== ids.length) {
    return fail({
      code: 'validation_failed',
      message: 'Hay identificadores repetidos.',
      field: 'ids',
    });
  }

  const current = await db
    .select({ id: siteSocialLinks.id })
    .from(siteSocialLinks)
    .where(inArray(siteSocialLinks.id, ids));

  if (current.length !== ids.length) {
    return fail({
      code: 'social_order_conflict',
      message: 'La lista enviada ya no coincide con los enlaces guardados.',
      field: 'ids',
    });
  }

  const total = await db.select({ id: siteSocialLinks.id }).from(siteSocialLinks);
  if (total.length !== ids.length) {
    return fail({
      code: 'social_order_conflict',
      message: 'Falta algun enlace en la lista enviada.',
      field: 'ids',
    });
  }

  const now = new Date();
  const statements = ids.map((id, index) =>
    db
      .update(siteSocialLinks)
      .set({ sortOrder: index, updatedAt: now })
      .where(eq(siteSocialLinks.id, id)),
  );

  const [first, ...rest] = statements;
  if (first !== undefined) await db.batch([first, ...rest]);

  const config = await getSiteConfig(db);
  return ok(config.social);
}
