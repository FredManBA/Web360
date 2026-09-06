/**
 * Tests del coordinador de guardado.
 *
 * Se prueban debounce, serializacion, instantaneas y fallos parciales con
 * puertos falsos y temporizadores simulados: ni DOM ni red.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSaveCoordinator,
  DEFAULT_DEBOUNCE_MS,
  type GroupFieldError,
  type PersistResult,
  type SaveGroup,
  type SaveGroupPort,
} from './save-coordinator';

/** Puerto controlable: se decide cuando responde y con que. */
function makePort(options: { dirty?: boolean; errors?: GroupFieldError[] } = {}) {
  let dirty = options.dirty ?? false;
  let localErrors = options.errors ?? [];
  let calls = 0;
  let pending: ((result: PersistResult) => void) | null = null;
  let auto: PersistResult | null = { ok: true };

  const port: SaveGroupPort = {
    isDirty: () => dirty,
    validate: () => localErrors,
    persist: () => {
      calls += 1;
      if (auto !== null) {
        // Al persistir bien, el puerto marca su instantanea como guardada.
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
    setErrors(value: GroupFieldError[]) {
      localErrors = value;
    },
    /** Deja la siguiente escritura pendiente hasta llamar a `resolve`. */
    hold() {
      auto = null;
    },
    release() {
      auto = { ok: true };
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

function setup(overrides: Partial<Record<SaveGroup, ReturnType<typeof makePort>>> = {}) {
  const core = overrides.core ?? makePort();
  const es = overrides.es ?? makePort();
  const en = overrides.en ?? makePort();

  const errors: GroupFieldError[] = [];
  const snapshots: string[] = [];

  const coordinator = createSaveCoordinator({
    ports: { core: core.port, es: es.port, en: en.port },
    onErrors: (list) => errors.push(...list),
    onChange: (snapshot) => snapshots.push(snapshot.global),
    onRoundStart: () => {
      errors.length = 0;
    },
  });

  return { coordinator, core, es, en, errors, snapshots };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Debounce                                                                   */
/* -------------------------------------------------------------------------- */

describe('debounce', () => {
  it('(24) no guarda antes de que pase el retardo', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);

    coordinator.notifyChange('core');
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS - 200);
    expect(core.calls).toBe(0);

    await vi.advanceTimersByTimeAsync(300);
    expect(core.calls).toBe(1);
  });

  it('el retardo por defecto esta en el rango acordado', () => {
    expect(DEFAULT_DEBOUNCE_MS).toBeGreaterThanOrEqual(800);
    expect(DEFAULT_DEBOUNCE_MS).toBeLessThanOrEqual(1200);
  });

  it('(25) varias teclas producen una sola ronda', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);

    for (let i = 0; i < 8; i += 1) {
      coordinator.notifyChange('core');
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(core.calls).toBe(0);

    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(core.calls).toBe(1);
  });

  it('(26) un cambio nuevo reinicia el debounce', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);

    coordinator.notifyChange('core');
    await vi.advanceTimersByTimeAsync(900);

    coordinator.notifyChange('core');
    await vi.advanceTimersByTimeAsync(900);
    expect(core.calls).toBe(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(core.calls).toBe(1);
  });

  it('dispose cancela el guardado pendiente', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);

    coordinator.notifyChange('core');
    coordinator.dispose();

    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS * 2);
    expect(core.calls).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Guardado manual                                                            */
/* -------------------------------------------------------------------------- */

describe('guardado manual', () => {
  it('(27) fuerza el guardado sin esperar al debounce', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);

    coordinator.notifyChange('core');
    await coordinator.saveNow();

    expect(core.calls).toBe(1);
  });

  it('(27) consume el debounce pendiente, sin guardar dos veces', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);

    coordinator.notifyChange('core');
    await coordinator.saveNow();
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS * 2);

    expect(core.calls).toBe(1);
  });

  it('(28) usa el mismo camino que el autosave', async () => {
    const manual = setup();
    manual.core.setDirty(true);
    await manual.coordinator.saveNow();

    const auto = setup();
    auto.core.setDirty(true);
    auto.coordinator.notifyChange('core');
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(manual.core.calls).toBe(auto.core.calls);
    expect(manual.coordinator.snapshot().global).toBe(auto.coordinator.snapshot().global);
  });

  it('guarda tambien lo que aun no habia notificado cambio', async () => {
    const { coordinator, es } = setup();
    es.setDirty(true);

    await coordinator.saveNow();
    expect(es.calls).toBe(1);
  });

  it('sin nada sucio no escribe nada', async () => {
    const { coordinator, core, es, en } = setup();

    await coordinator.saveNow();

    expect(core.calls + es.calls + en.calls).toBe(0);
    expect(coordinator.snapshot().global).toBe('saved');
  });
});

