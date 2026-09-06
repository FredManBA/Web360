/**
 * Tests de la UI de caracteristicas personalizadas.
 *
 * Tres bloques: el estado puro, el cliente de la API con `fetch` inyectado y
 * comprobaciones estructurales sobre la pagina y los modulos. Sin navegador,
 * sin E2E y sin dependencias nuevas.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createFeatureApi, FEATURE_API_MESSAGES } from './feature-api';
import {
  CONFIRM_DELETE_GROUP,
  EMPTY_TEXT,
  LOADING_TEXT,
  initFeatureEditor,
} from './feature-editor';
import {
  addFeature,
  addGroup,
  featurePatch,
  featuresOfGroup,
  groupDisplayName,
  groupPatch,
  hasPendingFeatureWork,
  isEmpty,
  isFeatureDirty,
  isGroupDirty,
  markFeatureSaved,
  markGroupSaved,
  removeFeature,
  removeGroup,
  stateFromApi,
  ungroupedFeatures,
  type ApiFeature,
  type ApiFeaturesView,
} from './feature-editor-state';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const EDITOR_PAGE = 'src/pages/admin/propiedades/[id].astro';
const EDITOR_SCRIPT = 'src/lib/admin/ui/editor-page.ts';
const FEATURE_SCRIPT = 'src/lib/admin/ui/feature-editor.ts';
const FEATURE_API = 'src/lib/admin/ui/feature-api.ts';
const ADMIN_CSS = 'src/styles/admin.css';

function apiFeature(overrides: Partial<ApiFeature> = {}): ApiFeature {
  return {
    id: 1,
    groupId: null,
    sortOrder: 0,
    translations: {},
    ...overrides,
  };
}

function view(overrides: Partial<ApiFeaturesView> = {}): ApiFeaturesView {
  return { groups: [], ungrouped: [], ...overrides };
}

/* -------------------------------------------------------------------------- */
/* Doble de fetch                                                             */
/* -------------------------------------------------------------------------- */

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

interface FetchDouble {
  calls: RecordedCall[];
  fetch: typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Registra cada peticion y responde con lo que le indique la prueba. */
function fetchDouble(reply: (call: RecordedCall) => Response | Promise<Response>): FetchDouble {
  const calls: RecordedCall[] = [];

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      headers[key.toLowerCase()] = String(value);
    }

    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    };

    calls.push(call);
    return await reply(call);
  };

  return { calls, fetch: impl as unknown as typeof fetch };
}

/* -------------------------------------------------------------------------- */
/* Estado                                                                     */
/* -------------------------------------------------------------------------- */

describe('carga del estado de caracteristicas', () => {
  it('1. conserva el orden de los grupos que devuelve la API', () => {
    const state = stateFromApi(
      view({
        groups: [
          { id: 7, sortOrder: 0, names: { es: 'Terreno' }, features: [] },
          { id: 3, sortOrder: 1, names: { es: 'Servicios' }, features: [] },
        ],
      }),
    );

    expect(state.groups.map((group) => group.id)).toEqual([7, 3]);
  });

  it('2. conserva el orden de las caracteristicas dentro del grupo', () => {
    const state = stateFromApi(
      view({
        groups: [
          {
            id: 1,
            sortOrder: 0,
            names: {},
            features: [
              apiFeature({ id: 9, groupId: 1, sortOrder: 0 }),
              apiFeature({ id: 2, groupId: 1, sortOrder: 1 }),
            ],
          },
        ],
      }),
    );

    expect(featuresOfGroup(state, 1).map((feature) => feature.id)).toEqual([9, 2]);
  });

  it('3. separa las caracteristicas sin grupo', () => {
    const state = stateFromApi(
      view({
        groups: [{ id: 1, sortOrder: 0, names: {}, features: [apiFeature({ id: 5, groupId: 1 })] }],
        ungrouped: [apiFeature({ id: 8 })],
      }),
    );

    expect(ungroupedFeatures(state).map((feature) => feature.id)).toEqual([8]);
    expect(featuresOfGroup(state, 1).map((feature) => feature.id)).toEqual([5]);
  });

  it('4. convierte los textos ausentes en cadena vacia, no en "null"', () => {
    const state = stateFromApi(
      view({
        ungrouped: [apiFeature({ id: 1, translations: { es: { label: 'Vista', value: null } } })],
      }),
    );

    const entry = state.features[0];
    expect(entry?.draft.labelEs).toBe('Vista');
    expect(entry?.draft.valueEs).toBe('');
    expect(entry?.draft.labelEn).toBe('');
  });

  it('5. todo lo recien cargado esta guardado', () => {
    const state = stateFromApi(
      view({
        groups: [{ id: 1, sortOrder: 0, names: { es: 'Terreno' }, features: [] }],
        ungrouped: [apiFeature({ id: 2 })],
      }),
    );

    expect(hasPendingFeatureWork(state)).toBe(false);
  });

  it('6. una propiedad sin grupos ni caracteristicas esta vacia', () => {
    expect(isEmpty(stateFromApi(view()))).toBe(true);
    expect(isEmpty(stateFromApi(view({ ungrouped: [apiFeature()] })))).toBe(false);
  });
});

