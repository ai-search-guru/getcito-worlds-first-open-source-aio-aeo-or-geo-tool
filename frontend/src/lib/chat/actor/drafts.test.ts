// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';
import type { DraftStart } from '@/lib/content/drafts';

/**
 * Chat's draft writes for a run with no session (create_draft, update_draft
 * runFor): through the same core, the draft the person's own session writes
 * (createContentDraft, updateContentDraft), as that person; and nothing
 * written where their session would be refused: a brand of another
 * workspace or not shared with them, a role that doesn't change drafts, the
 * demo brand, a read-only workspace.
 */

const fake = vi.hoisted(() => ({
  session: null as unknown as FakeSupabase,
  admin: null as unknown as FakeSupabase,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(fake.session, {
      auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
    }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => fake.admin.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => fake.admin.rpc(name, args),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { createFakeSupabase, fakeId } = await import('@/lib/chat/testing/fakeSupabase');
const { DemoBrandError, SubscriptionInactiveError } = await import('@/lib/subscriptionGuard');
const { createContentDraft, updateContentDraft } = await import('@/lib/actions/contentDrafts');
const { createContentDraftFor, updateContentDraftFor } = await import('./drafts');

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const PERSON = 'person-1';
const BRAND = '11111111-1111-4111-8111-111111111111';
const HIDDEN = '22222222-2222-4222-8222-222222222222';
const DEMO = '33333333-3333-4333-8333-333333333333';
const OTHERS = '44444444-4444-4444-8444-444444444444';
const OPPORTUNITY = '55555555-5555-4555-8555-555555555555';
const OTHERS_OPPORTUNITY = '66666666-6666-4666-8666-666666666666';
const PROMPT = '77777777-7777-4777-8777-777777777777';
const OTHERS_PROMPT = '88888888-8888-4888-8888-888888888888';
const TOPIC = '99999999-9999-4999-8999-999999999999';
const OTHERS_TOPIC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DRAFT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HIDDEN_DRAFT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEMO_DRAFT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHERS_DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actor = { userId: PERSON, organizationId: ORG };

const newPage: DraftStart = {
  method: 'create',
  title: ' Pricing FAQ for teams ',
  pageType: 'docs_faq',
  source: { kind: 'opportunity', id: OPPORTUNITY },
};
const importedPage: DraftStart = {
  method: 'optimize',
  title: 'Pricing',
  pageType: 'guide',
  typePicked: true,
  source: { kind: 'content' },
  bodyHtml: '<h1>Pricing</h1><script>steal()</script><p>Plans start at $49.</p>',
  sourceUrl: 'https://acme.example/pricing',
};

const draft = (id: string, brandId: string) => ({
  id,
  brand_id: brandId,
  author: 'user',
  created_by: PERSON,
  title: 'Pricing FAQ',
  body_html: '<h1>Pricing FAQ</h1>',
  page_type: 'docs_faq',
  page_type_source: 'user',
  source_url: null,
  status: 'draft',
  archived_at: null,
  agent_state: null,
  agent_state_at: null,
  updated_at: '2026-11-01T09:00:00.000Z',
});

/** One workspace's data, as the session and the service role each find it. */
function seeded(): FakeSupabase {
  const db = createFakeSupabase();
  Object.assign(db.tables, {
    brands: [
      { id: BRAND, organization_id: ORG, is_demo: false },
      { id: HIDDEN, organization_id: ORG, is_demo: false },
      { id: DEMO, organization_id: ORG, is_demo: true },
      { id: OTHERS, organization_id: OTHER_ORG, is_demo: false },
    ],
    // A Manager with Selected brands: BRAND is shared with them, HIDDEN isn't.
    profiles: [{ id: PERSON, organization_id: ORG, role: 'manager', brand_scope: 'selected' }],
    member_brands: [{ user_id: PERSON, brand_id: BRAND }],
    organizations: [{ id: ORG, subscription_status: 'active' }],
    content_opportunities: [
      { id: OPPORTUNITY, brand_id: BRAND, prompt_id: PROMPT, cluster_id: null },
      { id: OTHERS_OPPORTUNITY, brand_id: OTHERS, prompt_id: PROMPT, cluster_id: null },
    ],
    // A prompt's brand is its set's, read through prompt_sets!inner: the fake filters on the
    // embedded column by its dotted name, so each prompt carries its set's brand under it.
    prompts: [
      {
        id: PROMPT,
        text: 'crm pricing',
        topic_id: TOPIC,
        is_active: true,
        'prompt_sets.brand_id': BRAND,
      },
      {
        id: OTHERS_PROMPT,
        text: 'crm pricing',
        topic_id: OTHERS_TOPIC,
        is_active: true,
        'prompt_sets.brand_id': OTHERS,
      },
    ],
    content_drafts: [
      draft(DRAFT, BRAND),
      draft(HIDDEN_DRAFT, HIDDEN),
      draft(DEMO_DRAFT, DEMO),
      draft(OTHERS_DRAFT, OTHERS),
    ],
    content_draft_versions: [],
  });
  // The columns' defaults (00204): a person's draft, unless the server says otherwise.
  db.defaults.content_drafts = () => ({
    author: 'user',
    status: 'draft',
    archived_at: null,
    agent_state: null,
    agent_state_at: null,
    updated_at: '2026-11-01T09:00:00.000Z',
  });
  // can_access_brand (00388), asked about the person.
  db.rpcs.can_access_brand = ({ p_brand_id, p_user_id }) => {
    const brand = db.tables.brands.find((b) => b.id === p_brand_id);
    const person = db.tables.profiles.find((p) => p.id === p_user_id);
    if (!brand || !person || person.organization_id !== brand.organization_id) return false;
    return (
      person.role === 'admin' ||
      person.brand_scope === 'all' ||
      brand.is_demo === true ||
      db.tables.member_brands.some((m) => m.user_id === person.id && m.brand_id === brand.id)
    );
  };
  // content_draft_snapshot (00215): the draft as it is now, kept in History.
  db.rpcs.content_draft_snapshot = ({ p_draft_id, p_origin }) => {
    const row = db.tables.content_drafts.find((d) => d.id === p_draft_id);
    if (!row) return null;
    const id = fakeId();
    db.tables.content_draft_versions.push({
      id,
      draft_id: row.id,
      origin: p_origin,
      title: row.title,
      body_html: row.body_html,
    });
    return id;
  };
  return db;
}

/** A draft's row, its id aside: the two paths' new drafts have their own. */
function rowOf(db: FakeSupabase, id: string) {
  const row = { ...db.tables.content_drafts.find((d) => d.id === id) };
  delete row.id;
  return row;
}
/** History's versions, as kept: their page and what they were kept for. */
const versionsOf = (db: FakeSupabase) =>
  db.tables.content_draft_versions.map(({ origin, title, body_html }) => ({
    origin,
    title,
    body_html,
  }));
/** Whatever the service role wrote: rows, and History's snapshots. */
const writesOf = (db: FakeSupabase) =>
  db.log.filter(([name, kind]) => kind !== 'select' && name !== 'can_access_brand');
const person = (fields: Record<string, unknown>) =>
  Object.assign(fake.admin.tables.profiles[0], fields);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
  fake.session = seeded();
  fake.admin = seeded();
});
afterEach(() => vi.unstubAllEnvs());

describe('createContentDraftFor', () => {
  it('writes the draft the person’s session writes, as the person', async () => {
    const made: string[] = [];
    for (const start of [newPage, importedPage]) {
      const viaSession = await createContentDraft(BRAND, start);
      const viaRun = await createContentDraftFor(actor, BRAND, start);
      expect(rowOf(fake.admin, viaRun)).toEqual(rowOf(fake.session, viaSession));
      made.push(viaRun);
    }
    // Theirs, not the Content Agent's: in the Library as their draft, not for review.
    expect(rowOf(fake.admin, made[0])).toMatchObject({
      brand_id: BRAND,
      created_by: PERSON,
      author: 'user',
      status: 'draft',
      title: 'Pricing FAQ for teams',
      body_html: '<h1>Pricing FAQ for teams</h1>',
      opportunity_id: OPPORTUNITY,
      prompt_ids: [PROMPT],
      page_type_source: 'detected',
    });
    // A page brought in: cleaned as a save is, and kept in History as the live page.
    expect(rowOf(fake.admin, made[1]).body_html).not.toContain('<script');
    expect(versionsOf(fake.admin)).toEqual(versionsOf(fake.session));
    expect(versionsOf(fake.admin)).toEqual([
      { origin: 'import', title: 'Pricing', body_html: rowOf(fake.admin, made[1]).body_html },
    ]);
  });

  it('keeps where it was made: the editor’s unless said, else Chat’s or an agent’s with its chat (00463)', async () => {
    const CHAT = 'cccccccc-0000-4000-8000-000000000001';
    const plain = await createContentDraftFor(actor, BRAND, newPage);
    expect(rowOf(fake.admin, plain)).toMatchObject({ origin: 'editor', conversation_id: null });
    const fromChat = await createContentDraftFor(actor, BRAND, {
      ...newPage,
      origin: 'chat',
      conversationId: CHAT,
    });
    expect(rowOf(fake.admin, fromChat)).toMatchObject({ origin: 'chat', conversation_id: CHAT });
    const byAgent = await createContentDraftFor(actor, BRAND, {
      ...newPage,
      origin: 'agent',
      conversationId: CHAT,
    });
    expect(rowOf(fake.admin, byAgent)).toMatchObject({ origin: 'agent', conversation_id: CHAT });
    await expect(
      createContentDraftFor(actor, BRAND, { ...newPage, conversationId: 'nope' }),
    ).rejects.toThrow('invalid');
  });

  it('is every member’s, as saving a draft is', async () => {
    person({ role: 'analyst' });
    await expect(createContentDraftFor(actor, BRAND, newPage)).resolves.toEqual(expect.any(String));
  });

  it('refuses a brand of another workspace or not shared with the person, writing nothing', async () => {
    await expect(createContentDraftFor(actor, OTHERS, newPage)).rejects.toThrow('not_found');
    await expect(createContentDraftFor(actor, HIDDEN, newPage)).rejects.toThrow('not_found');
    // The service role reads past row-level security: a source is the brand's, or nothing.
    await expect(
      createContentDraftFor(actor, BRAND, {
        ...newPage,
        source: { kind: 'opportunity', id: OTHERS_OPPORTUNITY },
      }),
    ).rejects.toThrow('not_found');
    // A run of someone who has left the workspace.
    person({ organization_id: OTHER_ORG });
    await expect(createContentDraftFor(actor, BRAND, newPage)).rejects.toThrow('not_found');
    expect(writesOf(fake.admin)).toEqual([]);
  });

  it('starts from a prompt or a topic of the brand’s only', async () => {
    for (const source of [
      { kind: 'prompt', id: PROMPT },
      { kind: 'topic', id: TOPIC },
    ] as const) {
      const id = await createContentDraftFor(actor, BRAND, { ...newPage, source });
      expect(rowOf(fake.admin, id).prompt_ids).toEqual([PROMPT]);
    }
    const drafts = fake.admin.tables.content_drafts.length;
    // Another brand's, which the service role would read past row-level security.
    for (const source of [
      { kind: 'prompt', id: OTHERS_PROMPT },
      { kind: 'topic', id: OTHERS_TOPIC },
    ] as const) {
      await expect(createContentDraftFor(actor, BRAND, { ...newPage, source })).rejects.toThrow(
        'not_found',
      );
    }
    expect(fake.admin.tables.content_drafts).toHaveLength(drafts);
  });

  it('refuses the demo brand and a read-only workspace, writing nothing', async () => {
    await expect(createContentDraftFor(actor, DEMO, newPage)).rejects.toBeInstanceOf(
      DemoBrandError,
    );
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    fake.admin.tables.organizations[0].subscription_status = 'canceled';
    await expect(createContentDraftFor(actor, BRAND, newPage)).rejects.toBeInstanceOf(
      SubscriptionInactiveError,
    );
    expect(writesOf(fake.admin)).toEqual([]);
  });
});

describe('updateContentDraftFor', () => {
  const change = {
    title: 'Pricing FAQ for teams',
    bodyHtml: '<h1>Pricing FAQ for teams</h1><p onclick="steal()">Plans start at $49.</p>',
  };

  it('changes the draft as the person’s session does, the page before kept first', async () => {
    const viaSession = await updateContentDraft(DRAFT, change);
    const viaRun = await updateContentDraftFor(actor, DRAFT, change);
    expect(viaSession).toMatchObject({ ok: true });
    expect(viaRun).toEqual({ ...viaSession, beforeVersionId: expect.any(String) });
    expect(rowOf(fake.admin, DRAFT)).toEqual(rowOf(fake.session, DRAFT));
    expect(rowOf(fake.admin, DRAFT)).toMatchObject({ title: 'Pricing FAQ for teams' });
    expect(rowOf(fake.admin, DRAFT).body_html).not.toContain('onclick');
    expect(versionsOf(fake.admin)).toEqual(versionsOf(fake.session));
    expect(versionsOf(fake.admin)).toEqual([
      { origin: 'agent_before', title: 'Pricing FAQ', body_html: '<h1>Pricing FAQ</h1>' },
    ]);
  });

  it('finds no archived draft, and keeps off a page the Content Agent is writing', async () => {
    const row = fake.admin.tables.content_drafts.find((d) => d.id === DRAFT)!;
    row.archived_at = '2026-10-31T09:00:00.000Z';
    expect(await updateContentDraftFor(actor, DRAFT, change)).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    expect(writesOf(fake.admin)).toEqual([]);
    // Being written now: the change waits for the agent, as the editor's save does.
    Object.assign(row, {
      archived_at: null,
      agent_state: 'writing',
      agent_state_at: new Date().toISOString(),
    });
    expect(await updateContentDraftFor(actor, DRAFT, change)).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    expect(rowOf(fake.admin, DRAFT)).toMatchObject({
      title: 'Pricing FAQ',
      body_html: '<h1>Pricing FAQ</h1>',
    });
  });

  it('gives each refusal its own object, so no caller changes another’s', async () => {
    const first = await updateContentDraftFor(actor, 'not-a-draft', change);
    const second = await updateContentDraftFor(actor, 'not-a-draft', change);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('leaves changing a draft to Admins and Managers', async () => {
    person({ role: 'analyst' });
    expect(await updateContentDraftFor(actor, DRAFT, change)).toMatchObject({
      ok: false,
      reason: 'forbidden_role',
    });
    expect(writesOf(fake.admin)).toEqual([]);
  });

  it('finds no draft of another workspace’s brand or one not shared with the person', async () => {
    for (const id of [OTHERS_DRAFT, HIDDEN_DRAFT, fakeId()]) {
      expect(await updateContentDraftFor(actor, id, change)).toMatchObject({
        ok: false,
        reason: 'not_found',
      });
    }
    expect(await updateContentDraftFor(actor, 'not-a-draft', change)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    // A run of someone who has left the workspace: no longer its Manager.
    person({ organization_id: OTHER_ORG });
    expect(await updateContentDraftFor(actor, DRAFT, change)).toMatchObject({ ok: false });
    expect(writesOf(fake.admin)).toEqual([]);
  });

  it('refuses the demo brand and a read-only workspace, changing nothing', async () => {
    expect(await updateContentDraftFor(actor, DEMO_DRAFT, change)).toMatchObject({
      ok: false,
      reason: 'failed',
    });
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    fake.admin.tables.organizations[0].subscription_status = 'canceled';
    expect(await updateContentDraftFor(actor, DRAFT, change)).toMatchObject({
      ok: false,
      reason: 'failed',
    });
    expect(writesOf(fake.admin)).toEqual([]);
  });
});
