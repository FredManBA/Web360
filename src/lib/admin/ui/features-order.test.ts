/**
 * Tests del autosave unificado y del orden de caracteristicas.
 *
 * Tres frentes: el coordinador con puertos dinamicos (temporizadores
 * simulados, sin DOM ni red), las funciones puras de orden, y el cliente de
 * reordenacion con `fetch` inyectado. El cableado de DOM se comprueba sobre el
 * fuente, como en el resto del panel: no hay navegador en los tests.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFeatureApi } from './feature-api';
import {
  applyFeatureOrder,
  applyGroupOrder,
  featureOrder,
  groupOrder,
  markFeatureSaved,
  moveAvailability,
  moveFeature,
  moveGroup,
  stateFromApi,
  type ApiFeature,
  type ApiFeaturesView,
} from './feature-editor-state';
import {
  createSaveCoordinator,
  DEFAULT_DEBOUNCE_MS,
  featurePortKey,
  groupPortKey,
  type PersistResult,
  type SaveGroupPort,
} from './save-coordinator';

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const FEATURE_SCRIPT = 'src/lib/admin/ui/feature-editor.ts';
const EDITOR_SCRIPT = 'src/lib/admin/ui/editor-page.ts';
const COORDINATOR = 'src/lib/admin/ui/save-coordinator.ts';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Puerto controlable: se decide cuando responde y con que. */
function makePort(options: { dirty?: boolean } = {}) {
  let dirty = options.dirty ?? false;
  let calls = 0;
  let pending: ((result: PersistResult) => void) | null = null;
  let auto: PersistResult | null = { ok: true };

  const port: SaveGroupPort = {
    isDirty: () => dirty,
    validate: () => [],
    persist: () => {
      calls += 1;

      if (auto !== null) {
        const result = auto;
        if (result.ok) dirty = false;
        return Promise.resolve(result);
      }

      return new Promise<PersistResult>((resolve) => {
        pending = (result) => {
          if (result.ok) dirty = false;
          resolve(result);
        };
      });
    },
  };

  return {
    port,
    get calls() {
      return calls;
    },
    setDirty(value: boolean) {
      dirty = value;
    },
    hold() {
      auto = null;
    },
    setOutcome(result: PersistResult) {
      auto = result;
    },
    resolve(result: PersistResult) {
      pending?.(result);
      pending = null;
    },
  };
}

function setup() {
  const core = makePort();
  const es = makePort();
  const en = makePort();

  const coordinator = createSaveCoordinator({
    ports: { core: core.port, es: es.port, en: en.port },
    onErrors: () => undefined,
    onChange: () => undefined,
  });

  return { coordinator, core, es, en };
}

function apiFeature(overrides: Partial<ApiFeature> = {}): ApiFeature {
  return { id: 1, groupId: null, sortOrder: 0, translations: {}, ...overrides };
}

function view(overrides: Partial<ApiFeaturesView> = {}): ApiFeaturesView {
  return { groups: [], ungrouped: [], ...overrides };
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchDouble(reply: (call: RecordedCall) => Response) {
  const calls: RecordedCall[] = [];

  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
    return Promise.resolve(reply(call));
  };

  return { calls, fetch: impl as unknown as typeof fetch };
}

/* -------------------------------------------------------------------------- */
/* Coordinador con puertos dinamicos                                          */
/* -------------------------------------------------------------------------- */

