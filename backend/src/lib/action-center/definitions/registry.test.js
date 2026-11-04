import { describe, expect, it, vi } from 'vitest';

// The signal registry reaches the admin client at import time, whose config
// hard-exits without SUPABASE_* env (as in CI). Nothing under test touches it.
vi.mock('../../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../pulse/metrics.js', () => ({ computePulseMetrics: vi.fn() }));

import { CATEGORIES, isEligible, loadDefinitions } from './index.js';
import { SOURCES } from '../sources.js';
import { KIND_META } from '../../signals/record.js';
import { LIBRARY_EMITTED_KINDS } from '../../signals/library/detect.js';

const definitions = await loadDefinitions();

/**
 * The registry's whole promise is that a definition can be added by dropping
 * a file in the directory. That only holds if a bad file is caught, so these
 * are the checks the loader makes, asserted against what is actually there.
 */
describe('the definition registry', () => {
  it('finds every definition file in the directory', () => {
    expect(definitions.length).toBeGreaterThan(0);
  });

  it('gives each definition a unique id', () => {
    const ids = definitions.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('orders them reproducibly, so two runs agree', () => {
    const ids = definitions.map((definition) => definition.id);
    expect(ids).toEqual([...ids].sort());
  });

  it.each(definitions.map((definition) => [definition.id, definition]))(
    '%s is a well-formed definition',
    (_id, definition) => {
      expect(CATEGORIES).toContain(definition.category);
      expect(Number.isInteger(definition.version)).toBe(true);
      expect(definition.version).toBeGreaterThanOrEqual(1);
      expect(definition.signalKinds.length).toBeGreaterThan(0);
      expect(definition.tasks.length).toBeGreaterThan(0);
      expect(typeof definition.payload).toBe('function');
      for (const source of [...definition.requires, ...definition.optional]) {
        expect(SOURCES).toContain(source);
      }
    },
  );

  /**
   * A definition naming a signal kind nothing emits cannot fire, and nothing
   * would say so — it would simply be quiet forever. Cheaper to fail here
   * than to wonder in three months why a family never produced an action.
   */
  it.each(definitions.filter((d) => d.enabled).map((definition) => [definition.id, definition]))(
    '%s only listens for signal kinds a detector emits',
    (_id, definition) => {
      for (const kind of definition.signalKinds) {
        expect(Object.keys(KIND_META)).toContain(kind);
      }
    },
  );

  /**
   * The V1 specification's library: 62 definitions, 19 Growth, 10 Protect,
   * 11 Recover, 13 Fix, 9 Compete. Anything else is not the V1 library.
   */
  it('registers the specification’s sixty-two definitions', () => {
    const byFamily = {};
    for (const d of definitions) byFamily[d.category] = (byFamily[d.category] ?? 0) + 1;
    expect(definitions).toHaveLength(62);
    expect(byFamily).toEqual({ growth: 19, protect: 10, recover: 11, fix: 13, compete: 9 });
  });

  /**
   * The reverse of "listens for kinds a detector emits": every kind the
   * library detectors write has a definition to go to. A kind nothing consumes
   * fills the Signals page with findings that can never become work.
   */
  it('gives every library signal kind a definition', () => {
    const consumed = new Set(definitions.flatMap((d) => d.signalKinds));
    for (const kind of LIBRARY_EMITTED_KINDS) {
      expect({ kind, consumed: consumed.has(kind) }).toEqual({ kind, consumed: true });
    }
  });

  it('gives every definition its own specification code', () => {
    expect(new Set(definitions.map((d) => d.code)).size).toBe(62);
  });

  /** A disabled definition is a promise with nothing behind it; it has to
   *  say which data it is waiting for. */
  it('explains every definition it cannot run yet', () => {
    for (const d of definitions.filter((x) => !x.enabled)) {
      expect(d.disabledReason?.length ?? 0).toBeGreaterThan(40);
    }
  });

  /**
   * Two definitions consuming the same signal kind would both fire on it,
   * giving the brand two actions for one condition.
   */
  it('gives each signal kind at most one definition', () => {
    const owner = new Map();
    for (const definition of definitions) {
      for (const kind of definition.signalKinds) {
        expect(owner.get(kind) ?? definition.id).toBe(definition.id);
        owner.set(kind, definition.id);
      }
    }
  });

  it('shapes a payload from the signals it was given', () => {
    for (const definition of definitions) {
      const byKind = new Map(definition.signalKinds.map((kind) => [kind, []]));
      expect(typeof definition.payload(byKind)).toBe('object');
    }
  });

  /** An empty map is what an ineligible or signal-less brand looks like. */
  it('survives being asked for a payload with nothing to shape', () => {
    for (const definition of definitions) {
      expect(() => definition.payload(new Map())).not.toThrow();
    }
  });
});

describe('isEligible', () => {
  const definition = { requires: ['tracking', 'analytics'] };

  it('passes when the brand has every required source', () => {
    expect(isEligible(definition, new Set(['tracking', 'analytics', 'competitors']))).toBe(true);
  });

  it('fails when one is missing', () => {
    expect(isEligible(definition, new Set(['tracking']))).toBe(false);
  });

  it('ignores optional sources entirely', () => {
    expect(isEligible({ requires: [], optional: ['analytics'] }, new Set())).toBe(true);
  });
});
