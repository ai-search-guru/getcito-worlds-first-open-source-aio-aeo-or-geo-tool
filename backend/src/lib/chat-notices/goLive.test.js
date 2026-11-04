import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Telling people an agent went live on its own (AUTONOMOUS-GO-LIVE §6.4,
 * 00446): the agent's owner and its Notify people who reach the page's
 * brand, once per step, an e-mail by each one's choice, and the action's
 * History; and, when an edit stops an allowed agent (§7.2), the Admin who
 * allowed it and its owner, but not the editor, once per version.
 */

const db = vi.hoisted(() => ({ tables: {} }));
const deliverEmail = vi.hoisted(() => vi.fn(async () => 'sent'));
const readers = vi.hoisted(() => ({ value: new Map() }));

/** A query on the in-memory tables: filters, an insert or an upsert, and select. */
function query(table) {
  const filters = [];
  let upsert = null;
  let insert = null;
  let one = false;
  const chain = {
    select: () => chain,
    eq: (col, val) => {
      const [base, key] = col.split('->>');
      filters.push((r) => (key ? r[base]?.[key] : r[col]) === val);
      return chain;
    },
    in: (col, vals) => (filters.push((r) => vals.includes(r[col])), chain),
    limit: () => chain,
    insert: (row) => ((insert = row), chain),
    upsert: (rows) => ((upsert = rows), chain),
    maybeSingle: () => ((one = true), chain),
    then: (resolve) => {
      const rows = (db.tables[table] ??= []);
      if (insert) {
        rows.push(insert);
        return resolve({ data: null, error: null });
      }
      if (upsert) {
        const written = [];
        for (const row of upsert) {
          if (rows.some((r) => r.user_id === row.user_id && r.dedupe_key === row.dedupe_key)) {
            continue;
          }
          rows.push(row);
          written.push(row);
        }
        return resolve({ data: written, error: null });
      }
      const found = rows.filter((r) => filters.every((f) => f(r)));
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
vi.mock('../access.js', () => ({ brandReaders: async () => readers.value }));
vi.mock('../email.js', () => ({ deliverEmail }));
vi.mock('../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { renderGoLiveOffEmail, renderWentLiveEmail, tellGoLiveOff, tellWentLive } =
  await import('./goLive.js');

const ORG = 'org-1';
const BRAND = 'brand-1';
const EVENT = 'event-1';

beforeEach(() => {
  deliverEmail.mockClear();
  readers.value = new Map([
    ['owner-1', new Set([BRAND])],
    ['notify-1', new Set([BRAND])],
    ['admin-1', new Set([BRAND])],
  ]);
  db.tables = {
    chat_agent_go_live_events: [
      {
        id: EVENT,
        organization_id: ORG,
        agent_id: 'agent-1',
        agent_run_id: 'run-1',
        brand_id: BRAND,
        content_draft_id: 'draft-1',
        target: 'webflow',
        kind: 'cms_draft',
        status: 'done',
      },
    ],
    chat_agents: [{ id: 'agent-1', organization_id: ORG, name: 'Publisher', owner_id: 'owner-1' }],
    chat_agent_runs: [{ id: 'run-1', agent_version: 2, acting_user_id: 'owner-1' }],
    chat_agent_versions: [
      { agent_id: 'agent-1', version: 2, notify_user_ids: ['notify-1', 'outsider', 'blind-1'] },
    ],
    content_drafts: [{ id: 'draft-1', title: 'Pricing FAQ', action_id: null }],
    brands: [{ id: BRAND, name: 'Acme Coffee' }],
    chat_conversations: [{ id: 'chat-1', agent_run_id: 'run-1' }],
    profiles: [
      { id: 'owner-1', organization_id: ORG },
      { id: 'notify-1', organization_id: ORG },
      { id: 'blind-1', organization_id: ORG },
      { id: 'admin-1', organization_id: ORG },
      { id: 'outsider', organization_id: 'org-2' },
    ],
    chat_user_prefs: [{ user_id: 'notify-1', notify_via: 'inbox' }],
    chat_notices: [],
    action_events: [],
    chat_agent_go_live: [
      { agent_id: 'agent-1', organization_id: ORG, version: 2, granted_by: 'admin-1' },
    ],
  };
});

describe('tellWentLive', () => {
  it('tells the owner and the Notify people who reach the brand, once, e-mail by their choice', async () => {
    expect(await tellWentLive({ eventId: EVENT })).toEqual({
      notices: 2,
      emails: 1,
      history: false,
    });
    expect(db.tables.chat_notices).toEqual([
      expect.objectContaining({ user_id: 'owner-1' }),
      expect.objectContaining({ user_id: 'notify-1' }),
    ]);
    expect(db.tables.chat_notices[0]).toEqual({
      organization_id: ORG,
      user_id: 'owner-1',
      kind: 'agent_went_live',
      brand_id: BRAND,
      dedupe_key: `went_live:${EVENT}`,
      payload: {
        agent: 'Publisher',
        agentId: 'agent-1',
        title: 'Pricing FAQ',
        target: 'webflow',
        kind: 'cms_draft',
        draftId: 'draft-1',
        chatId: 'chat-1',
        url: null,
      },
    });
    // Inbox only for notify-1; the owner gets the e-mail.
    expect(deliverEmail).toHaveBeenCalledTimes(1);
    expect(deliverEmail.mock.calls[0][0]).toMatchObject({
      to: ['owner-1@acme.test'],
      subject: 'Publisher sent “Pricing FAQ” to Webflow as a draft',
    });

    // The same step again: nobody is told twice.
    expect(await tellWentLive({ eventId: EVENT })).toMatchObject({ notices: 0, emails: 0 });
    expect(db.tables.chat_notices).toHaveLength(2);
  });

  it('writes the action’s History once when the page works on one', async () => {
    db.tables.content_drafts[0].action_id = 'action-1';
    expect((await tellWentLive({ eventId: EVENT })).history).toBe(true);
    expect((await tellWentLive({ eventId: EVENT })).history).toBe(false);
    expect(db.tables.action_events).toEqual([
      {
        action_id: 'action-1',
        event: 'agent_went_live',
        data: {
          source: 'chat',
          event_id: EVENT,
          agent: 'Publisher',
          title: 'Pricing FAQ',
          to: 'Webflow',
        },
        actor_id: 'owner-1',
      },
    ]);
  });

  it('tells no one of a step that isn’t done, or whose agent or page is gone', async () => {
    db.tables.chat_agent_go_live_events[0].status = 'failed';
    expect(await tellWentLive({ eventId: EVENT })).toEqual({
      notices: 0,
      emails: 0,
      history: false,
    });
    db.tables.chat_agent_go_live_events[0].status = 'done';
    db.tables.chat_agents = [];
    expect(await tellWentLive({ eventId: EVENT })).toEqual({
      notices: 0,
      emails: 0,
      history: false,
    });
    expect(await tellWentLive({ eventId: 'event-x' })).toEqual({
      notices: 0,
      emails: 0,
      history: false,
    });
    expect(db.tables.chat_notices).toEqual([]);
  });

  it('writes words that name the agent, the brand and the page, escaped', () => {
    const { subject, html } = renderWentLiveEmail({
      agent: 'Publisher',
      title: '<Pricing> & plans',
      target: 'wordpress',
      brand: 'Acme',
      draftId: 'draft-1',
      chatId: 'chat-1',
    });
    expect(subject).toBe('Publisher sent “<Pricing> & plans” to WordPress as a draft');
    expect(html).toContain('“&lt;Pricing&gt; &amp; plans”');
    expect(html).toContain('/dashboard/content/editor/draft-1');
    expect(html).toContain('/dashboard/chat/chat-1');
    expect(
      renderWentLiveEmail({
        agent: 'A',
        title: 'T',
        target: 'wix',
        brand: 'B',
        draftId: 'd',
        chatId: null,
      }).html,
    ).not.toContain('/dashboard/chat/');
  });
});

describe('tellWentLive for a page published live (PR 9)', () => {
  it('says where it went live, links the live page, and writes agent_published to the action', async () => {
    Object.assign(db.tables.chat_agent_go_live_events[0], {
      kind: 'publish',
      published_url: 'https://www.acme.example/blog/pricing-faq',
    });
    db.tables.content_drafts[0].action_id = 'action-1';
    await tellWentLive({ eventId: EVENT });
    expect(db.tables.chat_notices[0].payload).toMatchObject({
      kind: 'publish',
      url: 'https://www.acme.example/blog/pricing-faq',
    });
    const mail = deliverEmail.mock.calls[0][0];
    expect(mail.subject).toBe('Publisher published “Pricing FAQ” on acme.example');
    expect(mail.html).toContain('href="https://www.acme.example/blog/pricing-faq"');
    expect(mail.html).toContain('Open the live page');
    expect(db.tables.action_events).toEqual([
      expect.objectContaining({
        event: 'agent_published',
        data: expect.objectContaining({ to: 'acme.example', title: 'Pricing FAQ' }),
      }),
    ]);
  });
});

describe('tellGoLiveOff', () => {
  it('tells the Admin who allowed it and the owner, not the editor, once per version', async () => {
    expect(
      await tellGoLiveOff({ orgId: ORG, agentId: 'agent-1', version: 2, editor: 'owner-1' }),
    ).toEqual({ notices: 1, emails: 1 });
    expect(db.tables.chat_notices).toEqual([
      expect.objectContaining({
        user_id: 'admin-1',
        kind: 'agent_go_live_off',
        brand_id: null,
        dedupe_key: 'go_live_off:agent-1:2',
        payload: { agent: 'Publisher', agentId: 'agent-1' },
      }),
    ]);
    expect(deliverEmail.mock.calls[0][0].subject).toBe('Publisher no longer publishes on its own');
    expect(await tellGoLiveOff({ orgId: ORG, agentId: 'agent-1', version: 2 })).toEqual({
      notices: 1,
      emails: 1,
    });
    expect(db.tables.chat_notices.map((n) => n.user_id)).toEqual(['admin-1', 'owner-1']);
  });

  it('tells no one for a version the agent wasn’t allowed on', async () => {
    expect(await tellGoLiveOff({ orgId: ORG, agentId: 'agent-1', version: 1 })).toEqual({
      notices: 0,
      emails: 0,
    });
    db.tables.chat_agent_go_live = [];
    expect(await tellGoLiveOff({ orgId: ORG, agentId: 'agent-1', version: 2 })).toEqual({
      notices: 0,
      emails: 0,
    });
    expect(renderGoLiveOffEmail({ agent: 'P', agentId: 'agent-1' }).html).toContain(
      '/dashboard/agents/agent-1',
    );
  });
});
