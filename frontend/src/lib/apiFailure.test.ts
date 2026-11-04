import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_ANSWER,
  apiFailure,
  isSubscriptionInactive,
  isTransientStatus,
  readWithOneRetry,
  responseFailure,
} from './apiFailure';

describe('apiFailure', () => {
  it('reads a bad or expired session from 401 only', () => {
    // middleware/index.js answers with a message.
    expect(apiFailure(401, { message: 'Unauthorized API Request' })).toBe('session');
    // The old bare "Unauthorized" was another workspace's brand, not the session.
    expect(apiFailure(403, { error: 'Unauthorized' })).toBe('workspace');
  });

  it('tells a used-up allowance from a plan without the feature', () => {
    expect(apiFailure(429, { error: 'quota_exhausted' })).toBe('limit');
    expect(apiFailure(403, { error: 'plan_limit' })).toBe('plan');
    expect(apiFailure(402, { error: 'no_subscription' })).toBe('plan');
  });

  it("tells a workspace whose plan isn't active from a plan without the feature", () => {
    // The server's 402 for any change while the workspace is read-only.
    expect(apiFailure(402, { error: 'plan_limit', code: 'subscription_inactive' })).toBe(
      'subscription',
    );
    // Any other 402 is still the plan.
    expect(apiFailure(402, { error: 'plan_limit' })).toBe('plan');
    // A session that expired is still a session first.
    expect(apiFailure(401, { code: 'subscription_inactive' })).toBe('session');
  });

  it("reads the demo brand's refusal as the upgrade dialog's, with its offer", () => {
    // The server's 402 for a run or a change on the demo brand's sample data.
    expect(apiFailure(402, { error: 'Demo brand', code: 'demo_brand' })).toBe('subscription');
    expect(apiFailure(401, { code: 'demo_brand' })).toBe('session');
  });

  it('reads a rate limit as busy, never as an allowance to upgrade', () => {
    // backend/src/middleware/rateLimiter.js: a message, no error.
    const limiter = { success: false, message: 'Too many requests, please try again later.' };
    expect(apiFailure(429, limiter)).toBe('busy');
    // A monthly budget used up (plan-guard's PlanLimitError) is an allowance.
    expect(apiFailure(429, { error: 'plan_limit' })).toBe('limit');
    // Any other 429 is a plain failure.
    expect(apiFailure(429, { error: 'something_else' })).toBe('failed');
  });

  it("reads another workspace's brand from the server's code, and nothing else", () => {
    expect(
      apiFailure(403, { error: "This brand isn't in your workspace", code: 'not_in_workspace' }),
    ).toBe('workspace');
    // Before the server deploy, its bare 403.
    expect(apiFailure(403, { error: 'Unauthorized' })).toBe('workspace');
    // Any other 403 is no workspace, and no plan.
    expect(apiFailure(403, { error: 'Only admins can do this' })).toBe('failed');
    expect(apiFailure(403, { error: 'Only admins can do this', code: 'forbidden' })).toBe('failed');
  });

  it("reads a brand of the workspace the person wasn't given as one to switch from", () => {
    // Selected brands (BRAND-ACCESS): the server's no_brand_access.
    expect(
      apiFailure(403, { error: "You don't have access to this brand", code: 'no_brand_access' }),
    ).toBe('workspace');
    // A session that expired is still a session first.
    expect(apiFailure(401, { code: 'no_brand_access' })).toBe('session');
  });

  it("doesn't take an account without an organization for a plan to upgrade", () => {
    // plan-guard's 400 carries plan_limit too.
    expect(apiFailure(400, { error: 'plan_limit' })).toBe('failed');
  });

  it('reads something gone as not found, and anything else as a failure', () => {
    expect(apiFailure(404, { error: 'Opportunity not found' })).toBe('not_found');
    expect(apiFailure(500, {})).toBe('failed');
    expect(apiFailure(502)).toBe('failed');
  });
});

describe('isSubscriptionInactive', () => {
  const body = { error: 'plan_limit', code: 'subscription_inactive', message: 'Read-only' };

  it('reads the code from a body, or from the text an error carries', () => {
    expect(isSubscriptionInactive(body)).toBe(true);
    // The AI SDK's chat transport: new Error(await response.text()).
    expect(isSubscriptionInactive(new Error(JSON.stringify(body)).message)).toBe(true);
  });

  it("reads the demo brand's refusal the same way", () => {
    expect(isSubscriptionInactive({ code: 'demo_brand' })).toBe(true);
    expect(isSubscriptionInactive(JSON.stringify({ code: 'demo_brand' }))).toBe(true);
  });

  it("reads a server action's refusal by its digest, all production keeps of it", () => {
    const masked = 'An error occurred in the Server Components render.';
    const refusal = Object.assign(new Error(masked), { digest: 'subscription_inactive' });
    expect(isSubscriptionInactive(refusal)).toBe(true);
    expect(isSubscriptionInactive(Object.assign(new Error(masked), { digest: '1234' }))).toBe(
      false,
    );
  });

  it('is false for anything else', () => {
    expect(isSubscriptionInactive({ error: 'plan_limit' })).toBe(false);
    expect(isSubscriptionInactive('Failed to fetch the chat response.')).toBe(false);
    expect(isSubscriptionInactive(null)).toBe(false);
    expect(isSubscriptionInactive(undefined)).toBe(false);
  });
});

describe('a read whose failure comes back as a value', () => {
  afterEach(() => vi.useRealTimers());

  it('takes the proxy saying the API is down as transient, and nothing else', () => {
    expect([502, 503, 504].every(isTransientStatus)).toBe(true);
    expect([400, 401, 403, 404, 429, 500].some(isTransientStatus)).toBe(false);
  });

  it('reads a failed response, also one whose body is not JSON', async () => {
    expect(await responseFailure(new Response('Bad Gateway', { status: 502 }))).toEqual({
      ok: false,
      failure: 'failed',
      retryable: true,
    });
    expect(
      await responseFailure(
        new Response(JSON.stringify({ message: 'Unauthorized API Request' }), { status: 401 }),
      ),
    ).toEqual({ ok: false, failure: 'session', retryable: false });
  });

  it('tries once more after the delay when trying again may help', async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockResolvedValueOnce(NO_ANSWER)
      .mockResolvedValueOnce({ ok: true, value: 1 });
    const result = readWithOneRetry(read, 1500);
    await vi.advanceTimersByTimeAsync(1499);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true, value: 1 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('tries only once more, and not at all when it would not help', async () => {
    const down = vi.fn().mockResolvedValue(NO_ANSWER);
    expect(await readWithOneRetry(down, 0)).toEqual(NO_ANSWER);
    expect(down).toHaveBeenCalledTimes(2);

    const refused = { ok: false as const, failure: 'workspace' as const, retryable: false };
    const notMine = vi.fn().mockResolvedValue(refused);
    expect(await readWithOneRetry(notMine, 0)).toEqual(refused);
    expect(notMine).toHaveBeenCalledTimes(1);
  });

  it('reads a server action that threw on its way as no answer', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Minified React error #441'));
    expect(await readWithOneRetry(read, 0)).toEqual(NO_ANSWER);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
