import { describe, expect, it, vi } from 'vitest';
import { TURNSTILE_VERIFY_URL, verifyBotToken } from './turnstile.js';

const reply = (body) => vi.fn(async () => ({ json: async () => body }));

describe('verifyBotToken', () => {
  it('asks Turnstile with the secret, the token and the address', async () => {
    const fetchImpl = reply({ success: true });
    const env = { TURNSTILE_SECRET_KEY: 'secret' };
    expect(await verifyBotToken('tok', '203.0.113.9', { env, fetchImpl })).toBe('pass');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(Object.fromEntries(init.body)).toEqual({
      secret: 'secret',
      response: 'tok',
      remoteip: '203.0.113.9',
    });
  });

  it('fails a refused, missing or unanswered token', async () => {
    const env = { TURNSTILE_SECRET_KEY: 'secret' };
    expect(await verifyBotToken('tok', null, { env, fetchImpl: reply({ success: false }) })).toBe(
      'fail',
    );
    const fetchImpl = vi.fn();
    expect(await verifyBotToken('', null, { env, fetchImpl })).toBe('fail');
    expect(fetchImpl).not.toHaveBeenCalled();
    const down = vi.fn(async () => {
      throw new Error('timeout');
    });
    expect(await verifyBotToken('tok', null, { env, fetchImpl: down })).toBe('fail');
  });

  it('skips the check in development without a key, and refuses on the cloud', async () => {
    const fetchImpl = vi.fn();
    expect(await verifyBotToken(undefined, null, { env: {}, fetchImpl })).toBe('pass');
    expect(await verifyBotToken('tok', null, { env: { IS_CLOUD: 'true' }, fetchImpl })).toBe(
      'unconfigured',
    );
    expect(await verifyBotToken('tok', null, { env: { NODE_ENV: 'production' }, fetchImpl })).toBe(
      'unconfigured',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
