import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Whose key a Chat step runs on: with Chat on, the workspace's own on
 * Enterprise, or for 30 days when it saved one before Chat (CHAT-16 items 19
 * and 28, owner decision 2026-10-30); else GetCito's, which draws on the AI
 * budget. With Chat off, today's Agent Chat: the workspace's own key or
 * nothing on the cloud.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const DAY = 24 * 60 * 60 * 1000;

let org: Record<string, unknown> | null;
let ownKey: Record<string, unknown> | null;
const reads: string[] = [];
const updates: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      reads.push(table);
      let update: Record<string, unknown> | null = null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        update: (row: Record<string, unknown>) => {
          updates.push(row);
          update = row;
          return chain;
        },
        maybeSingle: async () => {
          if (!update) return { data: table === 'organizations' ? org : ownKey, error: null };
          // The start fills an empty date only.
          if (!org || org.legacy_key_until != null) return { data: null, error: null };
          org = { ...org, ...update };
          return { data: { legacy_key_until: update.legacy_key_until }, error: null };
        },
      };
      return chain;
    },
  },
}));

vi.mock('@/lib/agent/keyEncryption', () => ({
  decryptApiKey: (envelope: string) => (envelope === 'bad' ? null : `plain(${envelope})`),
}));

const markKeyFailing = vi.fn(async () => ({ started: true, since: null }));
vi.mock('./keyHealth', () => ({
  markKeyFailing: (...args: unknown[]) => markKeyFailing(...(args as [])),
}));

const {
  OwnKeyUnreadableError,
  chatRunsOnOwnKey,
  ownChatKeyProvider,
  ownKeyAllowed,
  ownKeyAccess,
  resolveChatModelKey,
} = await import('./key');

const CUSTOMER = {
  provider: 'openai',
  key_encrypted: 'env1',
  settings: { model: 'gpt-5.5' },
};

const orgOn = (plan: string, legacy = false, until: string | null = null) => ({
  plan,
  legacy_key_grandfathered: legacy,
  legacy_key_until: until,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'getcito-key');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  org = orgOn('starter');
  ownKey = null;
  reads.length = 0;
  updates.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const GETCITO = {
  source: 'getcito',
  config: { provider: 'anthropic', apiKey: 'getcito-key', settings: {} },
};
const OWN = {
  source: 'own',
  config: { provider: 'openai', apiKey: 'plain(env1)', settings: { model: 'gpt-5.5' } },
};

describe('ownKeyAllowed', () => {
  it('opens own keys to Enterprise only, and to a kept key for its 30 days', () => {
    const now = Date.parse('2026-11-10T00:00:00Z');
    const at = (plan: string, legacy = false, until: string | null = null) =>
      ownKeyAllowed(orgOn(plan, legacy, until), now);
    expect(at('enterprise')).toBe(true);
    expect(at('growth')).toBe(false);
    expect(at('starter')).toBe(false);
    // A key saved before Chat went live (CHAT-16 item 28): not started yet, or before its date.
    expect(at('growth', true)).toBe(true);
    expect(at('starter', true, '2026-11-20T00:00:00Z')).toBe(true);
    expect(at('growth', true, '2026-11-09T00:00:00Z')).toBe(false);
    expect(ownKeyAllowed(null)).toBe(false);
  });
});

describe('ownKeyAccess', () => {
  it('starts a kept key’s 30 days the first time it is needed, once', async () => {
    org = orgOn('growth', true);
    const access = await ownKeyAccess(ORG);
    expect(access.state).toBe('kept');
    const until = Date.parse((access as { until: string }).until);
    expect(Math.abs(until - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
    expect(updates).toHaveLength(1);

    // Started: read back, not moved.
    expect(await ownKeyAccess(ORG)).toEqual(access);
    expect(updates).toHaveLength(1);
  });

  it('locks a kept key after its date, and every plan but Enterprise', async () => {
    org = orgOn('growth', true, new Date(Date.now() - DAY).toISOString());
    expect(await ownKeyAccess(ORG)).toEqual({ state: 'locked' });
    org = orgOn('growth');
    expect(await ownKeyAccess(ORG)).toEqual({ state: 'locked' });
    org = orgOn('enterprise');
    expect(await ownKeyAccess(ORG)).toEqual({ state: 'plan' });
    expect(updates).toHaveLength(0);
  });

  it('is open with Chat off or self-hosted, without a read', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await ownKeyAccess(ORG)).toEqual({ state: 'open' });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await ownKeyAccess(ORG)).toEqual({ state: 'open' });
    expect(reads).toEqual([]);
  });
});

