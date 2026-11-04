import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The organization's demo brand (00380): created on the first visit, rebuilt
 * in place when DEMO_VERSION moves on or its data grows old, left alone
 * otherwise; hidden or shown by the organization, never deleted.
 */

const state = vi.hoisted(() => ({
  brands: [],
  tables: {},
  cleared: [],
  log: [],
  failInsert: null,
  onRead: null,
}));

/**
 * The admin client over `state.brands` and the modules' `state.tables`,
 * recording each table a rebuild clears (a delete by brand) and, in
 * `state.log`, each write and delete of a module's table.
 */
vi.mock('../../config/supabase.js', () => {
  const matches = (row, filters) =>
    filters.every(([op, column, value]) => {
      if (op === 'is') return (row[column] ?? null) === value;
      if (op === 'in') return value.includes(row[column]);
      return row[column] === value;
    });
  const tableRun = (table, q) => {
    const rows = (state.tables[table] ??= []);
    if (q.op === 'insert' || q.op === 'upsert') {
      state.log.push(`${q.op} ${table}`);
      for (const row of q.payload) {
        const same = q.op === 'upsert' && rows.find((r) => r.id === row.id);
        if (same) Object.assign(same, row);
        else rows.push({ ...row });
      }
      return { data: null, error: null };
    }
    const hit = rows.filter((r) => matches(r, q.filters));
    if (q.op === 'delete') {
      if (q.filters.length === 1 && q.filters[0][1] === 'brand_id') {
        state.cleared.push([table, ...q.filters[0].slice(1)]);
      }
      state.log.push(`delete ${table}`);
      state.tables[table] = rows.filter((r) => !hit.includes(r));
      return { data: null, error: null };
    }
    const [start, end] = q.range ?? [0, hit.length];
    return { data: hit.slice(start, end + 1).map((r) => ({ id: r.id })), error: null };
  };
  const from = (table) => {
    const q = { op: 'select', filters: [], payload: null, returning: false, range: null };
    const run = () => {
      if (table !== 'brands') return tableRun(table, q);
      if (q.op === 'insert') {
        if (state.failInsert) return { data: null, error: state.failInsert };
        const taken = state.brands.some(
          (b) => b.is_demo && b.organization_id === q.payload.organization_id,
        );
        if (taken) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const row = { id: `brand-${state.brands.length + 1}`, demo_hidden_at: null, ...q.payload };
        state.brands.push(row);
        return { data: { ...row }, error: null };
      }
      const rows = state.brands.filter((b) => matches(b, q.filters));
      if (q.op === 'update') {
        for (const row of rows) Object.assign(row, q.payload);
        return { data: q.returning ? rows.map((r) => ({ id: r.id })) : null, error: null };
      }
      state.onRead?.();
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const chain = {
      select: () => ((q.returning = true), chain),
      insert: (payload) => ((q.op = 'insert'), (q.payload = payload), chain),
      upsert: (payload) => ((q.op = 'upsert'), (q.payload = payload), chain),
      update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
      delete: () => ((q.op = 'delete'), chain),
      eq: (column, value) => (q.filters.push(['eq', column, value]), chain),
      is: (column, value) => (q.filters.push(['is', column, value]), chain),
      in: (column, values) => (q.filters.push(['in', column, values]), chain),
      order: () => chain,
      range: (start, end) => ((q.range = [start, end]), chain),
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = run();
        return { data: Array.isArray(data) ? data[0] : data, error };
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  };
  return { default: { from } };
});
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  DEMO_BUILD_LEASE_MS,
  DEMO_MAX_AGE_MS,
  DEMO_VERSION,
  demoState,
  ensureDemoBrand,
  setDemoHidden,
} = await import('./index.js');

const NOW = new Date('2026-10-28T12:00:00Z');
const DAY_MS = 86_400_000;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const build = vi.fn(async () => ({ rows: 1 }));
const modules = [
  { name: 'one', tables: ['a', 'b'], build },
  { name: 'two', tables: ['c'], build },
];
const ensure = (organizationId = 'org-1', now = NOW) =>
  ensureDemoBrand({ organizationId, now, modules });

const demo = (over = {}) => ({
  id: 'demo-1',
  organization_id: 'org-1',
  is_demo: true,
  demo_version: DEMO_VERSION,
  demo_built_at: ago(60_000),
  demo_hidden_at: null,
  ...over,
});

beforeEach(() => {
  state.brands = [{ id: 'real-1', organization_id: 'org-1', is_demo: false }];
  state.tables = {};
  state.cleared = [];
  state.log = [];
  state.failInsert = null;
  state.onRead = null;
  build.mockReset().mockResolvedValue({ rows: 1 });
});
afterEach(() => vi.useRealTimers());

describe('ensureDemoBrand', () => {
  it('creates the demo brand on the first visit and builds it', async () => {
    expect(await ensure()).toEqual({ brandId: 'brand-2', version: DEMO_VERSION, rebuilt: true });
    const created = state.brands[1];
    expect(created).toMatchObject({
      organization_id: 'org-1',
      name: 'Brewline Coffee',
      is_demo: true,
      demo_version: DEMO_VERSION,
      demo_built_at: NOW.toISOString(),
    });
    const ctx = { brandId: 'brand-2', now: NOW, rebuild: false, write: expect.any(Function) };
    expect(build.mock.calls.map(([c]) => c)).toEqual([ctx, ctx]);
    // Every module's tables, each module's in reverse: a new brand already
    // holds what its triggers made.
    const cleared = state.cleared.map(([table]) => table);
    expect(cleared.sort()).toEqual(['a', 'b', 'c']);
    expect(state.log.indexOf('delete b')).toBeLessThan(state.log.indexOf('delete a'));
    // The real brand is untouched.
    expect(state.brands[0]).toEqual({ id: 'real-1', organization_id: 'org-1', is_demo: false });
  });

  it('leaves a current demo alone', async () => {
    state.brands.push(demo());
    expect(await ensure()).toEqual({ brandId: 'demo-1', version: DEMO_VERSION, rebuilt: false });
    expect(build).not.toHaveBeenCalled();
    expect(state.cleared).toEqual([]);
  });

  it('rebuilds in place a demo of an older version, or one whose data grew old', async () => {
    state.brands.push(demo({ demo_version: DEMO_VERSION - 1 }));
    expect(await ensure()).toEqual({ brandId: 'demo-1', version: DEMO_VERSION, rebuilt: true });
    expect(state.brands[1]).toMatchObject({
      id: 'demo-1',
      demo_version: DEMO_VERSION,
      demo_built_at: NOW.toISOString(),
    });

    build.mockClear();
    state.brands[1].demo_built_at = ago(DEMO_MAX_AGE_MS + 1);
    expect((await ensure()).rebuilt).toBe(true);
    expect(build).toHaveBeenCalledTimes(2);
    expect(build.mock.calls[0][0]).toMatchObject({ brandId: 'demo-1', rebuild: true });
  });

  it('clears the tables of a module not rebuilt in place just before building it', async () => {
    state.brands.push(demo({ demo_version: DEMO_VERSION - 1 }));
    const logged = (name) =>
      vi.fn(async () => {
        state.log.push(`build ${name}`);
        return { rows: 1 };
      });
    const staged = [
      { name: 'one', tables: ['a', 'b'], build: logged('one') },
      { name: 'two', tables: ['c'], build: logged('two') },
    ];
    await ensureDemoBrand({ organizationId: 'org-1', now: NOW, modules: staged });
    expect(state.log).toEqual(['delete b', 'delete a', 'build one', 'delete c', 'build two']);
  });

  it("on a first build clears the other modules' tables while the first one is built", async () => {
    const logged = (name) =>
      vi.fn(async () => {
        state.log.push(`build ${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        state.log.push(`build ${name}:end`);
      });
    const staged = [
      { name: 'core', tables: ['a'], inPlace: true, build: logged('core') },
      { name: 'two', tables: ['b', 'c'], build: logged('two') },
    ];
    await ensureDemoBrand({ organizationId: 'org-1', now: NOW, modules: staged });
    expect(state.log.indexOf('delete b')).toBeLessThan(state.log.indexOf('build core:end'));
    expect(state.log.indexOf('delete b')).toBeLessThan(state.log.indexOf('build two:start'));
    // The in-place core clears nothing.
    expect(state.cleared.map(([table]) => table)).toEqual(['c', 'b']);
  });

  it('builds an in-place module over a new brand without reading anything back', async () => {
    const inPlace = {
      name: 'core',
      tables: ['items'],
      inPlace: true,
      async build({ write }) {
        await write('items', [{ id: 'i1', brand_id: 'brand-2' }]);
      },
    };
    await ensureDemoBrand({ organizationId: 'org-1', now: NOW, modules: [inPlace] });
    expect(state.log).toEqual(['upsert items']);
    expect(state.cleared).toEqual([]);
  });

  it('rebuilds an in-place module over its old rows, deleting only the ones not written again', async () => {
    state.brands.push(demo({ demo_version: DEMO_VERSION - 1 }));
    state.tables.items = [
      { id: 'i1', brand_id: 'demo-1', v: 'old' },
      { id: 'i2', brand_id: 'demo-1', v: 'old' },
      { id: 'i9', brand_id: 'other', v: 'old' },
    ];
    const seen = [];
    const inPlace = {
      name: 'core',
      tables: ['items'],
      inPlace: true,
      async build({ write }) {
        // Mid-build, the old rows are still there to show.
        seen.push(state.tables.items.length);
        await write('items', [{ id: 'i1', brand_id: 'demo-1', v: 'new' }]);
        return { items: 1 };
      },
      refresh: vi.fn(async () => {
        state.log.push('refresh core');
      }),
    };
    await ensureDemoBrand({ organizationId: 'org-1', now: NOW, modules: [inPlace] });

    expect(seen).toEqual([3]);
    expect(state.cleared).toEqual([]);
    expect(state.tables.items).toEqual([
      { id: 'i1', brand_id: 'demo-1', v: 'new' },
      { id: 'i9', brand_id: 'other', v: 'old' },
    ]);
    // Written over, the leftover deleted, and only then the rollups rebuilt.
    expect(state.log).toEqual(['upsert items', 'delete items', 'refresh core']);
    expect(inPlace.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'demo-1', now: NOW, rebuild: true }),
    );
  });

  it('keeps the demo hidden or shown as the organization left it', async () => {
    state.brands.push(demo({ demo_version: 0, demo_hidden_at: ago(DAY_MS) }));
    await ensure();
    expect(state.brands[1].demo_hidden_at).toBe(ago(DAY_MS));
  });

  it('builds once for two visits at the same moment', async () => {
    const [first, second] = await Promise.all([ensure(), ensure()]);
    expect(first).toEqual(second);
    expect(state.brands.filter((b) => b.is_demo)).toHaveLength(1);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("reads another server's demo when its insert lost the race", async () => {
    state.onRead = () => {
      // Another server inserts the demo between this one's read and insert.
      if (!state.brands.some((b) => b.is_demo)) state.brands.push(demo());
      state.onRead = null;
    };
    const result = await ensure();
    expect(result).toEqual({ brandId: 'demo-1', version: DEMO_VERSION, rebuilt: false });
    expect(build).not.toHaveBeenCalled();
  });

  it("waits on another server's build, then answers with it", async () => {
    vi.useFakeTimers({ now: NOW });
    state.brands.push(demo({ demo_version: null, demo_built_at: ago(1000) }));
    const pending = ensure();
    // The other server finishes.
    state.brands[1].demo_version = DEMO_VERSION;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ brandId: 'demo-1', version: DEMO_VERSION, rebuilt: false });
    expect(build).not.toHaveBeenCalled();
  });

  it('takes over a build left unfinished past its lease', async () => {
    state.brands.push(demo({ demo_version: null, demo_built_at: ago(DEMO_BUILD_LEASE_MS + 1) }));
    expect((await ensure()).rebuilt).toBe(true);
  });

  it('lets the next visit rebuild at once after a failed build', async () => {
    state.brands.push(demo({ demo_version: 0 }));
    build.mockRejectedValueOnce(new Error('insert failed'));
    await expect(ensure()).rejects.toThrow('insert failed');
    expect(state.brands[1]).toMatchObject({ demo_version: null, demo_built_at: null });
    expect(demoState(state.brands[1], NOW)).toBe('stale');

    expect((await ensure()).rebuilt).toBe(true);
    expect(state.brands[1].demo_version).toBe(DEMO_VERSION);
  });

  it('throws when the brand cannot be created', async () => {
    state.failInsert = { code: '42501', message: 'permission denied' };
    await expect(ensure()).rejects.toThrow('demo brand insert: permission denied');
  });
});

describe('the build order', () => {
  it('builds the first module alone, the others together, each after the one it names', async () => {
    const order = [];
    // Each step ends when its gate opens: the order doesn't hang on timers.
    const gates = {};
    const step = (name) =>
      vi.fn(async () => {
        order.push(`${name}:start`);
        await new Promise((resolve) => (gates[name] = resolve));
        order.push(`${name}:end`);
        return { rows: 1 };
      });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const open = async (name) => {
      gates[name]();
      await settle();
    };
    const staged = [
      { name: 'core', tables: ['a'], build: step('core'), refresh: step('rollups') },
      { name: 'slow', tables: ['b'], build: step('slow') },
      { name: 'actions', tables: ['c'], build: step('actions') },
      { name: 'drafts', tables: ['d'], after: 'actions', build: step('drafts') },
    ];
    const built = ensureDemoBrand({ organizationId: 'org-1', now: NOW, modules: staged });
    await settle();
    // The first module alone.
    expect(order).toEqual(['core:start']);
    await open('core');
    // The others together, with the first one's rollups; drafts waits for actions.
    expect(order.slice(1).sort()).toEqual([
      'actions:start',
      'core:end',
      'rollups:start',
      'slow:start',
    ]);
    await open('actions');
    // Drafts starts once actions is done, without waiting for the slow one.
    expect(order.slice(-2)).toEqual(['actions:end', 'drafts:start']);
    await open('drafts');
    await open('rollups');
    await open('slow');
    await built;
    expect(order.at(-1)).toBe('slow:end');
  });

  it("fails the build when the first module's rollups fail", async () => {
    const staged = [
      {
        name: 'core',
        tables: ['a'],
        build,
        refresh: vi.fn().mockRejectedValue(new Error('rollups')),
      },
      { name: 'two', tables: ['b'], build },
    ];
    await expect(
      ensureDemoBrand({ organizationId: 'org-1', now: NOW, modules: staged }),
    ).rejects.toThrow('rollups');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('fails the build when any module fails, after the others settle', async () => {
    const fails = vi.fn(async () => {
      throw new Error('boom');
    });
    const staged = [
      { name: 'core', tables: ['a'], build },
      { name: 'bad', tables: ['b'], build: fails },
      { name: 'good', tables: ['c'], build },
    ];
    await expect(
      ensureDemoBrand({ organizationId: 'org-1', now: NOW, modules: staged }),
    ).rejects.toThrow('boom');
    expect(build).toHaveBeenCalledTimes(2);
  });
});

describe('demoState', () => {
  it('reads fresh, building or stale from the version and when it was built', () => {
    expect(demoState(demo(), NOW)).toBe('fresh');
    // A newer server's demo is left to it.
    expect(
      demoState(demo({ demo_version: DEMO_VERSION + 1, demo_built_at: ago(30 * DAY_MS) }), NOW),
    ).toBe('fresh');
    expect(demoState(demo({ demo_version: DEMO_VERSION - 1 }), NOW)).toBe('stale');
    expect(demoState(demo({ demo_built_at: ago(DEMO_MAX_AGE_MS) }), NOW)).toBe('stale');
    expect(demoState(demo({ demo_version: null, demo_built_at: ago(60_000) }), NOW)).toBe(
      'building',
    );
    expect(demoState(demo({ demo_version: null, demo_built_at: null }), NOW)).toBe('stale');
  });
});

describe('setDemoHidden', () => {
  it("hides and shows the organization's demo brand, never another brand", async () => {
    state.brands.push(demo(), demo({ id: 'demo-2', organization_id: 'org-2' }));
    expect(await setDemoHidden({ organizationId: 'org-1', hidden: true, now: NOW })).toEqual({
      brandId: 'demo-1',
      hidden: true,
    });
    expect(state.brands.map((b) => b.demo_hidden_at ?? null)).toEqual([
      null,
      NOW.toISOString(),
      null,
    ]);

    expect(await setDemoHidden({ organizationId: 'org-1', hidden: false })).toEqual({
      brandId: 'demo-1',
      hidden: false,
    });
    expect(state.brands[1].demo_hidden_at).toBeNull();
  });

  it('takes its chats away when hidden, and rebuilds it with them when shown again', async () => {
    state.brands.push(demo(), demo({ id: 'demo-2', organization_id: 'org-2' }));
    state.tables.chat_conversations = [
      { id: 'c1', brand_id: 'demo-1' },
      { id: 'c2', brand_id: 'demo-2' },
      { id: 'c3', brand_id: 'real-1' },
    ];
    await setDemoHidden({ organizationId: 'org-1', hidden: true, now: NOW });
    expect(state.tables.chat_conversations.map((c) => c.id)).toEqual(['c2', 'c3']);

    await setDemoHidden({ organizationId: 'org-1', hidden: false, now: NOW });
    expect(state.brands[1].demo_built_at).toBeNull();
    expect(demoState(state.brands[1], NOW)).toBe('stale');
  });

  it('answers null when the organization has no demo brand', async () => {
    expect(await setDemoHidden({ organizationId: 'org-1', hidden: true })).toBeNull();
  });
});