describe('puertos dinamicos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('(1) el coordinador arranca con los tres fijos y acepta mas', () => {
    const { coordinator } = setup();

    expect(coordinator.registered()).toEqual(['core', 'es', 'en']);

    coordinator.register(groupPortKey(4), makePort().port);

    expect(coordinator.registered()).toEqual(['core', 'es', 'en', 'group:4']);
  });

  it('(2) registrar un grupo usa su id real', () => {
    const { coordinator } = setup();
    coordinator.register(groupPortKey(12), makePort().port);

    expect(coordinator.registered()).toContain('group:12');
    expect(coordinator.snapshot().groups['group:12']).toBe('clean');
  });

  it('(3) registrar una caracteristica usa su id real', () => {
    const { coordinator } = setup();
    coordinator.register(featurePortKey(9), makePort({ dirty: true }).port);

    // Si nace sucia, entra ya como pendiente.
    expect(coordinator.snapshot().groups['feature:9']).toBe('dirty');
  });

  it('(4) darlo de baja lo saca del estado global', () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });

    coordinator.register(featurePortKey(9), feature.port);
    coordinator.notifyChange(featurePortKey(9));
    expect(coordinator.snapshot().global).toBe('dirty');

    coordinator.unregister(featurePortKey(9));

    expect(coordinator.registered()).not.toContain('feature:9');
    expect(coordinator.snapshot().global).toBe('saved');
  });

  it('un puerto no registrado no puede notificar cambios', () => {
    const { coordinator } = setup();

    coordinator.notifyChange(featurePortKey(404));

    expect(coordinator.snapshot().groups['feature:404']).toBeUndefined();
    expect(coordinator.snapshot().global).toBe('saved');
  });

  it('(5) un grupo se guarda solo al pasar el debounce', async () => {
    const { coordinator } = setup();
    const group = makePort({ dirty: true });
    coordinator.register(groupPortKey(3), group.port);

    coordinator.notifyChange(groupPortKey(3));
    expect(group.calls).toBe(0);

    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(group.calls).toBe(1);
    expect(coordinator.snapshot().groups['group:3']).toBe('clean');
  });

  it('(6) una caracteristica se guarda por el mismo camino', async () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });
    coordinator.register(featurePortKey(7), feature.port);

    coordinator.notifyChange(featurePortKey(7));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(feature.calls).toBe(1);
  });

  it('(7) varias teclas seguidas producen un solo guardado', async () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });
    coordinator.register(featurePortKey(7), feature.port);

    coordinator.notifyChange(featurePortKey(7));
    await vi.advanceTimersByTimeAsync(300);
    coordinator.notifyChange(featurePortKey(7));
    await vi.advanceTimersByTimeAsync(300);
    coordinator.notifyChange(featurePortKey(7));

    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(feature.calls).toBe(1);
  });

  it('(8) core, ES y una caracteristica se escriben en serie, nunca a la vez', async () => {
    const { coordinator, core, es } = setup();
    const feature = makePort({ dirty: true });
    coordinator.register(featurePortKey(5), feature.port);

    core.setDirty(true);
    es.setDirty(true);
    core.hold();

    coordinator.notifyChange('core');
    coordinator.notifyChange('es');
    coordinator.notifyChange(featurePortKey(5));

    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    // Core esta retenido: nadie mas ha escrito todavia.
    expect(core.calls).toBe(1);
    expect(es.calls).toBe(0);
    expect(feature.calls).toBe(0);

    core.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(es.calls).toBe(1);
    expect(feature.calls).toBe(1);
  });

  it('(9) lo escrito durante la peticion sigue pendiente', async () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });
    coordinator.register(featurePortKey(5), feature.port);

    feature.hold();
    coordinator.notifyChange(featurePortKey(5));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    // El usuario sigue escribiendo mientras la peticion esta en vuelo.
    coordinator.notifyChange(featurePortKey(5));

    feature.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.snapshot().groups['feature:5']).toBe('dirty');
  });

  it('(10) un fallo de caracteristica no impide guardar el nucleo', async () => {
    const { coordinator, core } = setup();
    const feature = makePort({ dirty: true });
    feature.setOutcome({ ok: false });
    coordinator.register(featurePortKey(5), feature.port);

    core.setDirty(true);
    coordinator.notifyChange('core');
    coordinator.notifyChange(featurePortKey(5));

    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(coordinator.snapshot().groups.core).toBe('clean');
    expect(coordinator.snapshot().groups['feature:5']).toBe('error');
  });

  it('(11) un fallo no reintenta por su cuenta', async () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });
    feature.setOutcome({ ok: false });
    coordinator.register(featurePortKey(5), feature.port);

    coordinator.notifyChange(featurePortKey(5));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(feature.calls).toBe(1);

    // Diez segundos despues sigue sin haberlo intentado de nuevo.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(feature.calls).toBe(1);
  });

  it('un cambio nuevo permite reintentar lo que fallo', async () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });
    feature.setOutcome({ ok: false });
    coordinator.register(featurePortKey(5), feature.port);

    coordinator.notifyChange(featurePortKey(5));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    coordinator.notifyChange(featurePortKey(5));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(feature.calls).toBe(2);
  });

  it('(12) el boton global guarda tambien las caracteristicas', async () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });
    coordinator.register(featurePortKey(5), feature.port);

    // Sin esperar al debounce y sin haber notificado nada.
    await coordinator.saveNow();

    expect(feature.calls).toBe(1);
  });

  it('(13) el boton global guarda tambien los grupos', async () => {
    const { coordinator } = setup();
    const group = makePort({ dirty: true });
    coordinator.register(groupPortKey(2), group.port);

    await coordinator.saveNow();

    expect(group.calls).toBe(1);
  });

  it('(16) el estado global no dice "Guardado" con una caracteristica sucia', () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });
    coordinator.register(featurePortKey(5), feature.port);
    coordinator.notifyChange(featurePortKey(5));

    expect(coordinator.snapshot().global).toBe('dirty');
  });

  it('(16) tampoco lo dice si una caracteristica quedo en error', async () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });
    feature.setOutcome({ ok: false });
    coordinator.register(featurePortKey(5), feature.port);

    coordinator.notifyChange(featurePortKey(5));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(coordinator.snapshot().global).toBe('error');
  });

  it('(17) el trabajo pendiente de una caracteristica cuenta para el aviso de salida', () => {
    const { coordinator } = setup();
    expect(coordinator.snapshot().hasPendingWork).toBe(false);

    const feature = makePort({ dirty: true });
    coordinator.register(featurePortKey(5), feature.port);
    coordinator.notifyChange(featurePortKey(5));

    expect(coordinator.snapshot().hasPendingWork).toBe(true);
  });

  it('una entidad eliminada durante su escritura no revive', async () => {
    const { coordinator } = setup();
    const feature = makePort({ dirty: true });
    coordinator.register(featurePortKey(5), feature.port);

    feature.hold();
    coordinator.notifyChange(featurePortKey(5));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    coordinator.unregister(featurePortKey(5));
    feature.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.snapshot().groups['feature:5']).toBeUndefined();
    expect(coordinator.snapshot().global).toBe('saved');
  });
});