/* -------------------------------------------------------------------------- */
/* Validacion local                                                           */
/* -------------------------------------------------------------------------- */

describe('validacion antes de guardar', () => {
  it('(29) un grupo con error local no se envia', async () => {
    const { coordinator, es, errors } = setup();
    es.setDirty(true);
    es.setErrors([{ field: 'es.slug', message: 'Slug inválido.' }]);

    await coordinator.saveNow();

    expect(es.calls).toBe(0);
    expect(errors).toEqual([{ field: 'es.slug', message: 'Slug inválido.' }]);
    expect(coordinator.snapshot().groups.es).toBe('error');
  });

  it('(30) otro grupo valido si se guarda', async () => {
    const { coordinator, core, es } = setup();

    es.setDirty(true);
    es.setErrors([{ field: 'es.slug', message: 'Slug inválido.' }]);
    core.setDirty(true);

    await coordinator.saveNow();

    expect(core.calls).toBe(1);
    expect(es.calls).toBe(0);
    expect(coordinator.snapshot().groups.core).toBe('clean');
    expect(coordinator.snapshot().groups.es).toBe('error');
  });
});

/* -------------------------------------------------------------------------- */
/* Serializacion                                                              */
/* -------------------------------------------------------------------------- */

describe('serializacion', () => {
  it('(31) no hay dos rondas a la vez', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);
    core.hold();

    const first = coordinator.saveNow();
    const second = coordinator.saveNow();

    expect(core.calls).toBe(1);

    core.resolve({ ok: true });
    await first;
    await second;

    expect(core.calls).toBe(1);
  });

  it('(32) un cambio durante la escritura sigue pendiente', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);
    core.hold();

    const saving = coordinator.saveNow();
    expect(coordinator.snapshot().groups.core).toBe('saving');

    // El usuario escribe mientras la peticion esta en vuelo.
    coordinator.notifyChange('core');
    core.setDirty(true);

    core.resolve({ ok: true });
    await saving;

    expect(coordinator.snapshot().groups.core).toBe('dirty');
    expect(coordinator.snapshot().global).not.toBe('saved');
  });

  it('(33) una respuesta vieja no limpia un cambio posterior', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);
    core.hold();

    const saving = coordinator.saveNow();
    coordinator.notifyChange('core');

    // La respuesta corresponde a la instantanea ANTERIOR al cambio.
    core.resolve({ ok: true });
    await saving;

    expect(coordinator.snapshot().groups.core).not.toBe('clean');
    expect(coordinator.snapshot().hasPendingWork).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Fallos parciales                                                           */
/* -------------------------------------------------------------------------- */

describe('fallos parciales', () => {
  it('(34) core ok + ES falla + EN ok deja estado mixto', async () => {
    const { coordinator, core, es, en, errors } = setup();

    core.setDirty(true);
    es.setDirty(true);
    en.setDirty(true);
    es.setOutcome({
      ok: false,
      errors: [{ field: 'es.slug', message: 'Ese slug ya está en uso.' }],
    });

    await coordinator.saveNow();

    const snapshot = coordinator.snapshot();
    expect(snapshot.groups.core).toBe('clean');
    expect(snapshot.groups.en).toBe('clean');
    expect(snapshot.groups.es).toBe('error');

    // El estado global NO puede decir "Guardado".
    expect(snapshot.global).toBe('error');
    expect(errors).toEqual([{ field: 'es.slug', message: 'Ese slug ya está en uso.' }]);
  });

  it('lo que si se guardo no se revierte', async () => {
    const { coordinator, core, es } = setup();

    core.setDirty(true);
    es.setDirty(true);
    es.setOutcome({ ok: false, message: 'No pudimos guardar los cambios.' });

    await coordinator.saveNow();

    expect(core.calls).toBe(1);
    expect(coordinator.snapshot().groups.core).toBe('clean');
  });

  it('(35) un fallo no dispara reintentos automaticos', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);
    core.setOutcome({ ok: false, message: 'No pudimos guardar los cambios.' });

    await coordinator.saveNow();
    expect(core.calls).toBe(1);

    // Aunque pase mucho tiempo, no vuelve a intentarlo por su cuenta.
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS * 10);
    expect(core.calls).toBe(1);
  });

  it('(36) un cambio nuevo permite reintentar', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);
    core.setOutcome({ ok: false, message: 'No pudimos guardar los cambios.' });

    await coordinator.saveNow();
    expect(core.calls).toBe(1);

    core.setOutcome({ ok: true });
    coordinator.notifyChange('core');
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(core.calls).toBe(2);
    expect(coordinator.snapshot().groups.core).toBe('clean');
  });

  it('(37) el boton manual tambien permite reintentar', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);
    core.setOutcome({ ok: false, message: 'Error' });

    await coordinator.saveNow();
    core.setOutcome({ ok: true });
    await coordinator.saveNow();

    expect(core.calls).toBe(2);
    expect(coordinator.snapshot().global).toBe('saved');
  });
});

