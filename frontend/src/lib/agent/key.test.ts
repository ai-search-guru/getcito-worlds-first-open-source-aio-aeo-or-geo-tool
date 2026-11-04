import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The provider and key Chat uses: the organization's active key on cloud,
 * the operator's Anthropic key on self-host.
 */

let row: unknown;
const eqs: [string, unknown][] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          eqs.push([col, val]);
          return chain;
        },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return chain;
    },
  },
}));

vi.mock('@/lib/agent/keyEncryption', () => ({
  decryptApiKey: (envelope: string) => (envelope === 'bad' ? null : `plain(${envelope})`),
}));

const { isAgentKeyConfigured, readActiveKey, resolveAgentModelConfig } = await import('./key');

beforeEach(() => {
  row = null;
  eqs.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveAgentModelConfig', () => {
  it("uses the organization's active key, with its provider and settings, on cloud", async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    vi.stubEnv('ANTHROPIC_API_KEY', 'operator-key');
    row = { provider: 'openrouter', key_encrypted: 'env1', settings: { model: 'openai/gpt-5.5' } };
    expect(await resolveAgentModelConfig('org1')).toEqual({
      provider: 'openrouter',
      apiKey: 'plain(env1)',
      settings: { model: 'openai/gpt-5.5' },
    });
    expect(eqs).toEqual([
      ['organization_id', 'org1'],
      ['active', true],
    ]);
  });

  it('is null on cloud without an active key, or with one that no longer decrypts', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    vi.stubEnv('ANTHROPIC_API_KEY', 'operator-key');
    expect(await resolveAgentModelConfig('org1')).toBeNull();
    row = { provider: 'openai', key_encrypted: 'bad', settings: {} };
    expect(await resolveAgentModelConfig('org1')).toBeNull();
  });

  it("uses the operator's Anthropic key on self-host", async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    vi.stubEnv('ANTHROPIC_API_KEY', 'operator-key');
    expect(await resolveAgentModelConfig('org1')).toEqual({
      provider: 'anthropic',
      apiKey: 'operator-key',
      settings: {},
    });
    expect(eqs).toHaveLength(0);
  });
});

describe('readActiveKey', () => {
  it('tells a key that can’t be decrypted from none saved', async () => {
    expect(await readActiveKey('org1')).toEqual({ state: 'none' });
    row = { provider: 'azure', key_encrypted: 'bad', settings: {} };
    expect(await readActiveKey('org1')).toEqual({ state: 'unreadable', provider: 'azure' });
    row = { provider: 'google', key_encrypted: 'env1', settings: null };
    expect(await readActiveKey('org1')).toEqual({
      state: 'ready',
      config: { provider: 'google', apiKey: 'plain(env1)', settings: {} },
    });
    // A provider the app doesn't know is no key at all.
    row = { provider: 'other', key_encrypted: 'env1', settings: {} };
    expect(await readActiveKey('org1')).toEqual({ state: 'none' });
  });
});

describe('isAgentKeyConfigured', () => {
  it('asks whether the organization has an active key on cloud', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    expect(await isAgentKeyConfigured('org1')).toBe(false);
    row = { provider: 'google' };
    expect(await isAgentKeyConfigured('org1')).toBe(true);
  });
});
