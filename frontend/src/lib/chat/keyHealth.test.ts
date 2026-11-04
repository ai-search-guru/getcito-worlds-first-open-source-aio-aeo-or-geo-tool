import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AGENT-OWN-KEY §5.2, §5.4: one failure episode however many runs fail at
 * once, and a key that works again resumes only the agents it paused.
 */

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let writes: { table: string; values: Row }[];

/** A column, or a JSON field as PostgREST names it ("payload->>provider"). */
const cell = (row: Row, col: string) => {
  const [column, field] = col.split('->>');
  return field === undefined ? row[column] : (row[column] as Row | undefined)?.[field];
};

function query(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  let values: Row | null = null;
  let one = false;
  const builder = {
    select: () => builder,
    update: (v: Row) => ((values = v), builder),
    eq: (col: string, val: unknown) => (filters.push((r) => cell(r, col) === val), builder),
    is: (col: string, val: null) => (filters.push((r) => (r[col] ?? null) === val), builder),
    not: (col: string, _op: 'is', val: null) => (
      filters.push((r) => (r[col] ?? null) !== val),
      builder
    ),
    maybeSingle: () => ((one = true), builder),
    then: (resolve: (result: unknown) => void) => {
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (values && rows.length > 0) {
        for (const row of rows) Object.assign(row, values);
        writes.push({ table, values });
      }
      resolve({ data: one ? (rows[0] ?? null) : rows.map((r) => ({ ...r })), error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (t: string) => query(t) } }));
const notify = vi.hoisted(() => vi.fn(async () => true));
vi.mock('./keyNotice', () => ({ notifyOwnKeyFailure: notify }));

const { markKeyFailing, markKeyWorking, ownKeyFailure, resolveOwnKeyNotices, resumeOwnKeyAgents } =
  await import('./keyHealth');

const ORG = 'org-1';
const T1 = new Date('2026-11-01T09:00:00Z');
const T2 = new Date('2026-11-01T09:00:05Z');

const key = (over: Row = {}): Row => ({
  organization_id: ORG,
  provider: 'openai',
  active: true,
  failing_since: null,
  failure_class: null,
  failure_status: null,
  notified_at: null,
  ...over,
});

beforeEach(() => {
  notify.mockClear();
  vi.stubEnv('CHAT_AGENTIC', 'true');
  writes = [];
  tables = {
    organization_ai_keys: [key(), key({ provider: 'anthropic', active: false })],
    chat_agents: [
      { id: 'a1', organization_id: ORG, status: 'paused', paused_reason: 'own_key' },
      { id: 'a2', organization_id: ORG, status: 'paused', paused_reason: 'manual' },
      { id: 'a3', organization_id: ORG, status: 'active', paused_reason: null },
      { id: 'a4', organization_id: 'org-2', status: 'paused', paused_reason: 'own_key' },
    ],
    chat_notices: [
      notice('n1', { provider: 'openai' }),
      notice('n2', { provider: 'openai', reminder: true }),
      notice('n3', { provider: 'anthropic' }),
      { ...notice('n4', { provider: 'openai' }), organization_id: 'org-2' },
    ],
  };
});

function notice(id: string, payload: Row): Row {
  return {
    id,
    organization_id: ORG,
    kind: 'own_key_failed',
    payload: { class: 'no_credit', ...payload },
    resolved_at: null,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const keyRow = (provider = 'openai') =>
  tables.organization_ai_keys.find((r) => r.provider === provider)!;
const agent = (id: string) => tables.chat_agents.find((r) => r.id === id)!;
const openNotices = () =>
  tables.chat_notices.filter((n) => n.resolved_at === null).map((n) => n.id);

describe('markKeyFailing', () => {
  it('starts one episode however many runs fail, and keeps the latest class', async () => {
    expect(await markKeyFailing(ORG, 'openai', { class: 'invalid', status: 401 }, T1)).toEqual({
      started: true,
      since: T1.toISOString(),
    });
    // The episode's first failure tells the Admins (00441).
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(ORG, 'openai', T1.toISOString());
    expect(await markKeyFailing(ORG, 'openai', { class: 'no_credit', status: 429 }, T2)).toEqual({
      started: false,
      since: T1.toISOString(),
    });
    // A class that changes inside the episode doesn't tell them again.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(keyRow()).toMatchObject({
      failing_since: T1.toISOString(),
      failure_class: 'no_credit',
      failure_status: 429,
    });
    // Another provider's saved key isn't touched.
    expect(keyRow('anthropic').failing_since).toBeNull();
  });

  it('tells no one while Chat is off for the workspace', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await markKeyFailing(ORG, 'openai', { class: 'invalid', status: 401 }, T1)).toEqual({
      started: true,
      since: T1.toISOString(),
    });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('ownKeyFailure', () => {
  it('reads the active key’s failure, and null while it works', async () => {
    expect(await ownKeyFailure(ORG)).toBeNull();
    await markKeyFailing(ORG, 'openai', { class: 'model', status: 404 }, T1);
    expect(await ownKeyFailure(ORG)).toEqual({
      provider: 'openai',
      class: 'model',
      status: 404,
      since: T1.toISOString(),
    });
    expect(await ownKeyFailure('org-2')).toBeNull();
  });
});

describe('markKeyWorking', () => {
  it('changes nothing for a key that works', async () => {
    expect(await markKeyWorking(ORG, 'openai', T2)).toEqual({ cleared: false, resumed: 0 });
    expect(writes).toEqual([]);
    expect(agent('a1').status).toBe('paused');
  });

  it('clears the episode and resumes only the agents the key paused', async () => {
    await markKeyFailing(ORG, 'openai', { class: 'no_credit', status: 429 }, T1);
    keyRow().notified_at = T1.toISOString();

    expect(await markKeyWorking(ORG, 'openai', T2)).toEqual({ cleared: true, resumed: 1 });
    expect(keyRow()).toMatchObject({
      failing_since: null,
      failure_class: null,
      failure_status: null,
      notified_at: null,
    });
    expect(agent('a1')).toMatchObject({
      status: 'active',
      paused_reason: null,
      activated_at: T2.toISOString(),
    });
    expect(agent('a2')).toMatchObject({ status: 'paused', paused_reason: 'manual' });
    expect(agent('a4')).toMatchObject({ status: 'paused', paused_reason: 'own_key' });
    // Its notices close, reminder too; another key's and another workspace's stay.
    expect(openNotices()).toEqual(['n3', 'n4']);

    // A second success finds nothing to clear.
    expect(await markKeyWorking(ORG, 'openai', T2)).toEqual({ cleared: false, resumed: 0 });
  });
});

describe('resolveOwnKeyNotices', () => {
  it("closes the key's open notices in the workspace", async () => {
    await resolveOwnKeyNotices(ORG, 'anthropic', T2);
    expect(openNotices()).toEqual(['n1', 'n2', 'n4']);
    expect(tables.chat_notices.find((n) => n.id === 'n3')!.resolved_at).toBe(T2.toISOString());
  });
});

describe('resumeOwnKeyAgents', () => {
  it('resumes the workspace’s own_key agents when the key goes out of use', async () => {
    expect(await resumeOwnKeyAgents('org-2', T2)).toBe(1);
    expect(agent('a4').status).toBe('active');
    expect(agent('a1').status).toBe('paused');
  });
});
