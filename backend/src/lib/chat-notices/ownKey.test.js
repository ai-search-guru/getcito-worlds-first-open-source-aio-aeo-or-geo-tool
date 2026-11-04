import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Telling the Admins the workspace's own AI key fails (AGENT-OWN-KEY §5.3,
 * 00441): once per failure episode however many runs fail at once, one
 * reminder 3 days in, each Admin's Inbox notice, and an e-mail only for
 * Inbox and e-mail. No one but the Admins, and no brand.
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

const { notifyOwnKeyFailure, renderOwnKeyEmail, keyWhy } = await import('./ownKey.js');

const ORG = 'org-1';
const SINCE = '2026-11-01T09:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const at = (ms) => new Date(Date.parse(SINCE) + ms);

beforeEach(() => {
  deliverEmail.mockClear();
  db.tables = {
    organization_ai_keys: [
      {
        organization_id: ORG,
        provider: 'openai',
        failing_since: SINCE,
        failure_class: 'no_credit',
        notified_at: null,
      },
    ],
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

const tell = (over = {}, now = at(60_000)) =>
  notifyOwnKeyFailure({ orgId: ORG, provider: 'openai', since: SINCE, ...over }, { now });

describe('notifyOwnKeyFailure', () => {
  it('tells each Admin once per episode: an Inbox notice, and an e-mail by their setting', async () => {
    expect(await tell()).toEqual({ notices: 2, emails: 1 });
    expect(db.tables.chat_notices.map((n) => [n.user_id, n.kind, n.dedupe_key])).toEqual([
      ['admin-1', 'own_key_failed', `own_key:openai:${SINCE}`],
      ['admin-2', 'own_key_failed', `own_key:openai:${SINCE}`],
    ]);
    expect(db.tables.chat_notices[0].payload).toEqual({
      provider: 'openai',
      class: 'no_credit',
      reminder: false,
    });
    // Inbox only for admin-2: one e-mail, to admin-1.
    expect(deliverEmail).toHaveBeenCalledTimes(1);
    expect(deliverEmail.mock.calls[0][0]).toMatchObject({
      to: ['admin-1@acme.test'],
      subject: "Your AI key for GetCito isn't working",
    });
    expect(db.tables.organization_ai_keys[0].notified_at).toBe(at(60_000).toISOString());

    // The run that failed at the same moment finds the episode told.
    expect(await tell()).toEqual({ notices: 0, emails: 0 });
    expect(deliverEmail).toHaveBeenCalledTimes(1);
  });

  it('tells nothing for a key that works again, or another episode', async () => {
    db.tables.organization_ai_keys[0].failing_since = null;
    expect(await tell()).toEqual({ notices: 0, emails: 0 });
    db.tables.organization_ai_keys[0].failing_since = '2026-11-02T09:00:00.000Z';
    expect(await tell()).toEqual({ notices: 0, emails: 0 });
    expect(db.tables.chat_notices).toEqual([]);
  });

  it('reminds once, 3 days into the episode', async () => {
    await tell();
    // Too early.
    expect(await tell({ reminder: true }, at(2 * DAY))).toEqual({ notices: 0, emails: 0 });
    expect(await tell({ reminder: true }, at(3 * DAY + 1000))).toEqual({ notices: 2, emails: 1 });
    expect(db.tables.chat_notices.at(-1).dedupe_key).toBe(`own_key:openai:${SINCE}:reminder`);
    expect(deliverEmail.mock.calls.at(-1)[0].subject).toBe(
      "Reminder: your AI key for GetCito still isn't working",
    );
    // Then none.
    expect(await tell({ reminder: true }, at(4 * DAY))).toEqual({ notices: 0, emails: 0 });
  });
});

describe('the e-mail', () => {
  it('says why, that nothing moved to the AI limit, and where to fix it, naming no brand', () => {
    const { html } = renderOwnKeyEmail({
      provider: 'anthropic',
      failureClass: 'invalid',
      workspace: 'Acme <Coffee>',
    });
    expect(html).toContain("Anthropic turned down your workspace's key.");
    expect(html).toContain("None of their runs moved to your plan's AI limit.");
    expect(html).toContain('Acme &lt;Coffee&gt;');
    expect(html).toContain('/dashboard/settings/ai-providers');
    expect(html).toContain('Open AI Providers');
  });

  it('words each class', () => {
    expect(keyWhy('openai', 'no_credit')).toBe('Your OpenAI account is out of credit.');
    expect(keyWhy('azure', 'model')).toBe(
      "Microsoft Azure OpenAI can't reach the model set for your key.",
    );
    expect(keyWhy('google', 'unreadable')).toBe(
      "Your saved Google Gemini key can't be read any more.",
    );
  });
});
