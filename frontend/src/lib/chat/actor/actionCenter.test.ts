// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * Send to Action Center for a run with no session (create_action runFor
 * and precheckFor): the session's requests, sent as the run's person, with
 * the run's place only when the chat is theirs; an Analyst, the demo brand
 * and a read-only plan refused before anything is sent; and the server's
 * refusal of the way said in the person's words.
 */

const SECRET = 'c'.repeat(64);
const ORG = 'org-1';
const PERSON = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEAMMATE = 'aaaaaaaa-0000-4000-8000-000000000002';
const BRAND = '11111111-1111-4111-8111-111111111111';
const DEMO = '33333333-3333-4333-8333-333333333333';
const CHAT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ACTION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const actor = { userId: PERSON, organizationId: ORG };

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { checkChatActionCoverFor, createChatActionFor } = await import('./actionCenter');

const place = {
  conversationId: CHAT,
  runId: RUN,
  approvalKey: 'step-1',
  executionMode: 'automated' as const,
};
const entities = { prompts: [], pages: ['/pricing'], competitors: [], platforms: [] };
const proposal = {
  title: 'Win back pricing citations on /pricing',
  category: 'recover' as const,
  why: 'Google AI Overviews stopped citing /pricing.',
  entities,
  tasks: [
    {
      title: 'Add a pricing FAQ block to /pricing',
      type: 'on_page' as const,
      url: '/pricing',
      done_when: 'The FAQ block is live',
    },
  ],
};

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string),
  };
};

function seed(role = 'manager', chatOwner = PERSON) {
  db.tables = {
    profiles: [{ id: PERSON, organization_id: ORG, role }],
    organizations: [{ id: ORG, subscription_status: 'active' }],
    brands: [
      { id: BRAND, organization_id: ORG, is_demo: false },
      { id: DEMO, organization_id: ORG, is_demo: true },
    ],
    chat_conversations: [{ id: CHAT, user_id: chatOwner, organization_id: ORG, brand_id: BRAND }],
    // The step the change runs on now, without a card; the embed reads its run.
    chat_run_steps: [
      {
        id: 'step-1',
        run_id: RUN,
        status: 'running',
        tool: 'create_action',
        debug_json: { auto: true },
        chat_runs: { conversation_id: CHAT },
      },
    ],
  };
  db.failures = {};
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CHAT_ACTING_SECRET', SECRET);
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seed();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createChatActionFor', () => {
  it('sends the action as the run’s person, at the run’s place, once per approval', async () => {
    answer(201, { actionId: ACTION, actionNo: 1271, created: true });
    expect(await createChatActionFor(actor, BRAND, proposal, place)).toEqual({
      ok: true,
      action_id: ACTION,
      action_no: 1271,
      created: true,
      href: `/dashboard/action-center/actions/${ACTION}`,
    });
    const sent = lastCall();
    expect(sent.url).toBe('http://api.test/api/action-center/chat-actions');
    expect(sent.headers).toMatchObject({
      Authorization: `Bearer ${SECRET}`,
      'X-Acting-User': PERSON,
    });
    expect(sent.body).toEqual({
      brandId: BRAND,
      proposal,
      conversationId: CHAT,
      runId: RUN,
      executionMode: 'automated',
      idempotencyKey: 'chat:step-1',
      createAnyway: false,
    });
  });

  it('records no place in a chat that isn’t the run’s person’s', async () => {
    seed('manager', TEAMMATE);
    answer(201, { actionId: ACTION, actionNo: 1271, created: true });
    await createChatActionFor(actor, BRAND, proposal, place);
    expect(lastCall().body).toMatchObject({
      conversationId: null,
      runId: null,
      executionMode: null,
      idempotencyKey: expect.stringMatching(/^chat:(?!step-1)/),
    });
  });

  it('gives the covering action back, and the server’s refusals in Chat’s codes', async () => {
    answer(409, { code: 'duplicate', action: { id: ACTION, no: 1258 }, canCreateAnyway: true });
    expect(await createChatActionFor(actor, BRAND, proposal, place)).toMatchObject({
      ok: false,
      reason: 'duplicate',
      action_no: 1258,
      can_create_anyway: true,
    });
    answer(403, { code: 'no_brand_access' });
    expect(await createChatActionFor(actor, BRAND, proposal, place)).toMatchObject({
      reason: 'not_found',
    });
    answer(403, { code: 'chat_off' });
    expect(await createChatActionFor(actor, BRAND, proposal, place)).toMatchObject({
      ok: false,
      reason: 'chat_off',
    });
  });

  it('refuses an Analyst, the demo brand and a read-only plan before sending anything', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed('analyst');
    expect(await createChatActionFor(actor, BRAND, proposal, place)).toMatchObject({
      reason: 'forbidden_role',
    });
    seed();
    expect(await createChatActionFor(actor, DEMO, proposal, place)).toMatchObject({
      reason: 'failed',
    });
    db.tables.organizations = [{ id: ORG, subscription_status: 'canceled' }];
    expect(await createChatActionFor(actor, BRAND, proposal, place)).toMatchObject({
      reason: 'failed',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.mocked(console.error).mockRestore();
  });
});

describe('checkChatActionCoverFor', () => {
  it('names the action that covers the finding, checked as the run’s person', async () => {
    answer(200, { covering: [{ actionId: ACTION, actionNo: 1258, covers: 'all' }] });
    expect(await checkChatActionCoverFor(actor, BRAND, entities, 'recover')).toMatchObject({
      ok: false,
      reason: 'duplicate',
      action_no: 1258,
      can_create_anyway: false,
    });
    expect(lastCall()).toMatchObject({
      url: 'http://api.test/api/action-center/chat-actions/check',
      headers: { 'X-Acting-User': PERSON },
      body: { brandId: BRAND, entities, category: 'recover' },
    });
    answer(200, { covering: [] });
    expect(await checkChatActionCoverFor(actor, BRAND, entities)).toEqual({ ok: true });
  });

  it('lets the send check again when it couldn’t check, logging only a real failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer(403, { code: 'chat_off' });
    expect(await checkChatActionCoverFor(actor, BRAND, entities)).toEqual({ ok: true });
    expect(error).not.toHaveBeenCalled();
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await checkChatActionCoverFor(actor, BRAND, entities)).toEqual({ ok: true });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