/* -------------------------------------------------------------------------- */
/* Orden: funciones puras                                                     */
/* -------------------------------------------------------------------------- */

describe('calculo del orden', () => {
  const withGroups = () =>
    stateFromApi(
      view({
        groups: [
          { id: 1, sortOrder: 0, names: { es: 'A' }, features: [] },
          { id: 2, sortOrder: 1, names: { es: 'B' }, features: [] },
          { id: 3, sortOrder: 2, names: { es: 'C' }, features: [] },
        ],
      }),
    );

  const withFeatures = () =>
    stateFromApi(
      view({
        groups: [
          {
            id: 1,
            sortOrder: 0,
            names: {},
            features: [
              apiFeature({ id: 10, groupId: 1, sortOrder: 0 }),
              apiFeature({ id: 11, groupId: 1, sortOrder: 1 }),
              apiFeature({ id: 12, groupId: 1, sortOrder: 2 }),
            ],
          },
        ],
        ungrouped: [apiFeature({ id: 20 }), apiFeature({ id: 21 })],
      }),
    );

  it('(21) subir un grupo lo intercambia con el anterior', () => {
    expect(moveGroup(withGroups(), 3, 'up')).toEqual([1, 3, 2]);
  });

  it('(21) bajar un grupo lo intercambia con el siguiente', () => {
    expect(moveGroup(withGroups(), 1, 'down')).toEqual([2, 1, 3]);
  });

  it('(23) el primero no puede subir y el ultimo no puede bajar', () => {
    const state = withGroups();

    expect(moveGroup(state, 1, 'up')).toBeNull();
    expect(moveGroup(state, 3, 'down')).toBeNull();
  });

  it('(23) los botones se deshabilitan justo en esos extremos', () => {
    const ids = [1, 2, 3];

    expect(moveAvailability(ids, 1)).toEqual({ canMoveUp: false, canMoveDown: true });
    expect(moveAvailability(ids, 2)).toEqual({ canMoveUp: true, canMoveDown: true });
    expect(moveAvailability(ids, 3)).toEqual({ canMoveUp: true, canMoveDown: false });
  });

  it('(23) un unico elemento no puede moverse en ninguna direccion', () => {
    expect(moveAvailability([7], 7)).toEqual({ canMoveUp: false, canMoveDown: false });
  });

  it('(22) subir una caracteristica solo afecta a su ambito', () => {
    const state = withFeatures();

    expect(moveFeature(state, 12, 'up')).toEqual({ groupId: 1, featureIds: [10, 12, 11] });
  });

  it('(22) las caracteristicas sin grupo se ordenan entre ellas', () => {
    const state = withFeatures();

    expect(moveFeature(state, 21, 'up')).toEqual({ groupId: null, featureIds: [21, 20] });
  });

  it('(22) una caracteristica no puede saltar a otro grupo con Subir/Bajar', () => {
    const state = withFeatures();

    // La primera de su grupo no sube al grupo anterior: simplemente no sube.
    expect(moveFeature(state, 10, 'up')).toBeNull();
  });

  it('aplicar el orden de grupos renumera las posiciones', () => {
    const state = withGroups();

    applyGroupOrder(state, [3, 1, 2]);

    expect(groupOrder(state)).toEqual([3, 1, 2]);
    expect(state.groups.map((group) => group.sortOrder)).toEqual([0, 1, 2]);
  });

  it('aplicar el orden de un ambito deja intacto el resto', () => {
    const state = withFeatures();

    applyFeatureOrder(state, null, [21, 20]);

    expect(featureOrder(state, null)).toEqual([21, 20]);
    expect(featureOrder(state, 1)).toEqual([10, 11, 12]);
  });

  it('(35) mover de grupo con el select no cambia nada hasta que el PATCH va bien', () => {
    const state = withFeatures();
    const feature = state.features.find((entry) => entry.id === 20);
    if (feature === undefined) throw new Error('setup');

    feature.draft.groupId = 1;

    // Todavia se ve donde estaba.
    expect(featureOrder(state, null)).toEqual([20, 21]);
    expect(featureOrder(state, 1)).toEqual([10, 11, 12]);

    // El servidor confirma y ademas dice en que posicion queda.
    markFeatureSaved(feature, { ...feature.draft }, 3);

    expect(featureOrder(state, null)).toEqual([21]);
    expect(featureOrder(state, 1)).toEqual([10, 11, 12, 20]);
    expect(feature.sortOrder).toBe(3);
  });

  it('(34) el select sigue siendo la via para mover entre grupos', () => {
    const script = read(FEATURE_SCRIPT);

    expect(script).toContain('data-field="groupId"');
    expect(script).toContain("entry.draft.groupId = value === '' ? null : Number(value)");
    expect(script).toContain('markFeatureSaved(current, snapshot, result.data.sortOrder)');
  });
});

