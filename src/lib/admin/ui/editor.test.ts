/**
 * Tests del editor de informacion basica.
 *
 * Funciones puras (creacion, cambios pendientes, PATCH, mapeo de errores) mas
 * comprobaciones estructurales de las paginas Astro. Sin navegador ni E2E.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { COMMERCIAL_STATUSES } from '../../domain/vocabularies';
import { createPropertyCreator, editorPath } from './create-property';
import {
  buildPatch,
  isDirty,
  loadStateMessage,
  mapSaveError,
  resolveLoadState,
  saveStateLabel,
  shouldWarnBeforeUnload,
  toEditorFields,
  validateCodeLocally,
  type EditorFields,
} from './editor-state';
import { commercialStatusLabel } from './labels';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const EDITOR_PAGE = 'src/pages/admin/propiedades/[id].astro';
const LISTING_PAGE = 'src/pages/admin/propiedades.astro';
const LISTING_SCRIPT = 'src/lib/admin/ui/properties-page.ts';

function fields(overrides: Partial<EditorFields> = {}): EditorFields {
  return {
    code: 'LOBA-001',
    propertyTypeId: 1,
    commercialStatus: 'available',
    isFeatured: false,
    showWhenSold: false,
    priceMode: 'contact',
    priceAmountMinor: null,
    currencyCode: null,
    areaSquareMeters: null,
    province: null,
    canton: null,
    district: null,
    locality: null,
    privateLatitude: null,
    privateLongitude: null,
    publicLatitude: null,
    publicLongitude: null,
    locationPrecision: 'approximate',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/* -------------------------------------------------------------------------- */
/* Creacion                                                                   */
/* -------------------------------------------------------------------------- */