describe('resolveChatModelKey, Chat on', () => {
  it('runs an Enterprise workspace on its own key: its provider bills it', async () => {
    org = orgOn('enterprise');
    ownKey = CUSTOMER;
    expect(await resolveChatModelKey(ORG)).toEqual(OWN);
  });

  it('runs Growth and Starter on GetCito’s key, their own key left aside', async () => {
    for (const plan of ['growth', 'starter']) {
      org = orgOn(plan);
      ownKey = CUSTOMER;
      reads.length = 0;
      expect(await resolveChatModelKey(ORG)).toEqual(GETCITO);
      // Not even read: the plan doesn't include it.
      expect(reads).toEqual(['organizations']);
    }
  });

  it('keeps a key saved before Chat on its own key for 30 days, then the AI budget', async () => {
    org = orgOn('growth', true);
    ownKey = CUSTOMER;
    expect(await resolveChatModelKey(ORG)).toEqual(OWN);
    expect(updates).toHaveLength(1);

    org = orgOn('growth', true, new Date(Date.now() - 1000).toISOString());
    expect(await resolveChatModelKey(ORG)).toEqual(GETCITO);
  });

  it('stops on an own key that can’t be read, marked failing, never GetCito’s key in its place', async () => {
    org = orgOn('enterprise');
    ownKey = { ...CUSTOMER, key_encrypted: 'bad' };
    markKeyFailing.mockClear();
    const thrown = await resolveChatModelKey(ORG).catch((err: unknown) => err);
    expect(thrown).toBeInstanceOf(OwnKeyUnreadableError);
    expect((thrown as InstanceType<typeof OwnKeyUnreadableError>).provider).toBe('openai');
    expect(markKeyFailing).toHaveBeenCalledWith(ORG, 'openai', {
      class: 'unreadable',
      status: null,
    });
    // chatRunsOnOwnKey agrees: the workspace runs on its own key, not the AI limit.
    expect(await chatRunsOnOwnKey(ORG)).toBe(true);

    // A mark that fails still stops Chat.
    markKeyFailing.mockRejectedValueOnce(new Error('down'));
    await expect(resolveChatModelKey(ORG)).rejects.toBeInstanceOf(OwnKeyUnreadableError);
  });

  it('falls back to GetCito’s key when an Enterprise workspace has none', async () => {
    org = orgOn('enterprise');
    expect(await resolveChatModelKey(ORG)).toEqual(GETCITO);
  });

  it('is null with neither key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(await resolveChatModelKey(ORG)).toBeNull();
  });

  it('uses the operator’s key self-hosted, where nothing is metered', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await resolveChatModelKey(ORG)).toEqual(GETCITO);
    expect(reads).toEqual([]);
  });
});

describe('resolveChatModelKey, Chat off', () => {
  beforeEach(() => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
  });

  it('keeps today’s Agent Chat: the workspace’s own key, on any plan', async () => {
    ownKey = CUSTOMER;
    expect(await resolveChatModelKey(ORG)).toEqual(OWN);
    // The plan isn't read: Agent Chat never looked at it.
    expect(reads).toEqual(['organization_ai_keys']);
  });

  it('never falls back to GetCito’s key on the cloud', async () => {
    org = orgOn('enterprise');
    expect(await resolveChatModelKey(ORG)).toBeNull();
  });

  it('is on for the listed workspaces only', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '33333333-3333-4333-8333-333333333333');
    expect(await resolveChatModelKey(ORG)).toBeNull();
  });
});

describe('chatRunsOnOwnKey', () => {
  it('says yes only where resolveChatModelKey would pick the workspace’s own key', async () => {
    org = orgOn('enterprise');
    ownKey = CUSTOMER;
    expect(await chatRunsOnOwnKey(ORG)).toBe(true);

    // No key saved, or the plan leaves it aside: GetCito's key, on the budget.
    ownKey = null;
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
    ownKey = CUSTOMER;
    org = orgOn('growth');
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
    org = orgOn('starter');
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);

    // A key saved before Chat: its 30 days, then the budget.
    org = orgOn('growth', true, new Date(Date.now() + DAY).toISOString());
    expect(await chatRunsOnOwnKey(ORG)).toBe(true);
    org = orgOn('growth', true, new Date(Date.now() - DAY).toISOString());
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
  });

  it('names the own key’s provider for the model menu’s Your key, none on GetCito’s', async () => {
    org = orgOn('enterprise');
    ownKey = CUSTOMER;
    expect(await ownChatKeyProvider(ORG)).toBe(CUSTOMER.provider);
    org = orgOn('growth');
    expect(await ownChatKeyProvider(ORG)).toBeNull();
  });

  it('is no with Chat off or self-hosted, where nothing is metered', async () => {
    org = orgOn('enterprise');
    ownKey = CUSTOMER;
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await chatRunsOnOwnKey(ORG)).toBe(false);
    expect(reads).toEqual([]);
  });
});