describe('cambios pendientes por entidad', () => {
  const state = () =>
    stateFromApi(
      view({
        groups: [
          {
            id: 1,
            sortOrder: 0,
            names: { es: 'Terreno', en: 'Land' },
            features: [
              apiFeature({
                id: 4,
                groupId: 1,
                translations: { es: { label: 'Área', value: '500' } },
              }),
            ],
          },
        ],
      }),
    );

  it('7. cambiar el nombre en espanol marca el grupo como sucio', () => {
    const group = state().groups[0]!;
    group.draft.nameEs = 'Terreno y acceso';

    expect(isGroupDirty(group)).toBe(true);
  });

  it('8. cambiar solo el nombre en ingles tambien cuenta', () => {
    const group = state().groups[0]!;
    group.draft.nameEn = 'Land and access';

    expect(isGroupDirty(group)).toBe(true);
  });

  it('9. volver al valor original deja de contar como cambio', () => {
    const group = state().groups[0]!;
    group.draft.nameEs = 'Otro';
    group.draft.nameEs = 'Terreno';

    expect(isGroupDirty(group)).toBe(false);
  });

  it('10. cambiar una etiqueta marca la caracteristica como sucia', () => {
    const feature = state().features[0]!;
    feature.draft.labelEs = 'Superficie';

    expect(isFeatureDirty(feature)).toBe(true);
  });

  it('11. cambiar el grupo elegido marca la caracteristica como sucia', () => {
    const feature = state().features[0]!;
    feature.draft.groupId = null;

    expect(isFeatureDirty(feature)).toBe(true);
  });

  it('12. hay trabajo pendiente con un grupo sucio', () => {
    const current = state();
    current.groups[0]!.state = 'dirty';

    expect(hasPendingFeatureWork(current)).toBe(true);
  });

  it('13. hay trabajo pendiente con una caracteristica en error', () => {
    const current = state();
    current.features[0]!.state = 'error';

    expect(hasPendingFeatureWork(current)).toBe(true);
  });

  it('14. guardando tambien cuenta como trabajo pendiente', () => {
    const current = state();
    current.features[0]!.state = 'saving';

    expect(hasPendingFeatureWork(current)).toBe(true);
  });
});

describe('nombre visible del grupo', () => {
  it('15. usa el espanol cuando existe', () => {
    expect(groupDisplayName({ nameEs: 'Terreno', nameEn: 'Land' })).toEqual({
      text: 'Terreno',
      missingSpanish: false,
    });
  });

  it('16. cae al ingles y avisa de que falta el espanol', () => {
    expect(groupDisplayName({ nameEs: '', nameEn: 'Land' })).toEqual({
      text: 'Land',
      missingSpanish: true,
    });
  });

  it('17. sin ningun nombre muestra un texto neutro', () => {
    expect(groupDisplayName({ nameEs: '', nameEn: '' })).toEqual({
      text: 'Grupo sin nombre',
      missingSpanish: false,
    });
  });

  it('18. los espacios en blanco no cuentan como nombre', () => {
    expect(groupDisplayName({ nameEs: '   ', nameEn: '  ' }).text).toBe('Grupo sin nombre');
  });
});

