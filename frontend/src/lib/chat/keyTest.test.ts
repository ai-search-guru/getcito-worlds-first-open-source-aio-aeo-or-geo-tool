import { APICallError } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings › AI Providers' Test (AGENT-OWN-KEY §5.2 item 7, §5.4, §11 Q8):
 * one call with no retries, sorted by what it says about the key, and what it
 * found kept on the key.
 */

const fakes = vi.hoisted(() => ({
  generate: vi.fn(),
  checked: vi.fn(async () => {}),
  failing: vi.fn(async () => ({ started: true, since: null })),
  working: vi.fn(async () => ({ cleared: false, resumed: 0 })),
  resume: vi.fn(async () => 2),
  resolve: vi.fn(async () => {}),
}));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: fakes.generate,
}));
vi.mock('./keyHealth', () => ({
  markKeyChecked: fakes.checked,
  markKeyFailing: fakes.failing,
  markKeyWorking: fakes.working,
  resumeOwnKeyAgents: fakes.resume,
  resolveOwnKeyNotices: fakes.resolve,
}));
// The engine's model choice reads keys with the admin client: not here.
vi.mock('./key', () => ({ resolveChatModelKey: vi.fn() }));

const { keepKeyCheck, keyCheckOf, testOwnKey, testSavedKey } = await import('./keyTest');

const refused = new APICallError({
  message: 'failed',
  url: 'https://api.openai.com/v1/chat/completions',
  requestBodyValues: {},
  statusCode: 401,
  responseBody: JSON.stringify({ error: { code: 'invalid_api_key' } }),
});
const busy = new APICallError({
  message: 'failed',
  url: 'https://api.anthropic.com/v1/messages',
  requestBodyValues: {},
  statusCode: 529,
  responseBody: '{}',
});
const OPENAI = { provider: 'openai' as const, apiKey: 'sk-test', settings: { model: 'gpt-5.5' } };
const ANTHROPIC = { provider: 'anthropic' as const, apiKey: 'sk-ant-test', settings: {} };
const NOW = new Date('2026-11-01T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('testOwnKey', () => {
  it('makes one tiny call with no retries, with Auto’s reading model on an Anthropic key', async () => {
    fakes.generate.mockResolvedValue({ text: 'OK' });
    expect(await testOwnKey(ANTHROPIC)).toEqual({ outcome: 'working' });
    const [call] = fakes.generate.mock.calls[0];
    expect(call).toMatchObject({ maxRetries: 0, maxOutputTokens: 16 });
    expect((call.model as { modelId: string }).modelId).toBe('claude-haiku-5-5');

    await testOwnKey(OPENAI);
    expect((fakes.generate.mock.calls[1][0].model as { modelId: string }).modelId).toBe('gpt-5.5');
  });

  it('reads a refusal as the key’s class, and a busy provider as unknown', async () => {
    fakes.generate.mockRejectedValueOnce(refused);
    expect(await testOwnKey(OPENAI)).toEqual({ outcome: 'failing', class: 'invalid', status: 401 });
    fakes.generate.mockRejectedValueOnce(busy);
    expect(await testOwnKey(ANTHROPIC)).toEqual({ outcome: 'unknown' });
  });

  it('fails a saved key that can’t be read without a call', async () => {
    expect(await testSavedKey({ state: 'unreadable', provider: 'azure' })).toEqual({
      outcome: 'failing',
      class: 'unreadable',
      status: null,
    });
    expect(fakes.generate).not.toHaveBeenCalled();
  });
});

describe('keyCheckOf', () => {
  it('takes a working key, warns on no credit, refuses the rest of the key classes', () => {
    expect(keyCheckOf({ outcome: 'working' })).toBe('working');
    expect(keyCheckOf({ outcome: 'unknown' })).toBe('unchecked');
    expect(keyCheckOf({ outcome: 'failing', class: 'no_credit', status: 429 })).toBe('no_credit');
    for (const cls of ['invalid', 'model', 'unreadable'] as const) {
      expect(keyCheckOf({ outcome: 'failing', class: cls, status: null })).toBe('refused');
    }
  });
});

describe('keepKeyCheck', () => {
  it('keeps when a working key was checked, and resumes the agents only for Chat’s key', async () => {
    expect(
      await keepKeyCheck('org', 'openai', { outcome: 'working' }, { active: true, now: NOW }),
    ).toBe(2);
    expect(fakes.checked).toHaveBeenCalledWith('org', 'openai', NOW);
    expect(fakes.working).toHaveBeenCalledWith('org', 'openai', NOW, { resume: false });
    expect(fakes.resume).toHaveBeenCalledWith('org', NOW);
    // Nothing was marked failing (a key saved again): its notices close all the same.
    expect(fakes.resolve).toHaveBeenCalledWith('org', 'openai', NOW);

    fakes.resume.mockClear();
    expect(
      await keepKeyCheck('org', 'azure', { outcome: 'working' }, { active: false, now: NOW }),
    ).toBe(0);
    expect(fakes.resume).not.toHaveBeenCalled();
  });

  it('still resumes the agents when the notices can’t be closed', async () => {
    fakes.resolve.mockRejectedValueOnce(new Error('db down'));
    expect(
      await keepKeyCheck('org', 'openai', { outcome: 'working' }, { active: true, now: NOW }),
    ).toBe(2);
  });

  it('marks a failing key, and keeps nothing when the provider didn’t answer', async () => {
    const failing = { outcome: 'failing' as const, class: 'no_credit' as const, status: 429 };
    await keepKeyCheck('org', 'openai', failing, { active: true, now: NOW });
    expect(fakes.failing).toHaveBeenCalledWith('org', 'openai', failing, NOW);
    expect(fakes.resume).not.toHaveBeenCalled();
    expect(fakes.resolve).not.toHaveBeenCalled();

    vi.clearAllMocks();
    expect(await keepKeyCheck('org', 'openai', { outcome: 'unknown' }, { active: true })).toBe(0);
    expect(fakes.checked).not.toHaveBeenCalled();
  });
});
