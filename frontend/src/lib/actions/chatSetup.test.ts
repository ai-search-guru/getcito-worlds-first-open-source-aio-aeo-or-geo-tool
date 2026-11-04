// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * The server actions Chat's setup rows call (W2-06), as they run against the
 * member's own client: Admins and Managers only, checked in the action; the
 * brand's own objects only (another brand's topic, prompt or competitor is
 * not found, or left out); duplicates skipped by their natural key; prompts
 * stopped at the plan's locations (partial, or quota_exceeded); a topic
 * taken by its id, never by its name.
 */

const fake = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  role: 'manager' as string,
  maxPrompts: 3,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(fake.db, {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: { access_token: 't' } } }),
      },
    }),
}));
vi.mock('@/lib/subscriptionGuard', () => ({ assertWritable: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({
  analyzeNewPrompts: vi.fn(async () => ({ started: true })),
  getPromptVisibilitySummaries: vi.fn(),
}));
vi.mock('@/lib/guards/planGuard', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/guards/planGuard')>();
  const { PLANS } = await import('@/config/plans');
  return {
    ...real,
    getOrgPlan: vi.fn(async () => ({
      ...PLANS.growth,
      limits: { ...PLANS.growth.limits, maxPrompts: fake.maxPrompts },
    })),
  };
});

const { createFakeSupabase } = await import('@/lib/chat/testing/fakeSupabase');
const { addTopicPrompts, pauseBrandPrompts } = await import('./prompt');
const { addBrandTopic, renameBrandTopic } = await import('./topic');
const { addCompetitors, removeBrandCompetitor } = await import('./competitor');

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOPIC = '33333333-3333-4333-8333-333333333331';
const PAUSED_TWIN = '33333333-3333-4333-8333-333333333332';
const THEIR_TOPIC = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  fake.role = 'manager';
  fake.maxPrompts = 3;
  fake.db = createFakeSupabase();
  Object.assign(fake.db.tables, {
    profiles: [{ id: 'u1', role: 'manager' }],
    brands: [
      {
        id: BRAND,
        organization_id: 'org',
        region: 'US',
        state: null,
        shopping_mode_enabled: false,
      },
      { id: OTHER, organization_id: 'org', region: 'US', state: null },
    ],
    topics: [
      { id: TOPIC, brand_id: BRAND, name: 'Pricing', is_active: true },
      // The same name, paused: a prompt must never land in it.
      { id: PAUSED_TWIN, brand_id: BRAND, name: 'Pricing', is_active: false },
      { id: THEIR_TOPIC, brand_id: OTHER, name: 'Theirs', is_active: true },
    ],
    prompt_sets: [
      { id: 'set-1', brand_id: BRAND, created_at: '2026-01-01T00:00:00Z' },
      { id: 'set-2', brand_id: OTHER, created_at: '2026-01-01T00:00:00Z' },
    ],
    prompts: [
      {
        id: 'p1',
        prompt_set_id: 'set-1',
        text: 'CRM pricing',
        is_active: true,
        platforms: ['chatgpt-web'],
        models: [],
        regions: ['US'],
        created_at: '2026-01-02T00:00:00Z',
      },
      { id: 'p2', prompt_set_id: 'set-1', text: 'crm trial', is_active: false, regions: ['US'] },
      { id: 'p3', prompt_set_id: 'set-2', text: 'theirs', is_active: true, regions: ['US'] },
    ],
    competitors: [
      { id: 'c1', brand_id: BRAND, name: 'Peec AI', domain: 'peec.ai' },
      { id: 'c2', brand_id: OTHER, name: 'Profound', domain: 'tryprofound.com' },
    ],
  });
  // As the table's defaults: a new topic is active.
  fake.db.defaults = { topics: () => ({ is_active: true }) };
  // The signed-in member's role, as profiles has it.
  fake.db.tables.profiles = [{ id: 'u1', role: fake.role }];
  let n = 0;
  fake.db.rpcs = {
    // import_prompts (00122): the rows, up to the plan's locations (one each here).
    import_prompts: ({ p_rows, p_max_locations }) =>
      (p_rows as { idx: number }[])
        .slice(0, Math.max(0, (p_max_locations as number) - 1))
        .map((row) => ({ idx: row.idx, id: `new-${++n}` })),
    org_prompt_location_usage: () => [{ brand_id: BRAND, locations: 1 }],
  };
});

const asRole = (role: string) => {
  fake.role = role;
  fake.db.tables.profiles = [{ id: 'u1', role }];
};

describe('addTopicPrompts', () => {
  it('adds the new texts to the topic by its id, skips the tracked ones, and is partial past the plan', async () => {
    const result = await addTopicPrompts(BRAND, TOPIC, [
      'crm pricing ',
      'best crm',
      'crm for teams',
      'crm for clinics',
    ]);
    expect(result).toMatchObject({
      ok: true,
      code: 'partial',
      added: [
        { id: 'new-1', text: 'best crm' },
        { id: 'new-2', text: 'crm for teams' },
      ],
      skipped: [
        { text: 'crm pricing', reason: 'duplicate' },
        { text: 'crm for clinics', reason: 'plan_limit' },
      ],
    });
  });

  it('says quota_exceeded when the plan has room for none', async () => {
    fake.maxPrompts = 1;
    const result = await addTopicPrompts(BRAND, TOPIC, ['best crm']);
    expect(result).toMatchObject({ ok: false, reason: 'quota_exceeded' });
    expect(result.ok === false && result.message).toContain('active prompt locations');
  });

  it('finds no topic of another brand, nor a paused one', async () => {
    for (const topic of [THEIR_TOPIC, PAUSED_TWIN]) {
      expect(await addTopicPrompts(BRAND, topic, ['best crm'])).toMatchObject({
        ok: false,
        reason: 'not_found',
      });
    }
  });

  it('refuses an Analyst and an Agency partner before reading anything', async () => {
    for (const role of ['analyst', 'agency_partner']) {
      asRole(role);
      expect(await addTopicPrompts(BRAND, TOPIC, ['best crm'])).toMatchObject({
        ok: false,
        reason: 'forbidden_role',
      });
    }
    expect(fake.db.tables.prompts).toHaveLength(3);
  });
});