/* -------------------------------------------------------------------------- */
/* Cliente de reordenacion                                                    */
/* -------------------------------------------------------------------------- */

describe('cliente de reordenacion', () => {
  it('(24) envia todos los grupos en una sola peticion', async () => {
    const double = fetchDouble(() => jsonResponse({ data: { groupIds: [3, 1] } }));

    const result = await createFeatureApi(7, double.fetch).reorderGroups([3, 1]);

    expect(result.ok).toBe(true);
    expect(double.calls).toHaveLength(1);
    expect(double.calls[0]?.url).toBe('/api/admin/properties/7/feature-groups/order');
    expect(double.calls[0]?.method).toBe('PUT');
    expect(double.calls[0]?.body).toBe(JSON.stringify({ groupIds: [3, 1] }));
  });

  it('(25) envia el ambito completo de un grupo', async () => {
    const double = fetchDouble(() => jsonResponse({ data: {} }));

    await createFeatureApi(7, double.fetch).reorderFeatures(3, [8, 4, 7]);

    expect(double.calls[0]?.url).toBe('/api/admin/properties/7/features/order');
    expect(double.calls[0]?.body).toBe(JSON.stringify({ groupId: 3, featureIds: [8, 4, 7] }));
  });

  it('(26) "Sin grupo" viaja como groupId nulo explicito', async () => {
    const double = fetchDouble(() => jsonResponse({ data: {} }));

    await createFeatureApi(7, double.fetch).reorderFeatures(null, [2, 1]);

    expect(double.calls[0]?.body).toBe(JSON.stringify({ groupId: null, featureIds: [2, 1] }));
  });

  it('(36) un conflicto de orden se explica sin filtrar detalles tecnicos', async () => {
    const double = fetchDouble(() =>
      jsonResponse({ error: { code: 'feature_order_conflict' } }, 409),
    );

    const result = await createFeatureApi(1, double.fetch).reorderGroups([1, 2]);

    expect(result).toEqual({
      ok: false,
      message: 'El orden ha cambiado. Vuelve a cargar la página para continuar.',
    });
  });

  it('(36) cualquier otro fallo usa un mensaje generico', async () => {
    const double = fetchDouble(() => jsonResponse({ error: { code: 'internal_error' } }, 500));

    const result = await createFeatureApi(1, double.fetch).reorderFeatures(null, [1]);

    expect(result).toEqual({ ok: false, message: 'No pudimos cambiar el orden.' });
  });
});

