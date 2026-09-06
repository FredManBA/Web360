/**
 * Contenido traducible de una propiedad.
 *
 * ES y EN son independientes: ni los slugs ni los textos se copian entre
 * idiomas. Funciones puras, sin DOM, para poder probarlas.
 *
 * La normalizacion y validacion de slug reutiliza `toSlug` e `isValidSlug` de
 * la Fase 2A; aqui no se reescriben esas reglas.
 */

import { isValidSlug, toSlug } from '../../domain/slug';
import type { Locale } from '../../domain/vocabularies';

export interface TranslationFields {
  title: string | null;
  slug: string | null;
  marketingDescription: string | null;
  technicalDescription: string | null;
}

/** Lo que se lee literalmente de los controles. */
export interface TranslationFormRaw {
  title: string;
  slug: string;
  marketingDescription: string;
  technicalDescription: string;
}

export const EMPTY_TRANSLATION: TranslationFields = {
  title: null,
  slug: null,
  marketingDescription: null,
  technicalDescription: null,
};

export interface TranslationFieldError {
  /** Ruta con idioma, p. ej. "es.slug". */
  field: string;
  message: string;
}

export type ParseTranslationResult =
  { ok: true; fields: TranslationFields } | { ok: false; errors: TranslationFieldError[] };

function optional(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Valida y convierte una traduccion.
 *
 * Un slug vacio es valido en un borrador: se guarda como `null`. Uno escrito
 * a mano debe cumplir el formato; no se "arregla" por detras.
 */
export function parseTranslationForm(
  locale: Locale,
  raw: TranslationFormRaw,
): ParseTranslationResult {
  const errors: TranslationFieldError[] = [];
  const slug = optional(raw.slug);

  if (slug !== null && !isValidSlug(slug)) {
    errors.push({
      field: `${locale}.slug`,
      message: 'Usa solo minúsculas, dígitos y guiones simples.',
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    fields: {
      title: optional(raw.title),
      slug,
      marketingDescription: optional(raw.marketingDescription),
      technicalDescription: optional(raw.technicalDescription),
    },
  };
}

export function translationToRaw(fields: TranslationFields): TranslationFormRaw {
  return {
    title: fields.title ?? '',
    slug: fields.slug ?? '',
    marketingDescription: fields.marketingDescription ?? '',
    technicalDescription: fields.technicalDescription ?? '',
  };
}

export function isTranslationDirty(loaded: TranslationFields, current: TranslationFields): boolean {
  return (
    loaded.title !== current.title ||
    loaded.slug !== current.slug ||
    loaded.marketingDescription !== current.marketingDescription ||
    loaded.technicalDescription !== current.technicalDescription
  );
}

export function isTranslationEmpty(fields: TranslationFields): boolean {
  return (
    fields.title === null &&
    fields.slug === null &&
    fields.marketingDescription === null &&
    fields.technicalDescription === null
  );
}

/* -------------------------------------------------------------------------- */
/* Estado visual del idioma                                                   */
/* -------------------------------------------------------------------------- */

export type LanguageStatus = 'empty' | 'partial' | 'filled';

export const LANGUAGE_STATUS_LABELS: Record<LanguageStatus, string> = {
  empty: 'Sin contenido',
  partial: 'Incompleto',
  filled: 'Con contenido',
};

/**
 * Etiqueta puramente informativa.
 *
 * NO es una regla de publicacion: solo ayuda a ver de un vistazo que falta.
 */
export function resolveLanguageStatus(fields: TranslationFields): LanguageStatus {
  if (isTranslationEmpty(fields)) return 'empty';
  return fields.title === null ? 'partial' : 'filled';
}

export function languageStatusLabel(status: LanguageStatus): string {
  return LANGUAGE_STATUS_LABELS[status];
}

/* -------------------------------------------------------------------------- */
/* Slug desde el titulo                                                       */
/* -------------------------------------------------------------------------- */

export type SlugFromTitleResult = { ok: true; slug: string } | { ok: false; message: string };

/**
 * Genera el slug a partir del titulo del MISMO idioma.
 *
 * Es una accion explicita del usuario: nunca se dispara al escribir el
 * titulo, ni sobrescribe un slug existente por su cuenta.
 */
export function slugFromTitle(title: string): SlugFromTitleResult {
  const trimmed = title.trim();

  if (trimmed.length === 0) {
    return { ok: false, message: 'Escribe primero un título para generar el slug.' };
  }

  const slug = toSlug(trimmed);

  if (slug.length === 0) {
    return { ok: false, message: 'El título no permite generar un slug válido.' };
  }

  return { ok: true, slug };
}
