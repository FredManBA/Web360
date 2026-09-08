/**
 * Tests de la configuracion del sitio.
 *
 * Contra SQLite real con las migraciones del proyecto, y los handlers con
 * `Request` reales. Lo que mas importa aqui es la frontera: los dos buzones
 * internos se editan en el panel y NO pueden salir al sitio publico.
 */

import type { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { siteSettings } from '../../../db/schema';
import { buildPublicSnapshot } from '../../public/read-model';
import { applySeed, createTestDatabase } from '../test-database';
import type { AdminBatchDatabase } from '../types';
import {
  createSocialLink,
  deleteSocialLink,
  getSiteConfig,
  isPublicUrl,
  reorderSocialLinks,
  updateSiteSettings,
  updateSocialLink,
  upsertSiteTranslation,
} from './settings';

let db: AdminBatchDatabase;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = createTestDatabase();
  db = test.db;
  sqlite = test.sqlite;
  applySeed(sqlite);
});

async function settingsRows() {
  return db.select().from(siteSettings);
}

/* -------------------------------------------------------------------------- */
/* Singleton                                                                  */
/* -------------------------------------------------------------------------- */

describe('la fila de configuracion', () => {
  it('leer no la crea: abrir la pantalla no es configurar nada', async () => {
    const config = await getSiteConfig(db);

    expect(config.settings.businessName).toBeNull();
    expect(await settingsRows()).toHaveLength(0);
  });

  it('los dos idiomas salen siempre, aunque no exista ninguna fila', async () => {
    const config = await getSiteConfig(db);

    expect(config.translations.map((entry) => entry.locale)).toEqual(['es', 'en']);
    expect(config.translations[0]?.homeHeroTitle).toBeNull();
  });

  it('se crea sola la primera vez que se guarda algo, y solo una', async () => {
    await updateSiteSettings(db, { businessName: 'Loba' });
    await updateSiteSettings(db, { phone: '+506 2222 2222' });
    await upsertSiteTranslation(db, 'es', { homeHeroTitle: 'Hola' });

    expect(await settingsRows()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Ajustes                                                                    */
/* -------------------------------------------------------------------------- */

describe('los ajustes del negocio', () => {
  it('se guardan y se leen tal cual', async () => {
    const result = await updateSiteSettings(db, {
      businessName: 'Loba Costa Rica',
      phone: '+506 2222 3333',
      whatsapp: '+506 8888 7777',
      email: 'hola@codeloba.test',
      address: 'Nosara, Guanacaste',
    });

    expect(result.ok).toBe(true);

    const config = await getSiteConfig(db);
    expect(config.settings.businessName).toBe('Loba Costa Rica');
    expect(config.settings.whatsapp).toBe('+506 8888 7777');
  });

  it('un campo vaciado se guarda como ausente, no como cadena vacia', async () => {
    await updateSiteSettings(db, { phone: '+506 2222 3333' });
    await updateSiteSettings(db, { phone: '' });

    expect((await getSiteConfig(db)).settings.phone).toBeNull();
  });

  it('solo se toca lo que se envia', async () => {
    await updateSiteSettings(db, { businessName: 'Loba', phone: '+506 2222 3333' });
    await updateSiteSettings(db, { businessName: 'Loba CR' });

    const config = await getSiteConfig(db);
    expect(config.settings.businessName).toBe('Loba CR');
    expect(config.settings.phone).toBe('+506 2222 3333');
  });

  it('un correo invalido se rechaza y no escribe nada', async () => {
    const result = await updateSiteSettings(db, { email: 'esto no es un correo' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation_failed');
    expect(await settingsRows()).toHaveLength(0);
  });

  it('los correos internos tambien se validan', async () => {
    expect((await updateSiteSettings(db, { notificationsEmail: 'roto' })).ok).toBe(false);
    expect((await updateSiteSettings(db, { reviewerEmail: 'roto@' })).ok).toBe(false);
  });

  it('la moneda se normaliza a mayusculas y se comprueba', async () => {
    await updateSiteSettings(db, { defaultCurrencyCode: 'usd' });
    expect((await getSiteConfig(db)).settings.defaultCurrencyCode).toBe('USD');

    expect((await updateSiteSettings(db, { defaultCurrencyCode: 'XXXX' })).ok).toBe(false);
    expect((await updateSiteSettings(db, { defaultCurrencyCode: '123' })).ok).toBe(false);
  });

  it('un campo que no existe se rechaza entero', async () => {
    // `strictObject`: nada de aceptar la mitad de un cuerpo inventado.
    const result = await updateSiteSettings(db, { businessName: 'Loba', colorFavorito: 'verde' });

    expect(result.ok).toBe(false);
    expect(await settingsRows()).toHaveLength(0);
  });

  it('no se pueden escribir las claves de objeto de R2 por aqui', async () => {
    // Existen en el esquema, pero no se administran a mano.
    const result = await updateSiteSettings(db, { logoObjectKey: 'branding/logo.png' });

    expect(result.ok).toBe(false);
  });

  it('un texto demasiado largo se rechaza, no se recorta', async () => {
    expect((await updateSiteSettings(db, { businessName: 'a'.repeat(121) })).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Textos por idioma                                                          */
/* -------------------------------------------------------------------------- */

describe('los textos del sitio', () => {
  it('cada idioma guarda los suyos', async () => {
    await upsertSiteTranslation(db, 'es', { homeHeroTitle: 'Nuestra costa' });
    await upsertSiteTranslation(db, 'en', { homeHeroTitle: 'Our coast' });

    const config = await getSiteConfig(db);
    const es = config.translations.find((entry) => entry.locale === 'es');
    const en = config.translations.find((entry) => entry.locale === 'en');

    expect(es?.homeHeroTitle).toBe('Nuestra costa');
    expect(en?.homeHeroTitle).toBe('Our coast');
  });

  it('editar dos veces el mismo idioma no crea dos filas', async () => {
    await upsertSiteTranslation(db, 'es', { homeHeroTitle: 'Uno' });
    await upsertSiteTranslation(db, 'es', { homeHeroTitle: 'Dos' });

    const config = await getSiteConfig(db);
    expect(config.translations.filter((entry) => entry.locale === 'es')).toHaveLength(1);
    expect(config.translations.find((entry) => entry.locale === 'es')?.homeHeroTitle).toBe('Dos');
  });

  it('un idioma que no es del sitio se rechaza', async () => {
    const result = await upsertSiteTranslation(db, 'fr' as 'es', { homeHeroTitle: 'Bonjour' });

    expect(result.ok).toBe(false);
  });

  it('un campo inventado se rechaza', async () => {
    expect((await upsertSiteTranslation(db, 'es', { subtituloRaro: 'x' })).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Redes sociales                                                             */
/* -------------------------------------------------------------------------- */

describe('las redes sociales', () => {
  async function link(platform: string, url = 'https://example.test/loba'): Promise<number> {
    const created = await createSocialLink(db, { platform, url });
    if (!created.ok) throw new Error(`setup: ${platform}`);
    return created.data.id;
  }

  it('se anaden al final de la lista', async () => {
    await link('Instagram');
    await link('Facebook');

    const config = await getSiteConfig(db);
    expect(config.social.map((entry) => entry.platform)).toEqual(['Instagram', 'Facebook']);
    expect(config.social.map((entry) => entry.sortOrder)).toEqual([0, 1]);
  });

  it('nacen visibles', async () => {
    await link('Instagram');
    expect((await getSiteConfig(db)).social[0]?.isActive).toBe(true);
  });

  it('solo se aceptan direcciones http o https', async () => {
    // Un `javascript:` acabaria en un enlace del sitio publico.
    expect((await createSocialLink(db, { platform: 'X', url: 'javascript:alert(1)' })).ok).toBe(
      false,
    );
    expect((await createSocialLink(db, { platform: 'X', url: 'no es una url' })).ok).toBe(false);
    expect(isPublicUrl('https://instagram.com/loba')).toBe(true);
    expect(isPublicUrl('ftp://archivo.test')).toBe(false);
  });

  it('la plataforma no puede quedar en blanco', async () => {
    expect((await createSocialLink(db, { platform: '', url: 'https://x.test' })).ok).toBe(false);
  });

  it('se pueden ocultar sin borrarlas', async () => {
    const id = await link('Facebook');
    await updateSocialLink(db, id, { isActive: false });

    expect((await getSiteConfig(db)).social[0]?.isActive).toBe(false);
  });

  it('se borran de verdad', async () => {
    const id = await link('Instagram');
    expect((await deleteSocialLink(db, id)).ok).toBe(true);
    expect((await getSiteConfig(db)).social).toHaveLength(0);
  });

  it('borrar algo que ya no esta se explica', async () => {
    const result = await deleteSocialLink(db, 999);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('social_link_not_found');
  });

  it('reordenar reescribe la lista entera', async () => {
    const a = await link('Instagram');
    const b = await link('Facebook');
    const c = await link('YouTube');

    const result = await reorderSocialLinks(db, { ids: [c, a, b] });

    expect(result.ok).toBe(true);
    expect((await getSiteConfig(db)).social.map((entry) => entry.platform)).toEqual([
      'YouTube',
      'Instagram',
      'Facebook',
    ]);
  });

  it('un orden incompleto se rechaza: dejaria dos compartiendo posicion', async () => {
    const a = await link('Instagram');
    await link('Facebook');

    const result = await reorderSocialLinks(db, { ids: [a] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('social_order_conflict');
  });

  it('un orden con repetidos se rechaza', async () => {
    const a = await link('Instagram');
    await link('Facebook');

    expect((await reorderSocialLinks(db, { ids: [a, a] })).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Frontera con el sitio publico                                              */
/* -------------------------------------------------------------------------- */

describe('lo interno se queda dentro', () => {
  async function configured(): Promise<void> {
    await updateSiteSettings(db, {
      businessName: 'Loba',
      phone: '+506 2222 3333',
      whatsapp: '+506 8888 7777',
      email: 'hola@codeloba.test',
      address: 'Nosara',
      reviewerEmail: 'revision-interna@codeloba.test',
      notificationsEmail: 'avisos-internos@codeloba.test',
      defaultCurrencyCode: 'USD',
    });
  }

  it('los canales publicos si llegan al snapshot', async () => {
    await configured();
    const snapshot = await buildPublicSnapshot(db);

    expect(snapshot.contact.phone).toBe('+506 2222 3333');
    expect(snapshot.contact.whatsapp).toBe('+506 8888 7777');
    expect(snapshot.contact.email).toBe('hola@codeloba.test');
    expect(snapshot.site.businessName).toBe('Loba');
  });

  it('los buzones internos NO llegan, ni por valor ni por nombre', async () => {
    await configured();
    const json = JSON.stringify(await buildPublicSnapshot(db));

    expect(json).not.toContain('revision-interna@codeloba.test');
    expect(json).not.toContain('avisos-internos@codeloba.test');
    expect(json).not.toContain('reviewerEmail');
    expect(json).not.toContain('notificationsEmail');
  });

  it('el panel si los ve: por algo se editan ahi', async () => {
    await configured();
    const config = await getSiteConfig(db);

    expect(config.settings.notificationsEmail).toBe('avisos-internos@codeloba.test');
    expect(config.settings.reviewerEmail).toBe('revision-interna@codeloba.test');
  });

  it('una red desactivada no se publica, pero sigue en el panel', async () => {
    const created = await createSocialLink(db, {
      platform: 'Facebook',
      url: 'https://facebook.com/loba',
    });
    if (!created.ok) throw new Error('setup');

    await updateSocialLink(db, created.data.id, { isActive: false });

    expect((await buildPublicSnapshot(db)).contact.social).toEqual([]);
    expect((await getSiteConfig(db)).social).toHaveLength(1);
  });

  it('sin nada configurado el sitio se construye igual', async () => {
    const snapshot = await buildPublicSnapshot(db);

    expect(snapshot.contact.phone).toBeNull();
    expect(snapshot.site.businessName).toBeNull();
    expect(snapshot.contact.social).toEqual([]);
  });
});