/* -------------------------------------------------------------------------- */
/* Estado global                                                              */
/* -------------------------------------------------------------------------- */

describe('estado global', () => {
  it('(38) "Guardado" solo con todos los grupos limpios', async () => {
    const { coordinator, core, es } = setup();

    expect(coordinator.snapshot().global).toBe('saved');

    core.setDirty(true);
    es.setDirty(true);
    coordinator.notifyChange('core');
    expect(coordinator.snapshot().global).toBe('dirty');

    await coordinator.saveNow();
    expect(coordinator.snapshot().global).toBe('saved');
  });

  it('(39) "Guardando" mientras hay una escritura activa', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);
    core.hold();

    const saving = coordinator.saveNow();
    expect(coordinator.snapshot().global).toBe('saving');

    core.resolve({ ok: true });
    await saving;
    expect(coordinator.snapshot().global).toBe('saved');
  });

  it('(40) "Error al guardar" tras un fallo', async () => {
    const { coordinator, core } = setup();
    core.setDirty(true);
    core.setOutcome({ ok: false, message: 'Error' });

    await coordinator.saveNow();
    expect(coordinator.snapshot().global).toBe('error');
  });

  it('una escritura activa manda sobre un error previo', async () => {
    const { coordinator, core, en } = setup();

    core.setDirty(true);
    core.setOutcome({ ok: false, message: 'Error' });
    await coordinator.saveNow();
    expect(coordinator.snapshot().global).toBe('error');

    en.setDirty(true);
    en.hold();
    const saving = coordinator.saveNow();

    // Se deja que la ronda avance hasta la escritura de EN antes de resolver.
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.snapshot().groups.core).toBe('error');
    expect(coordinator.snapshot().groups.en).toBe('saving');
    // Una escritura en curso manda sobre el error previo.
    expect(coordinator.snapshot().global).toBe('saving');

    en.resolve({ ok: true });
    await saving;

    expect(coordinator.snapshot().global).toBe('error');
  });

  it('(41)(42) hay trabajo pendiente solo si algun grupo no esta limpio', async () => {
    const { coordinator, es } = setup();

    expect(coordinator.snapshot().hasPendingWork).toBe(false);

    es.setDirty(true);
    coordinator.notifyChange('es');
    expect(coordinator.snapshot().hasPendingWork).toBe(true);

    await coordinator.saveNow();
    expect(coordinator.snapshot().hasPendingWork).toBe(false);
  });

  it('(41) un error tambien cuenta como trabajo pendiente', async () => {
    const { coordinator, es } = setup();
    es.setDirty(true);
    es.setOutcome({ ok: false, message: 'Error' });

    await coordinator.saveNow();
    expect(coordinator.snapshot().hasPendingWork).toBe(true);
  });

  it('un grupo que dejo de estar sucio se limpia solo', async () => {
    const { coordinator, core } = setup();

    core.setDirty(true);
    coordinator.notifyChange('core');
    expect(coordinator.snapshot().groups.core).toBe('dirty');

    // El usuario deshace el cambio a mano.
    core.setDirty(false);
    await coordinator.saveNow();

    expect(core.calls).toBe(0);
    expect(coordinator.snapshot().groups.core).toBe('clean');
  });
});
