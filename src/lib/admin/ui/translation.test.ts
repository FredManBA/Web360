/**
 * Tests del contenido traducible: campos ES/EN, slugs y estado por idioma.
 *
 * Funciones puras mas comprobaciones estructurales de la pagina.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { toSlug } from '../../domain/slug';
import { resolveTitle } from './property-row';
import {
  EMPTY_TRANSLATION,
  isTranslationDirty,
  isTranslationEmpty,
  languageStatusLabel,
  parseTranslationForm,
  resolveLanguageStatus,
  slugFromTitle,
  translationToRaw,
  type TranslationFields,
  type TranslationFormRaw,
} from './translation-state';

const EDITOR_PAGE = 'src/pages/admin/propiedades/[id].astro';
const EDITOR_SCRIPT = 'src/lib/admin/ui/editor-page.ts';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

function raw(overrides: Partial<TranslationFormRaw> = {}): TranslationFormRaw {
  return {
    title: '',
    slug: '',
    marketingDescription: '',
    technicalDescription: '',
    ...overrides,
  };
}

function fields(overrides: Partial<TranslationFields> = {}): TranslationFields {
  return { ...EMPTY_TRANSLATION, ...overrides };
}

/* -------------------------------------------------------------------------- */
/* Carga y campos                                                             */
/* -------------------------------------------------------------------------- */

