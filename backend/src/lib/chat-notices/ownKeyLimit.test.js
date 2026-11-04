import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Warning the Admins about the key guard (AGENT-OWN-KEY §4.2 item 4, PR 10):
 * at 80% and at the limit of what all agents may spend on the own key, once
 * each per period, in each Admin's Inbox and by e-mail by their setting; no
 * 80% once the limit was reached; warnings leave the Inbox once over.
 */

const db = vi.hoisted(() => ({ tables: {} }));
const deliverEmail = vi.hoisted(() => vi.fn(async () => 'sent'));

/** A query on the in-memory tables: filters, an update or an upsert, and select. */
function query(table) {
  const filters = [];
  let values = null;
  let upsert = null;
  let one = false;
  const chain = {
    select: () => chain,
    eq: (col, val) => (filters.push((r) => r[col] === val), chain),
    in: (col, vals) => (filters.push((r) => vals.includes(r[col])), chain),
    is: (col, val) => (filters.push((r) => (r[col] ?? null) === val), chain),
    update: (v) => ((values = v), chain),
    upsert: (rows, options) => ((upsert = { rows, options }), chain),
    maybeSingle: () => ((one = true), chain),
    then: (resolve) => {
      const rows = (db.tables[table] ??= []);
      if (upsert) {
        const written = [];
        for (const row of upsert.rows) {
          const clash = rows.some(
            (r) => r.user_id === row.user_id && r.dedupe_key === row.dedupe_key,
          );
          if (clash) continue;
          rows.push(row);
          written.push(row);
        }
        return resolve({ data: written, error: null });
      }
      const found = rows.filter((r) => filters.every((f) => f(r)));
      if (values) for (const row of found) Object.assign(row, values);
      return resolve({ data: one ? (found[0] ?? null) : found, error: null });
    },
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => query(table),
    auth: {
      admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@acme.test` } } }) },
    },
  },
}));
vi.mock('../email.js', () => ({ deliverEmail }));
vi.mock('../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { forgetOwnKeyLimitWarnings, limitLevel, renderOwnKeyLimitEmail, warnOwnKeyLimit } =
  await import('./ownKeyLimit.js');

const ORG = 'org-1';
const SINCE = '2026-10-20T09:00:00.000Z';
const NEXT = '2026-11-20T09:00:00.000Z';
const spend = (usedUsd, over = {}) => ({
  reached: usedUsd >= (over.capUsd ?? 250),
  usedUsd,
  capUsd: 250,
  since: SINCE,
  renewsAt: NEXT,
  ...over,
});
const open = () =>
  db.tables.chat_notices.filter((n) => !n.resolved_at).map((n) => [n.user_id, n.kind]);

beforeEach(() => {
  forgetOwnKeyLimitWarnings();
  deliverEmail.mockClear();
  db.tables = {
    profiles: [
      { id: 'admin-1', organization_id: ORG, role: 'admin' },
      { id: 'admin-2', organization_id: ORG, role: 'admin' },
      { id: 'manager-1', organization_id: ORG, role: 'manager' },
      { id: 'other-admin', organization_id: 'org-2', role: 'admin' },
    ],
    chat_user_prefs: [{ user_id: 'admin-2', notify_via: 'inbox' }],
    chat_notices: [],
    organizations: [{ id: ORG, name: 'Acme' }],
  };
});

describe('limitLevel', () => {
  it('is 80 from 80% of the limit and 100 at it', () => {
    expect(limitLevel({ usedUsd: 199.99, capUsd: 250 })).toBe(0);
    expect(limitLevel({ usedUsd: 200, capUsd: 250 })).toBe(80);
    expect(limitLevel({ usedUsd: 249.99, capUsd: 250 })).toBe(80);
    expect(limitLevel({ usedUsd: 250, capUsd: 250 })).toBe(100);
  });
});

describe('warnOwnKeyLimit', () => {
  it('says nothing below 80%', async () => {
    expect(await warnOwnKeyLimit(ORG, spend(120))).toEqual({ notices: 0, emails: 0, resolved: 0 });
    expect(db.tables.chat_notices).toEqual([]);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('warns each Admin at 80%: an Inbox notice, and an e-mail by their setting', async () => {
    expect(await warnOwnKeyLimit(ORG, spend(205))).toEqual({ notices: 2, emails: 1, resolved: 0 });
    expect(db.tables.chat_notices.map((n) => [n.user_id, n.kind, n.dedupe_key])).toEqual([
      ['admin-1', 'own_key_limit_80', `own_key_limit_80:${SINCE}`],
      ['admin-2', 'own_key_limit_80', `own_key_limit_80:${SINCE}`],
    ]);
    expect(db.tables.chat_notices[0].payload).toEqual({
      level: 80,
      usedUsd: 205,
      capUsd: 250,
      since: SINCE,
      renewsAt: NEXT,
    });
    // Inbox only for admin-2: one e-mail, to admin-1.
    expect(deliverEmail).toHaveBeenCalledTimes(1);
    expect(deliverEmail.mock.calls[0][0]).toMatchObject({
      to: ['admin-1@acme.test'],
      subject: 'Your agents have used 80% of their monthly limit on your AI key',
    });
  });

  it('warns once a period, however often the guard is read', async () => {
    await warnOwnKeyLimit(ORG, spend(205));
    expect(await warnOwnKeyLimit(ORG, spend(210))).toEqual({ notices: 0, emails: 0, resolved: 0 });
    // Another process (or a restart) reads it: the notice is there, nothing new.
    forgetOwnKeyLimitWarnings();
    expect(await warnOwnKeyLimit(ORG, spend(215))).toEqual({ notices: 0, emails: 0, resolved: 0 });
    expect(db.tables.chat_notices).toHaveLength(2);
    expect(deliverEmail).toHaveBeenCalledTimes(1);
  });

  it('at the limit, tells the Admins the agents paused, and takes the 80% out of the Inbox', async () => {
    await warnOwnKeyLimit(ORG, spend(205));
    deliverEmail.mockClear();
    expect(await warnOwnKeyLimit(ORG, spend(251.2))).toEqual({
      notices: 2,
      emails: 1,
      resolved: 2,
    });
    expect(open()).toEqual([
      ['admin-1', 'own_key_limit_100'],
      ['admin-2', 'own_key_limit_100'],
    ]);
    expect(deliverEmail.mock.calls[0][0].subject).toBe(
      'Your agents reached their monthly limit on your AI key',
    );
  });

  it('sends no 80% once the limit was reached this period', async () => {
    await warnOwnKeyLimit(ORG, spend(260));
    deliverEmail.mockClear();
    // An Admin raised the limit to $300: under it again, but past 80%.
    expect(await warnOwnKeyLimit(ORG, spend(260, { capUsd: 300 }))).toEqual({
      notices: 0,
      emails: 0,
      resolved: 2,
    });
    expect(open()).toEqual([]);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('takes the warnings out once the period renews, and warns again in the new one', async () => {
    await warnOwnKeyLimit(ORG, spend(205));
    expect(
      await warnOwnKeyLimit(ORG, spend(3, { since: NEXT, renewsAt: '2026-12-20T09:00:00.000Z' })),
    ).toEqual({ notices: 0, emails: 0, resolved: 2 });
    expect(open()).toEqual([]);
    expect(
      await warnOwnKeyLimit(ORG, spend(240, { since: NEXT, renewsAt: '2026-12-20T09:00:00.000Z' })),
    ).toMatchObject({ notices: 2 });
    expect(
      db.tables.chat_notices.filter((n) => n.dedupe_key === `own_key_limit_80:${NEXT}`),
    ).toHaveLength(2);
  });

  it('tells no one but the Admins', async () => {
    await warnOwnKeyLimit(ORG, spend(260));
    expect(db.tables.chat_notices.map((n) => n.user_id).sort()).toEqual(['admin-1', 'admin-2']);
  });
});

describe('renderOwnKeyLimitEmail', () => {
  it('names the estimate, the date it renews and where to raise it, escaped', () => {
    const { subject, html } = renderOwnKeyLimitEmail({
      level: 100,
      usedUsd: 251.2,
      capUsd: 250,
      renewsAt: NEXT,
      workspace: 'Acme <b>',
    });
    expect(subject).toBe('Your agents reached their monthly limit on your AI key');
    expect(html).toContain('about $251 of the $250');
    expect(html).toContain('renews on Nov 20');
    expect(html).toContain('Acme &lt;b&gt;');
    expect(html).toContain('/dashboard/settings/ai-providers');
    expect(html).toContain('estimate');

    const warning = renderOwnKeyLimitEmail({
      level: 80,
      usedUsd: 205,
      capUsd: 250.5,
      renewsAt: NEXT,
      workspace: 'Acme',
    });
    expect(warning.html).toContain('about $205 of the $250.50');
  });
});
