// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';

/**
 * One change per key for 24 hours (CHAT-20 §11b, §11c): a repeat gets the
 * first result, two calls at once make one change, a failure gives the key
 * back, and the same key with another request is a mismatch.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const {
  IDEMPOTENCY_TTL_MS,
  STALE_CLAIM_MS,
  canonicalJson,
  idempotencyKey,
  requestHash,
  sweepExpiredKeys,
  withIdempotencyKey,
} = await import('./idempotency');

const ORG = '11111111-1111-4111-8111-111111111111';
const STEP = '33333333-3333-4333-8333-333333333333';
const req = {
  organizationId: ORG,
  key: idempotencyKey('saveDraft', [STEP]),
  requestHash: requestHash('saveDraft', { title: 'Pricing FAQ' }),
};
const noWait = { sleep: async () => {}, waitMs: 0 };

beforeEach(() => {
  db.tables = { chat_idempotency_keys: [] };
  db.unique = { chat_idempotency_keys: [['organization_id', 'key']] };
  db.defaults = { chat_idempotency_keys: () => ({ created_at: new Date().toISOString() }) };
  db.failures = {};
});

describe('keys', () => {
  it('names a key by its scope and hashes the approval, in the shape 00402 checks', () => {
    expect(req.key).toMatch(/^saveDraft:[0-9a-f]{64}$/);
    expect(idempotencyKey('saveDraft', [STEP])).toBe(req.key);
    expect(idempotencyKey('saveDraft', ['another-step'])).not.toBe(req.key);
    expect(idempotencyKey('undo', [STEP])).not.toBe(req.key);
    expect(() => idempotencyKey('save_draft', [STEP])).toThrow();
    expect(() => idempotencyKey('saveDraft', [])).toThrow();
    expect(() => idempotencyKey('saveDraft', [''])).toThrow();
  });

  it('hashes a request the same whatever the order of its fields', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    );
    expect(requestHash('saveDraft', { a: 1, b: 2 })).toBe(requestHash('saveDraft', { b: 2, a: 1 }));
    expect(requestHash('saveDraft', { a: 1 })).not.toBe(requestHash('opportunityStatus', { a: 1 }));
    expect(requestHash('saveDraft', { a: 1 })).not.toBe(requestHash('saveDraft', { a: 2 }));
  });
});

describe('withIdempotencyKey', () => {
  it('runs once and keeps the result for 24 hours; a repeat gets it back', async () => {
    const work = vi.fn(async () => ({ result: { draft: 'd1' }, activityId: 'a1' }));
    const first = await withIdempotencyKey(req, work);
    expect(first).toEqual({ kind: 'ran', result: { draft: 'd1' }, activityId: 'a1' });
    const [row] = db.tables.chat_idempotency_keys;
    expect(row).toMatchObject({ organization_id: ORG, key: req.key, status: 'done' });
    const ttl = Date.parse(row.expires_at as string) - Date.now();
    expect(ttl).toBeGreaterThan(IDEMPOTENCY_TTL_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(IDEMPOTENCY_TTL_MS);

    const again = await withIdempotencyKey(req, work);
    expect(again).toEqual({ kind: 'repeat', result: { draft: 'd1' }, activityId: 'a1' });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('makes one change for two calls at once with the same key', async () => {
    let made = 0;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const work = async () => {
      made += 1;
      await gate;
      return { result: { draft: `d${made}` }, activityId: `a${made}` };
    };
    const both = Promise.all([
      withIdempotencyKey(req, work, { pollMs: 1 }),
      withIdempotencyKey(req, work, { pollMs: 1 }),
    ]);
    // Let both reach the key before the first finishes.
    await new Promise((resolve) => setTimeout(resolve, 20));
    finish();
    const [a, b] = await both;
    expect(made).toBe(1);
    expect([a.kind, b.kind].sort()).toEqual(['ran', 'repeat']);
    expect(a).toMatchObject({ result: { draft: 'd1' }, activityId: 'a1' });
    expect(b).toMatchObject({ result: { draft: 'd1' }, activityId: 'a1' });
    expect(db.tables.chat_idempotency_keys).toHaveLength(1);
  });

  it('keeps keys per workspace', async () => {
    const work = vi.fn(async () => ({ result: 1, activityId: null }));
    await withIdempotencyKey(req, work);
    await withIdempotencyKey(
      { ...req, organizationId: '99999999-9999-4999-8999-999999999999' },
      work,
    );
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('answers a mismatch for the same key with another request, and never the old result', async () => {
    await withIdempotencyKey(req, async () => ({ result: 1, activityId: null }));
    const work = vi.fn(async () => ({ result: 2, activityId: null }));
    const other = { ...req, requestHash: requestHash('saveDraft', { title: 'Other' }) };
    expect(await withIdempotencyKey(other, work)).toEqual({ kind: 'mismatch' });
    expect(work).not.toHaveBeenCalled();
  });

  it('gives the key back when the change fails, so a retry runs again', async () => {
    await expect(
      withIdempotencyKey(req, async () => {
        throw new Error('server down');
      }),
    ).rejects.toThrow('server down');
    expect(db.tables.chat_idempotency_keys).toHaveLength(0);
    const retry = await withIdempotencyKey(req, async () => ({ result: 'ok', activityId: null }));
    expect(retry.kind).toBe('ran');
  });

  it('gives the key back for a result it is told not to keep', async () => {
    const out = await withIdempotencyKey(
      req,
      async () => ({ result: 'conflict', activityId: null }),
      {
        keep: (r) => r !== 'conflict',
      },
    );
    expect(out.kind).toBe('ran');
    expect(db.tables.chat_idempotency_keys).toHaveLength(0);
  });

  it('runs the waiting call itself when the first one fails meanwhile', async () => {
    let fail!: () => void;
    const gate = new Promise<void>((_resolve, reject) => (fail = () => reject(new Error('boom'))));
    const first = withIdempotencyKey(req, async () => {
      await gate;
      return { result: 0, activityId: null };
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = withIdempotencyKey(req, async () => ({ result: 2, activityId: null }), {
      pollMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    fail();
    await expect(first).rejects.toThrow('boom');
    expect(await second).toEqual({ kind: 'ran', result: 2, activityId: null });
  });

  it('answers busy when the first call is still running after the wait', async () => {
    db.tables.chat_idempotency_keys.push({
      organization_id: ORG,
      key: req.key,
      request_hash: req.requestHash,
      status: 'pending',
      result_json: null,
      activity_id: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    });
    const work = vi.fn(async () => ({ result: 1, activityId: null }));
    expect(await withIdempotencyKey(req, work, noWait)).toEqual({ kind: 'busy' });
    expect(work).not.toHaveBeenCalled();
  });

  it('takes over a claim left by a server that stopped, and a key past its 24 hours', async () => {
    const stale = {
      organization_id: ORG,
      key: req.key,
      request_hash: req.requestHash,
      status: 'pending',
      result_json: null,
      activity_id: null,
      created_at: new Date(Date.now() - STALE_CLAIM_MS - 1000).toISOString(),
      expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    };
    db.tables.chat_idempotency_keys.push(stale);
    const work = vi.fn(async () => ({ result: 1, activityId: null }));
    expect((await withIdempotencyKey(req, work, noWait)).kind).toBe('ran');

    db.tables.chat_idempotency_keys = [
      {
        ...stale,
        status: 'done',
        result_json: 0,
        created_at: new Date(Date.now() - IDEMPOTENCY_TTL_MS - 1000).toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];
    expect(await withIdempotencyKey(req, work, noWait)).toMatchObject({ kind: 'ran', result: 1 });
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("doesn't make the change twice when its result can't be kept", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const work = vi.fn(async () => {
      db.failures.chat_idempotency_keys = { message: 'write failed' };
      return { result: 1, activityId: null };
    });
    expect((await withIdempotencyKey(req, work)).kind).toBe('ran');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('sweeps only the workspace’s expired keys', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 1000).toISOString();
    db.tables.chat_idempotency_keys = [
      { organization_id: ORG, key: 'a', expires_at: past },
      { organization_id: ORG, key: 'b', expires_at: future },
      { organization_id: 'other', key: 'c', expires_at: past },
    ];
    await sweepExpiredKeys(ORG);
    expect(db.tables.chat_idempotency_keys.map((row) => row.key)).toEqual(['b', 'c']);
  });
});