describe('parches enviados a la API', () => {
  it('19. el parche del grupo lleva solo los nombres', () => {
    const group = addGroup({ groups: [], features: [] }, { id: 1, sortOrder: 0 });
    group.draft.nameEs = 'Terreno';

    expect(groupPatch(group)).toEqual({ nameEs: 'Terreno', nameEn: '' });
  });

  it('20. el parche de la caracteristica lleva grupo y textos, sin orden', () => {
    const feature = addFeature(
      { groups: [], features: [] },
      { id: 3, sortOrder: 2, groupId: null },
    );
    feature.draft.labelEs = 'Vista';

    const patch = featurePatch(feature);

    expect(patch).toEqual({
      groupId: null,
      labelEs: 'Vista',
      valueEs: '',
      labelEn: '',
      valueEn: '',
    });
    expect(patch).not.toHaveProperty('sortOrder');
  });

  it('21. ningun parche incluye la propiedad: la marca la URL', () => {
    const group = addGroup({ groups: [], features: [] }, { id: 1, sortOrder: 0 });
    const feature = addFeature({ groups: [], features: [] }, { id: 1, sortOrder: 0, groupId: 1 });

    expect(groupPatch(group)).not.toHaveProperty('propertyId');
    expect(featurePatch(feature)).not.toHaveProperty('propertyId');
  });
});

