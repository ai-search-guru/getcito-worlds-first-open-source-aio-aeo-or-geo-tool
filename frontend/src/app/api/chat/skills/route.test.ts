// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';
import { ORG, PEOPLE, seedWorkspace } from '@/lib/chat/testing/chatFixtures';

/**
 * The skills API (CHAT-13, W3-06): not there while the new Chat is off;
 * every write checks the plan first (a read-only workspace is 402, before
 * anything else); who may turn a skill on or off, delete it and share it
 * (an Admin, or its creator; the library's skills an Admin), with
 * refusals as values (#1777).
 */

const state = vi.hoisted(() => ({ on: true, readOnly: false, userId: '' }));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/chat/engine', () => ({ driveRun: vi.fn(), stopChatRun: vi.fn() }));
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true, id: 'request-1' })),
}));
vi.mock('@/lib/chat/runApi', async (original) => {
  const actual = await original<typeof import('@/lib/chat/runApi')>();
  return {
    ...actual,
    chatActor: async () =>
      state.on
        ? { userId: state.userId, email: null, organizationId: ORG }
        : actual.runFailure(404, 'not_found', 'not_found', 'Not found'),
  };
});
vi.mock('@/lib/subscriptionGuard', () => ({
  writeRefusal: vi.fn(async () =>
    state.readOnly
      ? NextResponse.json({ error: 'plan_limit', code: 'subscription_inactive' }, { status: 402 })
      : null,
  ),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { requestAccess } = await import('@/lib/actions/chatAccessRequests');
const { skillChecksum } = await import('@/lib/chat/skills/store');
const list = await import('./route');
const one = await import('./[id]/route');
const share = await import('./[id]/share/route');
const library = await import('./library/[name]/route');

const SKILL = 'cccccccc-0000-4000-8000-000000000001';
const params = (id = SKILL) => ({ params: Promise.resolve({ id }) });
const named = (name: string) => ({ params: Promise.resolve({ name }) });
const patch = (body: unknown) =>
  new Request('https://app.example.com/api/chat/skills/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
const as = (userId: string) => {
  state.userId = userId;
};
const row = () => db.tables.chat_skills.find((s) => s.id === SKILL);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  seedWorkspace(db);
  const parts = {
    name: 'pricing-faq',
    title: 'Pricing FAQ',
    description: 'Writes a pricing FAQ.',
    body: 'Read the pricing page first.',
  };
  db.tables.chat_skills = [
    {
      id: SKILL,
      organization_id: ORG,
      ...parts,
      source: 'user',
      source_url: null,
      license: null,
      compatibility: null,
      status: 'approved',
      visibility: 'private',
      enabled: true,
      created_by: PEOPLE.manager,
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      scan_json: { blocks: [], warns: [] },
      checksum_sha256: skillChecksum(parts),
    },
  ];
  as(PEOPLE.manager);
});

afterEach(() => {
  state.on = true;
  state.readOnly = false;
  vi.unstubAllEnvs();
});

describe('/api/chat/skills', () => {
  it('is not there while the new Chat is off', async () => {
    state.on = false;
    expect((await list.GET()).status).toBe(404);
    expect((await one.PATCH(patch({ enabled: false }), params())).status).toBe(404);
    expect((await share.POST(new Request('https://x'), params())).status).toBe(404);
    expect((await library.PATCH(patch({ enabled: false }), named('faq'))).status).toBe(404);
  });

  it('lists the library and the skills the person sees, without their bodies', async () => {
    const res = await list.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skills).toEqual([
      expect.objectContaining({
        id: SKILL,
        name: 'pricing-faq',
        mine: true,
        can: { toggle: true, remove: true, share: 'request' },
      }),
    ]);
    expect(body.library.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('Read the pricing page first.');
    // Someone else's private skill isn't in an Analyst's list.
    as(PEOPLE.analyst);
    expect((await (await list.GET()).json()).skills).toEqual([]);
  });

  it('checks the plan before anything else on every write', async () => {
    state.readOnly = true;
    for (const res of [
      await one.PATCH(patch({ enabled: false }), params()),
      await one.DELETE(new Request('https://x'), params()),
      await share.POST(new Request('https://x'), params()),
      await library.PATCH(patch({ enabled: false }), named('faq')),
    ]) {
      expect(res.status).toBe(402);
    }
    expect(row()).toMatchObject({ enabled: true, visibility: 'private' });
  });

  it('refuses a bad body or id as a value', async () => {
    const bad = await one.PATCH(patch({ enabled: 'no' }), params());
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, failure: 'failed', code: 'invalid' });
    expect((await one.PATCH(patch({ enabled: false }), params('nope'))).status).toBe(404);
    expect((await library.PATCH(patch({}), named('faq'))).status).toBe(400);
  });

  it('lets the creator and an Admin turn it on or off, and refuses the rest in words', async () => {
    expect((await one.PATCH(patch({ enabled: false }), params())).status).toBe(200);
    expect(row()?.enabled).toBe(false);
    as(PEOPLE.admin);
    const on = await one.PATCH(patch({ enabled: true }), params());
    expect(await on.json()).toEqual({ ok: true, skill: { id: SKILL, enabled: true } });

    db.tables.chat_skills[0].visibility = 'workspace';
    for (const person of [PEOPLE.otherManager, PEOPLE.analyst]) {
      as(person);
      const res = await one.PATCH(patch({ enabled: false }), params());
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        ok: false,
        code: 'role_manage',
        error: 'Only an Admin or the person who made this skill can change it.',
      });
    }
    expect(row()?.enabled).toBe(true);
  });

  it("keeps someone's private skill from other people: 404", async () => {
    as(PEOPLE.otherManager);
    expect((await one.DELETE(new Request('https://x'), params())).status).toBe(404);
    expect(row()).toBeDefined();
  });

  it('lets the creator or an Admin delete it', async () => {
    as(PEOPLE.analyst);
    db.tables.chat_skills[0].visibility = 'workspace';
    expect((await one.DELETE(new Request('https://x'), params())).status).toBe(403);
    as(PEOPLE.manager);
    const res = await one.DELETE(new Request('https://x'), params());
    expect(await res.json()).toEqual({ ok: true });
    expect(row()).toBeUndefined();
  });

  it("shares for an Admin, and sends the creator's request to the Admins", async () => {
    const asked = await share.POST(new Request('https://x'), params());
    expect(await asked.json()).toEqual({ ok: true, requested: true });
    expect(requestAccess).toHaveBeenCalledTimes(1);
    expect(row()?.visibility).toBe('private');

    as(PEOPLE.admin);
    const shared = await share.POST(new Request('https://x'), params());
    expect(await shared.json()).toEqual({ ok: true, shared: true });
    expect(row()?.visibility).toBe('workspace');
    expect(requestAccess).toHaveBeenCalledTimes(1);
  });

  it("turns a library skill off for the workspace: an Admin's only", async () => {
    const refused = await library.PATCH(patch({ enabled: false }), named('faq'));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'role_library' });
    as(PEOPLE.admin);
    const off = await library.PATCH(patch({ enabled: false }), named('faq'));
    expect(await off.json()).toEqual({ ok: true, skill: { name: 'faq', enabled: false } });
    expect(db.tables.chat_settings[0].disabled_skills).toEqual(['faq']);
    expect((await library.PATCH(patch({ enabled: false }), named('nope'))).status).toBe(404);
  });
});
