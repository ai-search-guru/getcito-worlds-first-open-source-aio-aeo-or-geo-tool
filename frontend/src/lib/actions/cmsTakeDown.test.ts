// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * Take down (AUTONOMOUS-GO-LIVE PR 10), as it runs against the member's own
 * client: an Admin or a Manager, a Manager even while publishing is off for
 * Managers; the page goes through the API's take-down route; its answers
 * come back as codes; a page of an action leaves what the action measures;
 * and it never throws.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(fake.db, {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: { access_token: 'token' } } }),
      },
    }),
}));
const unpublishDraftWork = vi.hoisted(() => vi.fn(async () => 1));
vi.mock('@/lib/content/actionDrafts', () => ({ unpublishDraftWork }));

const { createFakeSupabase } = await import('@/lib/chat/testing/fakeSupabase');
const { takeDownDraft } = await import('./cmsTakeDown');

const ORG = 'org-1';
const BRAND = '11111111-1111-4111-8111-111111111111';
const DRAFT = '33333333-3333-4333-8333-333333333333';

let requests: { url: string; init: RequestInit }[];
let answer: { status: number; body: unknown };

beforeEach(() => {
  fake.db = createFakeSupabase();
  Object.assign(fake.db.tables, {
    profiles: [{ id: 'u1', role: 'manager', organization_id: ORG }],
    // Publishing is off for Managers: Take down stays theirs.
    chat_settings: [{ organization_id: ORG, manager_execute_off: ['publishing'] }],
    content_drafts: [{ id: DRAFT, brand_id: BRAND, action_id: null }],
  });
  unpublishDraftWork.mockClear();
  requests = [];
  answer = {
    status: 200,
    body: { delivery: { id: 'd1', status: 'taken_down' }, target: 'wordpress' },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('takeDownDraft', () => {
  it('takes the page down through the API as the member, a Manager while publishing is off', async () => {
    expect(await takeDownDraft(DRAFT)).toEqual({ ok: true, target: 'wordpress' });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(new RegExp(`/api/content-drafts/${DRAFT}/take-down$`));
    expect(requests[0].init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
    });
    expect(unpublishDraftWork).not.toHaveBeenCalled();
  });

  it('takes a page of an action out of what the action measures, and keeps the take down if that fails', async () => {
    fake.db.tables.content_drafts[0].action_id = 'a1';
    expect(await takeDownDraft(DRAFT)).toMatchObject({ ok: true });
    expect(unpublishDraftWork).toHaveBeenCalledWith(
      expect.anything(),
      { id: DRAFT, brandId: BRAND, actionId: 'a1' },
      'u1',
    );
    unpublishDraftWork.mockRejectedValueOnce(new Error('changed'));
    expect(await takeDownDraft(DRAFT)).toMatchObject({ ok: true });
  });

  it('says the API’s refusals as codes, in its words', async () => {
    for (const [status, code, reason] of [
      [409, 'not_live', 'not_live'],
      [409, 'take_down_unavailable', 'unavailable'],
      [502, 'take_down_refused', 'refused'],
      [409, 'wix_refused', 'not_connected'],
      [400, 'no_webflow', 'not_connected'],
      [403, 'forbidden', 'forbidden_role'],
      [502, 'failed', 'failed'],
    ] as const) {
      answer = { status, body: { code, error: `Refused: ${code}` } };
      expect(await takeDownDraft(DRAFT)).toEqual({
        ok: false,
        reason,
        message: `Refused: ${code}`,
      });
    }
    // The CMS isn't marked a draft again here: only the API says it went.
    expect(unpublishDraftWork).not.toHaveBeenCalled();
  });

  it('refuses an Analyst, a draft it can’t read and an id that isn’t one, before any request', async () => {
    fake.db.tables.profiles = [{ id: 'u1', role: 'analyst', organization_id: ORG }];
    expect(await takeDownDraft(DRAFT)).toMatchObject({ ok: false, reason: 'forbidden_role' });
    fake.db.tables.profiles = [{ id: 'u1', role: 'admin', organization_id: ORG }];
    fake.db.tables.content_drafts = [];
    expect(await takeDownDraft(DRAFT)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await takeDownDraft('not-an-id')).toMatchObject({ ok: false, reason: 'not_found' });
    expect(requests).toEqual([]);
  });

  it('says a failure as a value when the API can’t be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    expect(await takeDownDraft(DRAFT)).toMatchObject({ ok: false, reason: 'failed' });
  });
});