/* -------------------------------------------------------------------------- */
/* Cableado de la seccion                                                     */
/* -------------------------------------------------------------------------- */

describe('integracion de la seccion', () => {
  const script = read(FEATURE_SCRIPT);
  const editor = read(EDITOR_SCRIPT);

  it('(14) ya no hay boton "Guardar grupo"', () => {
    expect(script).not.toContain('Guardar grupo');
    expect(script).not.toContain('data-action="save-group"');
  });

  it('(15) ya no hay boton "Guardar característica"', () => {
    expect(script).not.toContain('Guardar característica');
    expect(script).not.toContain('data-action="save-feature"');
  });

  it('cada entidad conserva su estado en texto', () => {
    expect(script).toContain('saveStateLabel(entryState)');
    expect(script).toContain('class="feature-status-box"');
  });

  it('(18) crear registra el puerto con el id que devuelve el servidor', () => {
    expect(script).toContain('const entry = addGroup(state, result.data);\n    registerGroupPort(');
    expect(script).toContain(
      'const entry = addFeature(state, result.data);\n    registerFeaturePort(',
    );
  });

  it('(19) eliminar da de baja su puerto', () => {
    expect(script).toContain('coordinator.unregister(groupPortKey(entry.id))');
    expect(script).toContain('coordinator.unregister(featurePortKey(entry.id))');
  });

  it('(20) al borrar un grupo, sus caracteristicas conservan puerto y borrador', () => {
    // Se da de baja el puerto del grupo, nunca los de sus caracteristicas.
    expect(script).toContain('removeGroup(state, entry.id)');
    expect(script).not.toContain('unregisterFeaturesOf');
    expect(read('src/lib/admin/ui/feature-editor-state.ts')).toContain(
      'Sus caracteristicas NO se borran',
    );
  });

  it('crear y eliminar quedan fuera del debounce', () => {
    expect(script).toContain('Crear y eliminar (fuera del debounce, siempre inmediatas)');
    expect(script).toContain('await api.createGroup()');
    expect(script).toContain('await api.deleteGroup(entry.id)');
  });

  it('borrar con cambios sin guardar lo advierte', () => {
    expect(script).toContain('Tiene cambios sin guardar que se perderán.');
    expect(script).toContain('deleteGroupMessage(isGroupDirty(entry))');
    expect(script).toContain('deleteFeatureMessage(isFeatureDirty(entry))');
  });

  it('(12)(13) el editor no tiene un segundo camino de guardado', () => {
    // Un unico `saveNow`, el del envio del formulario.
    expect(editor.match(/saveNow\(\)/g)).toHaveLength(1);
    expect(read(COORDINATOR)).toContain('register');
  });

  it('la reordenacion espera al servidor antes de mover nada', () => {
    expect(script).toContain('const result = await api.reorderGroups(next);');
    expect(script).toContain('applyGroupOrder(state, next);');
    // El orden solo se aplica dentro de la rama de exito.
    expect(script.indexOf('const result = await api.reorderGroups(next);')).toBeLessThan(
      script.indexOf('applyGroupOrder(state, next);'),
    );
  });

  it('mientras hay una reordenacion en vuelo, ese ambito queda inerte', () => {
    expect(script).toContain('reordering.add(GROUPS_SCOPE)');
    expect(script).toContain('reordering.delete(GROUPS_SCOPE)');
    expect(script).toContain('enabled && !busy');
  });

  it('el foco no se pierde despues de reordenar', () => {
    expect(script).toContain('focusAfterRender = `move-group-${groupId}-${direction}`');
    expect(script).toContain('focusAfterRender = `move-feature-${featureId}-${direction}`');
    expect(script).toContain('restoreFocus');
  });

  it('los botones de orden dicen que mueven, no solo la direccion', () => {
    expect(script).toContain('aria-label="${escapeHtml(`${text} ${label}`)}"');
    expect(script).toContain('`grupo ${name.text}`');
    expect(script).toContain('`característica ${name}`');
  });

  it('no se han anadido dependencias', () => {
    const manifest = read('package.json');
    for (const forbidden of ['playwright', 'jsdom', 'happy-dom', 'sortablejs', 'dragula']) {
      expect(manifest).not.toContain(forbidden);
    }
  });
});