describe('pauseBrandPrompts', () => {
  it('pauses only the brand’s active prompts among the ids, and says which', async () => {
    expect(await pauseBrandPrompts(BRAND, ['p1', 'p2', 'p3'])).toEqual({
      ok: true,
      paused: ['p1'],
    });
    expect(fake.db.tables.prompts.find((p) => p.id === 'p3')!.is_active).toBe(true);
    // None left to pause: a refusal, not a change.
    expect(await pauseBrandPrompts(BRAND, ['p1', 'p2', 'p3'])).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('refuses an Agency partner', async () => {
    asRole('agency_partner');
    expect(await pauseBrandPrompts(BRAND, ['p1'])).toMatchObject({ reason: 'forbidden_role' });
  });
});

describe('addBrandTopic and renameBrandTopic', () => {
  it('adds a topic unless an active one has the name, case and spacing aside', async () => {
    expect(await addBrandTopic(BRAND, ' pricing ')).toMatchObject({
      ok: false,
      reason: 'duplicate',
    });
    expect(await addBrandTopic(BRAND, 'Integrations')).toMatchObject({
      ok: true,
      topic: { name: 'Integrations' },
    });
  });

  it('renames one of the brand’s active topics, unless the name is taken or the same', async () => {
    await addBrandTopic(BRAND, 'Integrations');
    expect(await renameBrandTopic(TOPIC, 'integrations')).toMatchObject({ reason: 'duplicate' });
    expect(await renameBrandTopic(TOPIC, 'Pricing')).toMatchObject({ reason: 'invalid' });
    expect(await renameBrandTopic(PAUSED_TWIN, 'Plans')).toMatchObject({ reason: 'not_found' });
    expect(await renameBrandTopic(TOPIC, 'Plans')).toMatchObject({
      ok: true,
      topic: { name: 'Plans' },
    });
  });

  it('refuses an Analyst both', async () => {
    asRole('analyst');
    expect(await addBrandTopic(BRAND, 'Security')).toMatchObject({ reason: 'forbidden_role' });
    expect(await renameBrandTopic(TOPIC, 'Plans')).toMatchObject({ reason: 'forbidden_role' });
  });
});

describe('addCompetitors and removeBrandCompetitor', () => {
  it('skips a domain the brand has, written any way, and adds the rest', async () => {
    const result = await addCompetitors(BRAND, [
      { name: 'Peec', domain: 'https://www.Peec.ai/' },
      { name: 'Otterly', domain: 'otterly.ai' },
    ]);
    expect(result).toMatchObject({
      ok: true,
      code: 'partial',
      added: [{ name: 'Otterly', domain: 'otterly.ai' }],
      skipped: [{ name: 'Peec', reason: 'duplicate' }],
    });
    expect(await addCompetitors(BRAND, [{ name: 'Peec AI', domain: 'peec.ai' }])).toMatchObject({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('removes only the brand’s own competitor', async () => {
    expect(await removeBrandCompetitor(BRAND, 'c2')).toMatchObject({ reason: 'not_found' });
    expect(fake.db.tables.competitors).toHaveLength(2);
    expect(await removeBrandCompetitor(BRAND, 'c1')).toMatchObject({
      ok: true,
      removed: { name: 'Peec AI' },
    });
    expect(fake.db.tables.competitors.map((c) => c.id)).toEqual(['c2']);
  });

  it('refuses an Agency partner both, though the table would let them', async () => {
    asRole('agency_partner');
    expect(await addCompetitors(BRAND, [{ name: 'X', domain: 'x.ai' }])).toMatchObject({
      reason: 'forbidden_role',
    });
    expect(await removeBrandCompetitor(BRAND, 'c1')).toMatchObject({ reason: 'forbidden_role' });
    expect(fake.db.tables.competitors).toHaveLength(2);
  });
});

describe('a failure on the way', () => {
  it('comes back as failed from each action, never a throw (#427)', async () => {
    // The role can't be read: isManager throws, and the action says it failed.
    fake.db.failures.profiles = { message: 'db down' };
    const results = [
      await addTopicPrompts(BRAND, TOPIC, ['best crm']),
      await pauseBrandPrompts(BRAND, ['p1']),
      await addBrandTopic(BRAND, 'Security'),
      await renameBrandTopic(TOPIC, 'Plans'),
      await addCompetitors(BRAND, [{ name: 'X', domain: 'x.ai' }]),
      await removeBrandCompetitor(BRAND, 'c1'),
    ];
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, reason: 'failed' });
    }
    expect(fake.db.tables.prompts).toHaveLength(3);
    expect(fake.db.tables.competitors).toHaveLength(2);
  });
});