describe('contenido traducible', () => {
  it('(1)(2) se cargan ambos idiomas desde la respuesta del editor', () => {
    const script = read(EDITOR_SCRIPT);

    expect(script).toContain('payload.translations');
    expect(script).toContain('entry.locale === locale');
    expect(script).toContain('writeTranslation(locale, loadedTranslations[locale])');
  });

  it('(3)(4) un idioma sin traduccion queda con los campos vacios', () => {
    expect(translationToRaw(EMPTY_TRANSLATION)).toEqual({
      title: '',
      slug: '',
      marketingDescription: '',
      technicalDescription: '',
    });

    // No se inventa contenido cuando la traduccion no existe.
    expect(read(EDITOR_SCRIPT)).toContain('{ ...EMPTY_TRANSLATION }');
  });

  it('(5) el ingles se presenta como opcional', () => {
    const page = read(EDITOR_PAGE);

    expect(page).toContain('Opcional. Puedes completar la versión en inglés más adelante.');
    expect(page).toContain('English');
    // Sin traduccion automatica ni botones de IA.
    expect(page).not.toMatch(/traducci[oó]n autom[aá]tica|traducir autom/i);
    for (const senuelo of ['Traducir', 'Generar con IA', 'Sugerir texto']) {
      expect(page).not.toContain(senuelo);
    }
  });

  it('(6)(7) los cuatro campos existen en ambos idiomas', () => {
    const page = read(EDITOR_PAGE);

    for (const locale of ['es', 'en']) {
      for (const field of ['title', 'slug', 'marketing', 'technical']) {
        expect(page).toContain(`id="field-${locale}-${field}"`);
        expect(page).toContain(`for="field-${locale}-${field}"`);
      }
    }
  });

  it('las descripciones son textareas de texto plano', () => {
    const page = read(EDITOR_PAGE);

    expect(page.match(/<textarea/g)).toHaveLength(4);
    expect(page).not.toMatch(/contenteditable|wysiwyg|markdown|quill|tiptap/i);
  });

  it('(8) las traducciones no se mezclan entre idiomas', () => {
    const es = parseTranslationForm('es', raw({ title: 'Lote con vista', slug: 'lote-vista' }));
    const en = parseTranslationForm('en', raw({ title: 'Sea view lot', slug: 'sea-view-lot' }));

    expect(es.ok && es.fields.title).toBe('Lote con vista');
    expect(en.ok && en.fields.title).toBe('Sea view lot');
    expect(es.ok && es.fields.slug).not.toBe(en.ok ? en.fields.slug : null);
  });

  it('(9)(10) la cabecera prefiere ES y cae a EN cuando falta', () => {
    expect(resolveTitle({ titleEs: 'Lote', titleEn: 'Lot' }).text).toBe('Lote');

    const soloIngles = resolveTitle({ titleEs: null, titleEn: 'Lot' });
    expect(soloIngles.text).toBe('Lot');
    expect(soloIngles.missingSpanish).toBe(true);

    // La cabecera se repinta con las traducciones ya persistidas.
    expect(read(EDITOR_SCRIPT)).toContain('titleEs: loadedTranslations.es.title');
  });

  it('los textos vacios se guardan como null', () => {
    const parsed = parseTranslationForm('es', raw({ title: '   ', marketingDescription: '' }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.fields.title).toBeNull();
      expect(parsed.fields.marketingDescription).toBeNull();
    }
  });

  it('(23 bis) no se crea una traduccion vacia por abrir el editor', () => {
    // Sin cambios respecto a lo cargado, no hay nada sucio que enviar.
    expect(isTranslationDirty(EMPTY_TRANSLATION, EMPTY_TRANSLATION)).toBe(false);
    expect(read(EDITOR_SCRIPT)).toContain(
      'if (!isTranslationDirty(loadedTranslations[locale], snapshot)) return { ok: true }',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Slugs                                                                      */
/* -------------------------------------------------------------------------- */

describe('slugs', () => {
  it('(11)(12) se genera desde el titulo del mismo idioma', () => {
    const es = slugFromTitle('Lote Vista al Mar');
    const en = slugFromTitle('Sea View Lot');

    expect(es).toEqual({ ok: true, slug: 'lote-vista-al-mar' });
    expect(en).toEqual({ ok: true, slug: 'sea-view-lot' });
  });

  it('reutiliza `toSlug`, sin normalizacion propia', () => {
    expect(slugFromTitle('Finca Añeja')).toEqual({ ok: true, slug: toSlug('Finca Añeja') });
  });

  it('(13) un titulo vacio no genera un slug vacio en silencio', () => {
    const result = slugFromTitle('   ');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Escribe primero un título para generar el slug.');
  });

  it('un titulo sin caracteres utiles avisa en vez de generar vacio', () => {
    const result = slugFromTitle('¡¿!?');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('no permite generar');
  });

  it('(14) un slug escrito a mano se conserva', () => {
    const parsed = parseTranslationForm('es', raw({ title: 'Otro título', slug: 'mi-slug' }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.fields.slug).toBe('mi-slug');
  });

  it('(15) cambiar el titulo no toca el slug', () => {
    const script = read(EDITOR_SCRIPT);

    // El slug solo cambia con la accion explicita del boton.
    expect(script).toContain('target.dataset.generateSlug');
    expect(script).not.toContain('slugInput.value = toSlug(');

    // Y viaja siempre explicito, para que el servidor no lo regenere.
    expect(script).toContain('slug: snapshot.slug');
  });

  it('(16) un slug invalido bloquea solo ese idioma', () => {
    const es = parseTranslationForm('es', raw({ slug: 'Mal Slug' }));
    const en = parseTranslationForm('en', raw({ slug: 'buen-slug' }));

    expect(es.ok).toBe(false);
    if (!es.ok) expect(es.errors[0]?.field).toBe('es.slug');
    expect(en.ok).toBe(true);
  });

  it('(17)(18) el error se ancla al idioma correspondiente', () => {
    const es = parseTranslationForm('es', raw({ slug: 'MAL' }));
    const en = parseTranslationForm('en', raw({ slug: 'MAL' }));

    if (!es.ok) expect(es.errors[0]?.field).toBe('es.slug');
    if (!en.ok) expect(en.errors[0]?.field).toBe('en.slug');

    // El script prefija el error de la API con el idioma que fallo.
    expect(read(EDITOR_SCRIPT)).toContain('`${locale}.${error.field}`');
  });

  it('(19) nunca se anaden sufijos automaticos', () => {
    const script = read(EDITOR_SCRIPT);

    expect(script).not.toMatch(/slug \+ '-\d|`\$\{slug\}-\$\{/);
    expect(script).not.toContain('-2`');
  });

  it('un slug vacio es valido en un borrador', () => {
    const parsed = parseTranslationForm('es', raw({ slug: '' }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.fields.slug).toBeNull();
  });

  it('los botones de generar nombran su idioma', () => {
    const page = read(EDITOR_PAGE);

    expect(page).toContain('Generar desde el título en español');
    expect(page).toContain('Generar desde el título en inglés');
    expect(page).toContain('data-generate-slug="es"');
    expect(page).toContain('data-generate-slug="en"');
  });
});

/* -------------------------------------------------------------------------- */
/* Estado del idioma                                                          */
/* -------------------------------------------------------------------------- */

describe('estado de cada idioma', () => {
  it('(20) sin contenido', () => {
    expect(resolveLanguageStatus(EMPTY_TRANSLATION)).toBe('empty');
    expect(languageStatusLabel('empty')).toBe('Sin contenido');
  });

  it('(21) incompleto: hay algo pero falta el titulo', () => {
    expect(resolveLanguageStatus(fields({ slug: 'lote' }))).toBe('partial');
    expect(resolveLanguageStatus(fields({ marketingDescription: 'Texto' }))).toBe('partial');
    expect(languageStatusLabel('partial')).toBe('Incompleto');
  });

  it('(22) con contenido: hay titulo', () => {
    expect(resolveLanguageStatus(fields({ title: 'Lote' }))).toBe('filled');
    expect(resolveLanguageStatus(fields({ title: 'Lote', slug: 'lote' }))).toBe('filled');
    expect(languageStatusLabel('filled')).toBe('Con contenido');
  });

  it('(23) ES y EN se calculan por separado', () => {
    const es = fields({ title: 'Lote' });
    const en = EMPTY_TRANSLATION;

    expect(resolveLanguageStatus(es)).toBe('filled');
    expect(resolveLanguageStatus(en)).toBe('empty');
  });

  it('detecta correctamente una traduccion vacia', () => {
    expect(isTranslationEmpty(EMPTY_TRANSLATION)).toBe(true);
    expect(isTranslationEmpty(fields({ technicalDescription: 'x' }))).toBe(false);
  });

  it('el estado no depende solo del color', () => {
    const page = read(EDITOR_PAGE);
    // El texto viaja en el propio badge.
    expect(page).toContain('id="lang-es-status"');
    expect(page).toContain('Sin contenido');
  });
});

/* -------------------------------------------------------------------------- */
/* Cambios pendientes                                                         */
/* -------------------------------------------------------------------------- */

describe('cambios pendientes por idioma', () => {
  it('detecta cualquier campo modificado', () => {
    const loaded = fields({ title: 'Lote', slug: 'lote' });

    expect(isTranslationDirty(loaded, { ...loaded })).toBe(false);
    expect(isTranslationDirty(loaded, { ...loaded, title: 'Otro' })).toBe(true);
    expect(isTranslationDirty(loaded, { ...loaded, slug: 'otro' })).toBe(true);
    expect(isTranslationDirty(loaded, { ...loaded, marketingDescription: 'x' })).toBe(true);
    expect(isTranslationDirty(loaded, { ...loaded, technicalDescription: 'x' })).toBe(true);
  });

  it('el grupo del control se deduce del prefijo de su nombre', () => {
    const script = read(EDITOR_SCRIPT);

    expect(script).toContain("name.startsWith('es.')");
    expect(script).toContain("name.startsWith('en.')");
  });

  it('cada idioma es un grupo de guardado independiente', () => {
    const script = read(EDITOR_SCRIPT);
    expect(script).toContain("es: translationPort('es')");
    expect(script).toContain("en: translationPort('en')");
  });
});

/* -------------------------------------------------------------------------- */
/* Integracion con el editor                                                  */
/* -------------------------------------------------------------------------- */

describe('integracion', () => {
  it('sigue habiendo un unico boton de guardar', () => {
    const page = read(EDITOR_PAGE);

    expect(page.match(/type="submit"/g)).toHaveLength(1);
    expect(page).not.toContain('Guardar español');
    expect(page).not.toContain('Guardar inglés');
  });

  it('el boton manual usa el coordinador', () => {
    expect(read(EDITOR_SCRIPT)).toContain('coordinator?.saveNow()');
  });

  it('beforeunload depende del trabajo pendiente del coordinador', () => {
    expect(read(EDITOR_SCRIPT)).toContain('coordinator?.snapshot().hasPendingWork');
  });

  it('las secciones son verticales, no pestanas', () => {
    const page = read(EDITOR_PAGE);

    expect(page).toContain('aria-labelledby="lang-es-heading"');
    expect(page).toContain('aria-labelledby="lang-en-heading"');
    expect(page).not.toContain('role="tab"');
    expect(page).not.toContain('role="tabpanel"');
  });

  it('los slugs tienen su error asociado por ARIA', () => {
    const page = read(EDITOR_PAGE);

    for (const locale of ['es', 'en']) {
      expect(page).toContain(`aria-describedby="field-${locale}-slug-error"`);
      expect(page).toContain(`id="field-${locale}-slug-error"`);
    }
  });

  it('el editor sigue sin publicar ni tocar SEO', () => {
    const page = read(EDITOR_PAGE);

    /*
     * Desde 5B el editor SI habla de revision, y ahi aparece la palabra
     * "publicar" —justo para decir que aprobar no publica—. Lo que se sigue
     * comprobando es que no existe ninguna accion de publicar ni nada de SEO:
     * publicar es de otra fase.
     */
    expect(page).not.toMatch(/noindex|meta description/i);
    expect(page).not.toContain('data-action="publish"');
    expect(page).not.toContain('/publish');
  });
});