describe('nueva propiedad', () => {
  it('(1) el listado ofrece el CTA', () => {
    const page = read(LISTING_PAGE);

    expect(page).toContain('Nueva propiedad');
    expect(page).toContain('id="admin-create"');
    // Sin modal ni asistente previo.
    expect(page).not.toContain('dialog');
  });

  it('(2) crea el borrador por la API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: { id: 7 } }));
    const creator = createPropertyCreator(fetchMock as unknown as typeof fetch);

    const result = await creator.create();

    expect(result).toEqual({ ok: true, id: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/properties');
    expect(init.method).toBe('POST');
  });

  it('(3) un doble clic no crea dos propiedades', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const creator = createPropertyCreator(fetchMock as unknown as typeof fetch);

    const first = creator.create();
    const second = await creator.create();

    // La segunda llamada ni siquiera llega a la red.
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(creator.busy).toBe(true);

    resolveFetch?.(jsonResponse(201, { data: { id: 3 } }));
    expect(await first).toEqual({ ok: true, id: 3 });
    expect(creator.busy).toBe(false);
  });

  it('permite reintentar despues de terminar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: { id: 1 } }));
    const creator = createPropertyCreator(fetchMock as unknown as typeof fetch);

    await creator.create();
    await creator.create();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('(4) la creacion correcta lleva al editor', () => {
    expect(editorPath(12)).toBe('/admin/propiedades/12');
    expect(read(LISTING_SCRIPT)).toContain('window.location.href = editorPath(result.id)');
  });

  it('(5) un fallo de creacion devuelve un mensaje comprensible', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { ok: false }));
    const creator = createPropertyCreator(fetchMock as unknown as typeof fetch);

    const result = await creator.create();

    expect(result).toEqual({ ok: false, message: 'No pudimos crear la propiedad.' });
  });

  it('un 403 se explica como falta de acceso', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { ok: false }));
    const creator = createPropertyCreator(fetchMock as unknown as typeof fetch);

    const result = await creator.create();

    expect(result).toEqual({
      ok: false,
      message: 'No tienes acceso al panel administrativo.',
    });
  });

  it('un fallo de red no expone el detalle', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:8787'));
    const creator = createPropertyCreator(fetchMock as unknown as typeof fetch);

    const result = await creator.create();

    expect(result).toEqual({ ok: false, message: 'No pudimos crear la propiedad.' });
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
  });

  it('una respuesta sin id se trata como fallo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: {} }));
    const creator = createPropertyCreator(fetchMock as unknown as typeof fetch);

    expect(await creator.create()).toEqual({
      ok: false,
      message: 'No pudimos crear la propiedad.',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Ruta y navegacion                                                          */
/* -------------------------------------------------------------------------- */

describe('ruta del editor', () => {
  it('(6) es on-demand', () => {
    expect(read(EDITOR_PAGE)).toContain('export const prerender = false');
  });

  it('(25) el listado enlaza al editor de forma semantica', () => {
    const script = read(LISTING_SCRIPT);

    expect(script).toContain('editorPath(row.id)');
    expect(script).toContain('<a class="admin-code admin-row-link"');
    // El enlace va en codigo y titulo, no en la fila entera.
    expect(script).not.toContain('<tr onclick');
    expect(script).not.toContain("addEventListener('click', () => { window.location");
  });

  it('el editor ofrece volver al listado', () => {
    const page = read(EDITOR_PAGE);
    expect(page).toContain('href="/admin/propiedades"');
    expect(page).toContain('← Propiedades');
  });
});

/* -------------------------------------------------------------------------- */
/* Carga                                                                      */
/* -------------------------------------------------------------------------- */

describe('carga del editor', () => {
  it('(7) una propiedad existente queda lista', () => {
    expect(resolveLoadState(200)).toBe('ready');
    expect(loadStateMessage('ready')).toBeNull();
  });

  it('(8) 404 explica que la propiedad no existe', () => {
    expect(resolveLoadState(404)).toBe('not-found');
    expect(loadStateMessage('not-found')).toBe('La propiedad no existe.');
  });

  it('403 y errores generales tienen su mensaje', () => {
    expect(loadStateMessage(resolveLoadState(403))).toBe(
      'No tienes acceso al panel administrativo.',
    );
    expect(loadStateMessage(resolveLoadState(500))).toBe('No pudimos cargar la propiedad.');
    expect(loadStateMessage(resolveLoadState(0))).toBe('No pudimos cargar la propiedad.');
  });

  it('sin respuesta todavia, el estado es de carga', () => {
    expect(resolveLoadState(null)).toBe('loading');
    expect(loadStateMessage('loading')).toBe('Cargando propiedad…');
  });

  it('ningun mensaje de carga filtra detalle interno', () => {
    for (const status of [403, 404, 500, 0]) {
      const message = loadStateMessage(resolveLoadState(status)) ?? '';
      expect(message).not.toMatch(/SQL|stack|json|undefined|\{|\}/i);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Cabecera                                                                   */
/* -------------------------------------------------------------------------- */

describe('cabecera del editor', () => {
  const script = read('src/lib/admin/ui/editor-page.ts');

  it('(9)(10)(11) reutiliza la resolucion de titulo del listado', () => {
    // Misma funcion que ya cubre ES preferido, respaldo EN y "Sin titulo".
    expect(script).toContain('import { resolveTitle');
    expect(script).toContain('resolveTitle({');
  });

  it('muestra codigo y ambos estados', () => {
    expect(script).toContain('publicationStatusLabel');
    expect(script).toContain('commercialStatusLabel');
    expect(script).toContain('admin-code');
  });

  it('no usa el id de base de datos como titulo', () => {
    expect(script).not.toContain('property.id}</');
    expect(script).not.toContain('`#${property.id}`');
  });
});

/* -------------------------------------------------------------------------- */
/* Campos                                                                     */
/* -------------------------------------------------------------------------- */

describe('campos de informacion basica', () => {
  const page = read(EDITOR_PAGE);

  it('(14) el codigo es editable y se explica', () => {
    expect(page).toContain('id="field-code"');
    expect(page).toContain('type="text"');
    expect(page).toContain('Se genera automáticamente, pero puedes modificarlo.');
  });

  it('valida localmente lo basico, reutilizando el dominio', () => {
    expect(validateCodeLocally('LOBA-001')).toBeNull();
    expect(validateCodeLocally('   ')).toBe('El código no puede estar vacío.');
    expect(validateCodeLocally('A'.repeat(65))).toBe('El código es demasiado largo.');
    // No se exige el patron LOBA-###.
    expect(validateCodeLocally('FINCA-SUR')).toBeNull();
  });

  it('(12)(13) el tipo permite quedarse sin tipo', () => {
    expect(page).toContain('id="field-type"');
    expect(page).toContain('<option value="">Sin tipo</option>');

    const script = read('src/lib/admin/ui/editor-page.ts');
    // Nombre en espanol con respaldo en ingles; nunca se inventa.
    expect(script).toContain('type.names.es ?? type.names.en');
  });

  it('(16) el estado comercial usa etiquetas humanas', () => {
    expect(page).toContain('id="field-commercial"');

    for (const status of COMMERCIAL_STATUSES) {
      expect(page).not.toContain(`>${status}<`);
    }
    expect(commercialStatusLabel('offer_received')).toBe('Con oferta');
  });

  it('(17) destacada es un checkbox nativo', () => {
    expect(page).toContain('id="field-featured"');
    expect(page).toContain('Mostrar como propiedad destacada');
  });

  it('(18) mostrar vendida es un checkbox con explicacion', () => {
    expect(page).toContain('id="field-show-when-sold"');
    expect(page).toContain('Mantener visible cuando esté vendida');
    expect(page).toContain('Si se desactiva, una propiedad vendida no aparecerá públicamente.');
    // La explicacion no habla de SEO.
    expect(page).not.toMatch(/SEO|noindex/i);
  });

  it('el estado editorial no se puede cambiar desde aqui', () => {
    expect(page).not.toContain('publicationStatus');
    expect(page).not.toContain('Publicar');
    expect(page).not.toContain('Archivar');
    expect(page).not.toContain('Enviar a revisión');
  });
});

/* -------------------------------------------------------------------------- */
/* Cambios pendientes y guardado                                              */
/* -------------------------------------------------------------------------- */

describe('cambios pendientes', () => {
  it('(21) detecta cualquier campo modificado', () => {
    const loaded = fields();

    expect(isDirty(loaded, fields())).toBe(false);
    expect(isDirty(loaded, fields({ code: 'OTRO' }))).toBe(true);
    expect(isDirty(loaded, fields({ propertyTypeId: 2 }))).toBe(true);
    expect(isDirty(loaded, fields({ propertyTypeId: null }))).toBe(true);
    expect(isDirty(loaded, fields({ commercialStatus: 'sold' }))).toBe(true);
    expect(isDirty(loaded, fields({ isFeatured: true }))).toBe(true);
    expect(isDirty(loaded, fields({ showWhenSold: true }))).toBe(true);
  });

  it('el PATCH solo lleva lo que cambio', () => {
    const loaded = fields();

    expect(buildPatch(loaded, fields())).toEqual({});
    expect(buildPatch(loaded, fields({ isFeatured: true }))).toEqual({ isFeatured: true });
    expect(buildPatch(loaded, fields({ code: 'FINCA-SUR', showWhenSold: true }))).toEqual({
      code: 'FINCA-SUR',
      showWhenSold: true,
    });
  });

  it('un codigo intacto nunca se reenvia', () => {
    const patch = buildPatch(fields(), fields({ commercialStatus: 'reserved' }));
    expect(patch).not.toHaveProperty('code');
  });

  it('toEditorFields toma los campos editables y descarta el id', () => {
    const editable = toEditorFields({ id: 4, ...fields({ code: 'LOBA-004' }) });

    expect(editable).not.toHaveProperty('id');
    expect(editable.code).toBe('LOBA-004');

    // Los cinco de la subfase anterior mas precio, superficie y ubicacion.
    expect(Object.keys(editable)).toHaveLength(18);
    for (const key of ['code', 'priceMode', 'areaSquareMeters', 'publicLatitude']) {
      expect(editable).toHaveProperty(key);
    }
  });
});

describe('estados de guardado', () => {
  it('(19) el guardado usa PATCH sobre la propiedad', () => {
    const script = read('src/lib/admin/ui/editor-page.ts');

    expect(script).toContain("method: 'PATCH'");
    expect(script).toContain('/api/admin/properties/${propertyId}');
    // Sin autosave en esta subfase.
    expect(script).not.toContain('setInterval');
    expect(script).not.toContain('debounce');
  });

  it('(20)(21)(22)(23) cada estado tiene su etiqueta', () => {
    expect(saveStateLabel('saved')).toBe('Guardado');
    expect(saveStateLabel('dirty')).toBe('Cambios sin guardar');
    expect(saveStateLabel('saving')).toBe('Guardando…');
    expect(saveStateLabel('error')).toBe('Error al guardar');
  });

  it('(24) solo se avisa al salir si hay trabajo que perder', () => {
    expect(shouldWarnBeforeUnload('saved')).toBe(false);
    expect(shouldWarnBeforeUnload('saving')).toBe(false);
    expect(shouldWarnBeforeUnload('dirty')).toBe(true);
    // Tras un fallo los cambios locales siguen ahi, asi que tambien se avisa.
    expect(shouldWarnBeforeUnload('error')).toBe(true);
  });

  it('el aviso al salir solo se registra desde el estado', () => {
    const script = read('src/lib/admin/ui/editor-page.ts');
    expect(script).toContain('shouldWarnBeforeUnload(saveState)');
  });

  it('un fallo al guardar conserva los cambios locales', () => {
    const script = read('src/lib/admin/ui/editor-page.ts');
    // Tras el error se marca el estado, pero no se recarga ni se restaura.
    expect(script).toContain("setSaveState('error')");
    expect(script).not.toContain('location.reload()');
  });
});

/* -------------------------------------------------------------------------- */
/* Errores de la API                                                          */
/* -------------------------------------------------------------------------- */

describe('mapeo de errores al guardar', () => {
  it('(15) un codigo duplicado se muestra junto al campo', () => {
    const error = mapSaveError(409, { error: { code: 'code_taken', field: 'code' } });

    expect(error.field).toBe('code');
    expect(error.message).toBe('Ya existe otra propiedad con ese código.');
  });

  it('un 422 se asocia al campo que indica la API', () => {
    const error = mapSaveError(422, {
      error: { code: 'validation_failed', field: 'priceAmountMinor', message: 'Falta el importe.' },
    });

    expect(error.field).toBe('priceAmountMinor');
    expect(error.message).toBe('Falta el importe.');
  });

  it('un 500 usa el mensaje generico', () => {
    const error = mapSaveError(500, { error: { code: 'internal_error' } });

    expect(error.field).toBeNull();
    expect(error.message).toBe('No pudimos guardar los cambios.');
  });

  it('un 403 explica la falta de acceso', () => {
    expect(mapSaveError(403, {}).message).toBe('No tienes acceso al panel administrativo.');
  });

  it('nunca se filtra el cuerpo crudo ni detalle interno', () => {
    const error = mapSaveError(500, {
      error: {
        code: 'internal_error',
        message: 'SQLITE_ERROR: no such table: properties at Statement.all',
      },
    });

    expect(error.message).toBe('No pudimos guardar los cambios.');
    expect(JSON.stringify(error)).not.toContain('SQLITE');
    expect(JSON.stringify(error)).not.toContain('properties');
  });

  it('tolera un cuerpo vacio o inesperado', () => {
    expect(mapSaveError(500, null).message).toBe('No pudimos guardar los cambios.');
    expect(mapSaveError(422, {}).message).toBe('No pudimos guardar los cambios.');
    expect(mapSaveError(409, 'texto').message).toBe('No pudimos guardar los cambios.');
  });
});

/* -------------------------------------------------------------------------- */
/* Accesibilidad                                                              */
/* -------------------------------------------------------------------------- */

describe('accesibilidad del editor', () => {
  const page = read(EDITOR_PAGE);

  it('(26) cada control tiene label real', () => {
    for (const id of [
      'field-code',
      'field-type',
      'field-commercial',
      'field-featured',
      'field-show-when-sold',
    ]) {
      expect(page).toContain(`for="${id}"`);
      expect(page).toContain(`id="${id}"`);
    }
  });

  it('(26) el codigo declara sus descripciones y su validez', () => {
    expect(page).toContain('aria-describedby="field-code-help field-code-error"');
    expect(page).toContain('aria-invalid="false"');
  });

  it('el error de codigo se marca al fallar', () => {
    const script = read('src/lib/admin/ui/editor-page.ts');
    // El marcado es generico: sirve para cualquier campo con error asociado.
    expect(script).toContain("setAttribute('aria-invalid', 'true')");
    expect(script).toContain("setAttribute('aria-invalid', 'false')");
  });

  it('el estado de guardado se anuncia', () => {
    expect(page).toContain('role="status"');
    expect(page).toContain('id="editor-save-status"');
  });

  it('los errores generales usan alert y la carga es aria-live', () => {
    expect(page).toContain('role="alert"');
    expect(page).toContain('aria-live="polite"');
  });

  it('el heading de la seccion es correcto', () => {
    expect(page).toContain('<h2>Información básica</h2>');
  });

  it('usa controles nativos, sin ARIA inventado', () => {
    expect(page).toContain('type="checkbox"');
    expect(page).toContain('<select');
    expect(page).not.toContain('role="checkbox"');
    expect(page).not.toContain('role="combobox"');
  });
});