describe('consolidacion y borrado', () => {
  it('22. guardar un grupo consolida lo escrito', () => {
    const group = addGroup({ groups: [], features: [] }, { id: 1, sortOrder: 0 });
    group.draft.nameEs = 'Terreno';
    group.state = 'dirty';

    markGroupSaved(group);

    expect(group.loaded.nameEs).toBe('Terreno');
    expect(isGroupDirty(group)).toBe(false);
    expect(group.state).toBe('saved');
  });

  it('23. la caracteristica solo cambia de grupo cuando el guardado sale bien', () => {
    const state = stateFromApi(
      view({
        groups: [{ id: 1, sortOrder: 0, names: {}, features: [apiFeature({ id: 5, groupId: 1 })] }],
      }),
    );

    const feature = state.features[0]!;
    feature.draft.groupId = null;

    // Antes de guardar sigue contando dentro de su grupo.
    expect(featuresOfGroup(state, 1).map((entry) => entry.id)).toEqual([5]);
    expect(ungroupedFeatures(state)).toHaveLength(0);

    markFeatureSaved(feature);

    expect(featuresOfGroup(state, 1)).toHaveLength(0);
    expect(ungroupedFeatures(state).map((entry) => entry.id)).toEqual([5]);
  });

  it('24. borrar un grupo NO borra sus caracteristicas: pasan a sin grupo', () => {
    const state = stateFromApi(
      view({
        groups: [
          {
            id: 1,
            sortOrder: 0,
            names: {},
            features: [apiFeature({ id: 5, groupId: 1 }), apiFeature({ id: 6, groupId: 1 })],
          },
        ],
      }),
    );

    removeGroup(state, 1);

    expect(state.groups).toHaveLength(0);
    expect(state.features).toHaveLength(2);
    expect(ungroupedFeatures(state).map((entry) => entry.id)).toEqual([5, 6]);
  });

  it('25. borrar un grupo limpia tambien el grupo elegido en el borrador', () => {
    const state = stateFromApi(
      view({
        groups: [{ id: 1, sortOrder: 0, names: {}, features: [apiFeature({ id: 5, groupId: 1 })] }],
      }),
    );

    removeGroup(state, 1);

    expect(state.features[0]?.draft.groupId).toBeNull();
    expect(isFeatureDirty(state.features[0]!)).toBe(false);
  });

  it('26. borrar una caracteristica solo quita esa', () => {
    const state = stateFromApi(view({ ungrouped: [apiFeature({ id: 1 }), apiFeature({ id: 2 })] }));

    removeFeature(state, 1);

    expect(state.features.map((entry) => entry.id)).toEqual([2]);
  });

  it('27. lo recien creado aparece vacio y sin cambios pendientes', () => {
    const state: ReturnType<typeof stateFromApi> = { groups: [], features: [] };
    const group = addGroup(state, { id: 4, sortOrder: 0 });
    const feature = addFeature(state, { id: 9, sortOrder: 0, groupId: 4 });

    expect(group.draft).toEqual({ nameEs: '', nameEn: '' });
    expect(feature.draft.groupId).toBe(4);
    expect(hasPendingFeatureWork(state)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Cliente de la API                                                          */
/* -------------------------------------------------------------------------- */

describe('cliente de la API de caracteristicas', () => {
  it('28. carga desde el endpoint de la propiedad', async () => {
    const double = fetchDouble(() => jsonResponse({ data: view() }));
    const result = await createFeatureApi(12, double.fetch).load();

    expect(result.ok).toBe(true);
    expect(double.calls[0]?.url).toBe('/api/admin/properties/12/features');
    expect(double.calls[0]?.method).toBe('GET');
  });

  it('29. un fallo de carga devuelve el mensaje de la seccion', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'internal_error' } }, 500));
    const result = await createFeatureApi(1, double.fetch).load();

    expect(result).toEqual({ ok: false, message: 'No pudimos cargar las características.' });
  });

  it('30. sin red tampoco se filtra el detalle tecnico', async () => {
    const double = fetchDouble(() => {
      throw new Error('ECONNREFUSED 127.0.0.1:8788');
    });
    const result = await createFeatureApi(1, double.fetch).load();

    expect(result).toEqual({ ok: false, message: 'No pudimos cargar las características.' });
  });

  it('31. crear un grupo hace POST con cuerpo JSON', async () => {
    const double = fetchDouble(() => jsonResponse({ data: { id: 3, sortOrder: 0 } }, 201));
    const result = await createFeatureApi(7, double.fetch).createGroup();

    expect(result).toEqual({ ok: true, data: { id: 3, sortOrder: 0 } });
    expect(double.calls[0]?.url).toBe('/api/admin/properties/7/feature-groups');
    expect(double.calls[0]?.method).toBe('POST');
    expect(double.calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('32. dos pulsaciones seguidas no crean dos grupos', async () => {
    // El ejecutor corre de inmediato, asi que `release` queda asignado.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const double = fetchDouble(async () => {
      await held;
      return jsonResponse({ data: { id: 1, sortOrder: 0 } }, 201);
    });

    const api = createFeatureApi(1, double.fetch);
    const first = api.createGroup();
    const second = await api.createGroup();

    expect(second).toBeNull();

    release();
    await first;

    expect(double.calls).toHaveLength(1);
  });

  it('33. crear una caracteristica suelta envia groupId nulo', async () => {
    const double = fetchDouble(() =>
      jsonResponse({ data: { id: 4, sortOrder: 0, groupId: null } }, 201),
    );

    await createFeatureApi(2, double.fetch).createFeature(null);

    expect(double.calls[0]?.url).toBe('/api/admin/properties/2/features');
    expect(double.calls[0]?.body).toBe(JSON.stringify({ groupId: null }));
  });

  it('34. crear dentro de un grupo envia ese grupo', async () => {
    const double = fetchDouble(() =>
      jsonResponse({ data: { id: 4, sortOrder: 0, groupId: 5 } }, 201),
    );

    await createFeatureApi(2, double.fetch).createFeature(5);

    expect(double.calls[0]?.body).toBe(JSON.stringify({ groupId: 5 }));
  });

  it('35. guardar un grupo hace PATCH con el parche recibido', async () => {
    const double = fetchDouble(() => jsonResponse({ data: { id: 3 } }));

    await createFeatureApi(2, double.fetch).updateGroup(3, { nameEs: 'Terreno', nameEn: '' });

    expect(double.calls[0]?.url).toBe('/api/admin/properties/2/feature-groups/3');
    expect(double.calls[0]?.method).toBe('PATCH');
    expect(double.calls[0]?.body).toBe(JSON.stringify({ nameEs: 'Terreno', nameEn: '' }));
  });

  it('36. borrar un grupo envia content-type JSON (proteccion CSRF de Astro)', async () => {
    const double = fetchDouble(() => jsonResponse({ data: { id: 3 } }));

    await createFeatureApi(2, double.fetch).deleteGroup(3);

    expect(double.calls[0]?.method).toBe('DELETE');
    expect(double.calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('37. borrar una caracteristica tambien envia content-type JSON', async () => {
    const double = fetchDouble(() => jsonResponse({ data: { id: 4 } }));

    await createFeatureApi(2, double.fetch).deleteFeature(4);

    expect(double.calls[0]?.url).toBe('/api/admin/properties/2/features/4');
    expect(double.calls[0]?.method).toBe('DELETE');
    expect(double.calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('38. una caracteristica que ya no existe se explica al administrador', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'feature_not_found' } }, 404));
    const result = await createFeatureApi(1, double.fetch).updateFeature(9, {});

    expect(result).toEqual({ ok: false, message: 'Esta característica ya no existe.' });
  });

  it('39. un grupo que ya no existe se explica al administrador', async () => {
    const double = fetchDouble(() =>
      jsonResponse({ error: { code: 'feature_group_not_found' } }, 404),
    );
    const result = await createFeatureApi(1, double.fetch).updateGroup(9, {});

    expect(result).toEqual({ ok: false, message: 'Este grupo ya no existe.' });
  });

  it('40. un grupo de otra propiedad se explica sin tecnicismos', async () => {
    const double = fetchDouble(() =>
      jsonResponse({ error: { code: 'feature_group_property_mismatch' } }, 422),
    );
    const result = await createFeatureApi(1, double.fetch).updateFeature(9, { groupId: 4 });

    expect(result).toEqual({
      ok: false,
      message: 'El grupo seleccionado no pertenece a esta propiedad.',
    });
  });

  it('41. sin acceso al panel el mensaje es el mismo en cualquier accion', async () => {
    const double = fetchDouble(() => new Response('', { status: 403 }));
    const api = createFeatureApi(1, double.fetch);

    expect(await api.updateGroup(1, {})).toEqual({
      ok: false,
      message: 'No tienes acceso al panel administrativo.',
    });
    expect(await api.deleteFeature(1)).toEqual({
      ok: false,
      message: 'No tienes acceso al panel administrativo.',
    });
  });

  it('42. un error desconocido usa el mensaje de su contexto', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'internal_error' } }, 500));
    const api = createFeatureApi(1, double.fetch);

    expect(await api.updateGroup(1, {})).toEqual({
      ok: false,
      message: 'No pudimos guardar el grupo.',
    });
    expect(await api.updateFeature(1, {})).toEqual({
      ok: false,
      message: 'No pudimos guardar la característica.',
    });
  });

  it('43. ningun mensaje visible menciona SQL, tablas ni codigos internos', () => {
    for (const message of Object.values(FEATURE_API_MESSAGES)) {
      expect(message).not.toMatch(/SQL|SQLITE|property_feature|D1|undefined/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Pagina y modulo                                                            */
/* -------------------------------------------------------------------------- */

describe('seccion de caracteristicas en el editor', () => {
  const page = read(EDITOR_PAGE);
  const script = read(FEATURE_SCRIPT);
  const editor = read(EDITOR_SCRIPT);

  it('44. la pagina anuncia la seccion con su encabezado y su explicacion', () => {
    expect(page).toContain('<h2 id="features-heading">Características</h2>');
    expect(page).toContain(
      'Añade datos personalizados como dormitorios, acceso, servicios, vistas',
    );
    expect(page).toContain('id="admin-features"');
  });

  it('45. la seccion va despues del contenido en ingles y fuera del formulario', () => {
    expect(page.indexOf('lang-en-heading')).toBeLessThan(page.indexOf('features-heading'));
    expect(page.indexOf('</form>')).toBeLessThan(page.indexOf('id="editor-features"'));
  });

  it('46. el editor solo muestra la seccion cuando la propiedad ha cargado', () => {
    expect(editor).toContain('if (!loaded) return;');
    expect(editor).toContain('initFeatureEditor(propertyId)');
  });

  it('47. un fallo de carga ofrece reintentar dentro de la seccion', () => {
    expect(script).toContain('data-action="retry-features"');
    expect(script).toContain('Reintentar');
    expect(script).toContain('loadError');
  });

  it('48. el estado vacio invita a crear grupo o caracteristica suelta', () => {
    expect(EMPTY_TEXT).toBe('Aún no hay características.');
    expect(script).toContain('data-action="add-group"');
    expect(script).toContain('data-action="add-loose-feature"');
    expect(LOADING_TEXT).toBe('Cargando características…');
  });

  it('49. borrar un grupo se confirma explicando que las caracteristicas se quedan', () => {
    expect(CONFIRM_DELETE_GROUP).toContain('Las características del grupo no se eliminarán');
    expect(CONFIRM_DELETE_GROUP).toContain('pasarán a "Sin grupo"');
    expect(script).toContain('window.confirm(CONFIRM_DELETE_GROUP)');
  });

  it('50. cada grupo y cada caracteristica tienen su propio guardado', () => {
    expect(script).toContain('Guardar grupo');
    expect(script).toContain('Guardar característica');
    expect(script).toContain('Eliminar grupo');
    expect(script).toContain('Eliminar característica');
  });

  it('51. el selector de grupo ofrece "Sin grupo" y no muestra identificadores', () => {
    expect(script).toContain('>Sin grupo</option>');
    expect(script).not.toMatch(/option[^>]*>\s*\$\{escapeHtml\(name\)\}\s*\(\$\{group\.id\}/);
  });

  it('52. cambiar el selector solo toca el borrador', () => {
    expect(script).toContain('entry.draft.groupId = value === ');
    expect(script).toContain('la tarjeta no se mueve hasta guardar');
  });

  it('53. se edita con campos, nunca con una tabla', () => {
    expect(script).not.toContain('<table');
    expect(script).not.toContain('<td');
    expect(read(ADMIN_CSS)).toContain('.feature-grid');
  });

  it('54. en esta subfase no hay reordenacion', () => {
    for (const word of ['Subir', 'Bajar', 'Mover', 'reorder', 'Reordenar']) {
      expect(script).not.toContain(word);
    }
  });

  it('55. cada campo lleva su etiqueta y marca los errores', () => {
    expect(script).toContain('<label for="feature-${id}-label-es">Etiqueta en español</label>');
    expect(script).toContain('<label for="feature-${id}-group">Grupo</label>');
    expect(script).toContain('aria-invalid="${invalid}"');
  });

  it('56. el foco va al primer campo de lo recien creado', () => {
    expect(script).toContain('focusField(`group-${entry.id}-name-es`)');
    expect(script).toContain('focusField(`feature-${entry.id}-label-es`)');
  });

  it('57. los encabezados encajan: h2 la seccion, h3 cada grupo', () => {
    expect(page).toContain('<h2 id="features-heading">');
    expect(script).toContain('<h3 class="feature-group-title"');
    expect(script).toContain('id="ungrouped-heading">Sin grupo</h3>');
  });

  it('58. el aviso de salida suma las caracteristicas sin sustituir al coordinador', () => {
    expect(editor).toContain('features?.hasPendingWork() === true');
    expect(editor).toContain('coordinator?.snapshot().hasPendingWork === true');
  });

  it('59. el boton global sigue guardando solo nucleo, espanol e ingles', () => {
    expect(editor).toContain(
      "ports: { core: corePort, es: translationPort('es'), en: translationPort('en') }",
    );
    expect(editor).not.toContain('saveGroup');
    expect(editor).not.toContain('saveFeature');
  });

  it('60. la seccion habla siempre con la API, nunca con la base de datos', () => {
    for (const source of [script, read(FEATURE_API)]) {
      expect(source).not.toContain('drizzle');
      expect(source).not.toContain('cloudflare:workers');
      expect(source).toMatch(/\/api\/admin\/|feature-api/);
    }
  });

  it('61. la seccion se adapta a movil con una sola columna', () => {
    const css = read(ADMIN_CSS);
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('62. sin contenedor en la pagina el modulo no hace nada', () => {
    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { getElementById: () => null };

    try {
      expect(initFeatureEditor(1).hasPendingWork()).toBe(false);
    } finally {
      (globalThis as { document?: unknown }).document = previous;
    }
  });

  it('63. no se han anadido dependencias para probar el navegador', () => {
    const manifest = read('package.json');
    for (const forbidden of ['playwright', 'jsdom', 'happy-dom', 'puppeteer', 'cypress']) {
      expect(manifest).not.toContain(forbidden);
    }
  });
});
