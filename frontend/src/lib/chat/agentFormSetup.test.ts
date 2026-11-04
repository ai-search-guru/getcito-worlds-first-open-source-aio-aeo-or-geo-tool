import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { BRAND, ORG, OTHER_ORG, PEOPLE, seedWorkspace } from './testing/chatFixtures';

/**
 * What the create and edit pages know before the form opens (CHAT-21 §D):
 * the person's role, the brands (never the demo brand) and their topics,
 * the plan's engines, Full auto open, locked or off, Settings › Chat's
 * defaults, the names they see and whose key Chat runs on.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
const key = vi.hoisted(() => {
  class OwnKeyUnreadableError extends Error {
    provider: string;
    constructor(provider: string) {
      super('unreadable');
      this.provider = provider;
    }
  }
  return { own: false, unreadable: false, OwnKeyUnreadableError };
});
const keyCap = vi.hoisted(() => ({
  reached: null as { reached: boolean; renewsAt: string | null } | null,
  read: null as { reached: boolean; renewsAt: string | null } | null,
}));
vi.mock('./ownKeyCap', () => ({
  ownKeyCapReached: vi.fn(async () => keyCap.reached),
  readOwnKeyCap: vi.fn(async () => keyCap.read),
}));
vi.mock('./key', () => ({
  OwnKeyUnreadableError: key.OwnKeyUnreadableError,
  resolveChatModelKey: vi.fn(async () => {
    if (key.unreadable) throw new key.OwnKeyUnreadableError('azure');
    return key.own
      ? { source: 'own', config: { provider: 'openai', apiKey: 'k', settings: {} } }
      : { source: 'getcito', config: { provider: 'anthropic', apiKey: 'k', settings: {} } };
  }),
}));
vi.mock('./agentShares', () => ({ readAgentShares: vi.fn(async () => null) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { readAgentContext } = await import('./agents');
const { agentFormSetupFor } = await import('./agentFormSetup');

const BRAND_2 = '33333333-3333-4333-8333-333333333333';
const DEMO = '66666666-6666-4666-8666-666666666666';

async function setupOf(userId: string) {
  const ctx = await readAgentContext({ userId, email: null, organizationId: ORG });
  if (!ctx) throw new Error('no context');
  return agentFormSetupFor(ctx);
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  key.own = false;
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Zeta', is_demo: false },
    { id: BRAND_2, organization_id: ORG, name: 'Alpha', is_demo: false },
    { id: DEMO, organization_id: ORG, name: 'Demo', is_demo: true },
    {
      id: 'f0000000-0000-4000-8000-000000000001',
      organization_id: OTHER_ORG,
      name: 'Theirs',
      is_demo: false,
    },
  ];
  db.tables.topics = [
    { id: 't1', brand_id: BRAND, name: 'Pricing', is_active: true },
    { id: 't2', brand_id: BRAND, name: 'Old', is_active: false },
    { id: 't3', brand_id: DEMO, name: 'Sample', is_active: true },
  ];
  db.tables.chat_agents = [
    {
      id: 'a1',
      organization_id: ORG,
      name: 'Shared one',
      visibility: 'workspace',
      owner_id: PEOPLE.admin,
    },
    {
      id: 'a2',
      organization_id: ORG,
      name: 'My own',
      visibility: 'private',
      owner_id: PEOPLE.manager,
    },
    {
      id: 'a3',
      organization_id: ORG,
      name: 'Their private',
      visibility: 'private',
      owner_id: PEOPLE.otherManager,
    },
  ];
});

describe('agentFormSetupFor', () => {
  it('reads the brands without the demo, their active topics, and the plan’s engines', async () => {
    const setup = await setupOf(PEOPLE.manager);
    expect(setup.role).toBe('manager');
    expect(setup.brands).toEqual([
      { id: BRAND_2, name: 'Alpha' },
      { id: BRAND, name: 'Zeta' },
    ]);
    expect(setup.topics).toEqual([{ id: 't1', name: 'Pricing', brandId: BRAND }]);
    expect(setup.engines.length).toBeGreaterThan(0);
    expect(setup).toMatchObject({
      fullAuto: 'open',
      planName: 'Growth',
      runShareDefault: 0.1,
      workspaceAgentsAdminsOnly: false,
      ownKeyProvider: null,
    });
  });

  it('names only the agents the person sees; an Admin sees them all', async () => {
    expect((await setupOf(PEOPLE.manager)).takenNames.sort()).toEqual(['My own', 'Shared one']);
    expect((await setupOf(PEOPLE.admin)).takenNames.sort()).toEqual([
      'My own',
      'Shared one',
      'Their private',
    ]);
  });

  it('locks Full auto below Growth, hides it where Settings › Chat turned it off, and follows Settings › Chat’s defaults', async () => {
    db.tables.organizations = db.tables.organizations.map((org) =>
      org.id === ORG ? { ...org, plan: 'starter' } : org,
    );
    const starter = await setupOf(PEOPLE.manager);
    expect(starter).toMatchObject({
      fullAuto: 'plan',
      planName: 'Starter',
      fullAutoPlan: 'Growth',
    });
    // Growth's engines are more than Starter's.
    db.tables.organizations = db.tables.organizations.map((org) =>
      org.id === ORG ? { ...org, plan: 'growth' } : org,
    );
    expect((await setupOf(PEOPLE.manager)).engines.length).toBeGreaterThan(starter.engines.length);

    db.tables.chat_settings = [
      {
        organization_id: ORG,
        agent_run_share_default: 0.2,
        agents_full_auto: true,
        workspace_agents_admins_only: true,
        full_auto_for_members: false,
      },
    ];
    expect(await setupOf(PEOPLE.manager)).toMatchObject({
      fullAuto: 'policy',
      runShareDefault: 0.2,
      workspaceAgentsAdminsOnly: true,
    });
    expect((await setupOf(PEOPLE.admin)).fullAuto).toBe('open');
  });

  it('says whose key Chat runs on: the workspace’s own, by provider', async () => {
    key.own = true;
    expect((await setupOf(PEOPLE.admin)).ownKeyProvider).toBe('openai');
    // A saved key that can't be read is still the one agents run on, not the AI limit.
    key.unreadable = true;
    expect((await setupOf(PEOPLE.admin)).ownKeyProvider).toBe('azure');
    key.own = false;
    key.unreadable = false;
  });
});
