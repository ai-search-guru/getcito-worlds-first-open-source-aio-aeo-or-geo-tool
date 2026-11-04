// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { strToU8 } from 'fflate';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';
import { ORG, PEOPLE, seedWorkspace } from '@/lib/chat/testing/chatFixtures';

/**
 * An imported skill's update (CHAT-13 items 16 and 19, W4-31): GET shows
 * an Admin, or its creator, the version in use and the new one; POST is
 * an Admin's approval of the commit they read. Refusals as values (#1777).
 */

const state = vi.hoisted(() => ({ on: true, readOnly: false, userId: '' }));
const github = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/chat/engine', () => ({ driveRun: vi.fn(), stopChatRun: vi.fn() }));
vi.mock('@/lib/chat/skills/github', async (original) => ({
  ...(await original<typeof import('@/lib/chat/skills/github')>()),
  readGithubSkill: github.read,
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
const { parseSkillImport } = await import('@/lib/chat/skills/import');
const route = await import('./route');

const MIT = `MIT License

Copyright (c) 2026 Example

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files.`;
const skillFile = (body: string) => `---
name: copy-editing
description: Tightens copy, removes filler, keeps your voice.
license: MIT
metadata:
  title: Copy editing
---
${body}
`;
const KEPT = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const URL_AT = (sha: string) => `https://github.com/acme/skills/tree/${sha}/copy-editing`;
const files = (body: string) => [
  { path: 'SKILL.md', bytes: strToU8(skillFile(body)) },
  { path: 'LICENSE', bytes: strToU8(MIT) },
];
const ID = 'cccccccc-0000-4000-8000-000000000001';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id = ID) =>
  route.GET(new Request(`https://app.example.com/api/chat/skills/${id}/update`), params(id));
const approve = (body: unknown, id = ID) =>
  route.POST(
    new Request(`https://app.example.com/api/chat/skills/${id}/update`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params(id),
  );
const as = (userId: string) => {
  state.userId = userId;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  seedWorkspace(db);
  const kept = parseSkillImport(files('Read the page, then tighten it.'));
  if (!kept.ok) throw new Error('fixture');
  db.tables.chat_skills = [
    {
      id: ID,
      organization_id: ORG,
      ...kept.value.parts,
      compatibility: null,
      license_text: MIT,
      checksum_sha256: kept.value.checksum,
      source: 'import',
      source_url: URL_AT(KEPT),
      commit_sha: KEPT,
      update_sha: NEW,
      status: 'approved',
      visibility: 'private',
      enabled: true,
      created_by: PEOPLE.manager,
      scan_json: { blocks: [], warns: [] },
      removed_json: [],
    },
  ];
  github.read.mockResolvedValue({
    ok: true,
    value: {
      files: files('Read the page, then tighten it.\nThen cut it by a third.'),
      sourceUrl: URL_AT(NEW),
      commitSha: NEW,
    },
  });
  as(PEOPLE.admin);
});

afterEach(() => {
  state.on = true;
  state.readOnly = false;
  vi.unstubAllEnvs();
});

describe('GET /api/chat/skills/{id}/update', () => {
  it('shows an Admin the version in use and the new one, which they may approve', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      update: {
        id: ID,
        name: 'copy-editing',
        commitSha: KEPT,
        updateSha: NEW,
        next: { body: expect.stringContaining('Then cut it by a third.') },
        can: { approve: true },
      },
    });
  });

  it('shows its creator the update waiting on an Admin, and no one else', async () => {
    as(PEOPLE.manager);
    expect(await (await get()).json()).toMatchObject({
      ok: true,
      update: { can: { approve: false } },
    });
    as(PEOPLE.analyst);
    expect((await get()).status).toBe(404);
  });

  it('answers 409 without an update, and 404 for a bad id or with the new Chat off', async () => {
    db.tables.chat_skills[0].update_sha = null;
    expect((await get()).status).toBe(409);
    expect((await get('nope')).status).toBe(404);
    state.on = false;
    expect((await get()).status).toBe(404);
  });
});

describe('POST /api/chat/skills/{id}/update', () => {
  it('keeps the new version when an Admin approves the commit they read', async () => {
    const res = await approve({ updateSha: NEW });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skill: { id: ID, commitSha: NEW } });
    expect(db.tables.chat_skills[0]).toMatchObject({ commit_sha: NEW, update_sha: null });
  });

  it('refuses a read-only workspace first, then a bad body, a Manager and a stale commit', async () => {
    state.readOnly = true;
    expect((await approve({ updateSha: NEW })).status).toBe(402);
    expect(github.read).not.toHaveBeenCalled();
    state.readOnly = false;
    expect((await approve({ updateSha: 'nope' })).status).toBe(400);
    as(PEOPLE.manager);
    expect((await approve({ updateSha: NEW })).status).toBe(403);
    as(PEOPLE.admin);
    expect((await approve({ updateSha: 'c'.repeat(40) })).status).toBe(409);
    expect(db.tables.chat_skills[0]).toMatchObject({ commit_sha: KEPT, update_sha: NEW });
  });
});
