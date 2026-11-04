// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { ORG, PEOPLE } from './testing/chatFixtures';
import { FILES_PAGE_ROWS, GB } from './files';

/**
 * The Files page's rows (CHAT-06 items 16–17, 24): the workspace's files
 * newest first, under a chip and the words typed, each with who made it,
 * the chat it came from when the person can open it, and the storage for
 * the meter.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { fileListQuery, listChatFiles } = await import('./fileList');

const ACTOR = { userId: PEOPLE.admin, email: null, organizationId: ORG };
const MINE = 'cccccccc-0000-4000-8000-000000000001';
const HIDDEN = 'cccccccc-0000-4000-8000-000000000002';
const DRAFT = 'dddddddd-0000-4000-8000-000000000001';

const row = (id: string, minute: number, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  title: `File ${id}`,
  type: 'document',
  formats: ['md', 'docx', 'pdf'],
  origin: 'chat',
  created_by: PEOPLE.admin,
  conversation_id: null,
  content_draft_id: null,
  size_bytes: 1000,
  generated_at: `2026-10-30T09:${String(minute).padStart(2, '0')}:00.000Z`,
  data_as_of: null,
  timezone: 'UTC',
  created_at: `2026-10-30T09:${String(minute).padStart(2, '0')}:00.000Z`,
  search_tsv: `file ${id}`,
  ...extra,
});

const list = (query: Record<string, string> = {}) =>
  listChatFiles(db as never, ACTOR, fileListQuery.parse(query));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  db.tables = {
    organizations: [
      { id: ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
    ],
    chat_storage_usage: [{ organization_id: ORG, bytes_used: 2 * GB, file_count: 4 }],
    storage_grants: [],
    // The person's client reads only the chats they can open: a teammate's private one isn't here.
    chat_conversations: [{ id: MINE, title: 'Pricing FAQ', deleted_at: null }],
    profiles: [
      { id: PEOPLE.manager, full_name: 'Sam Lee', organization_id: ORG },
      { id: PEOPLE.otherManager, full_name: 'Not here', organization_id: 'other-org' },
    ],
    chat_files: [
      row('a', 1, { conversation_id: MINE, content_draft_id: DRAFT, formats: ['html', 'md'] }),
      row('b', 2, { created_by: PEOPLE.manager, conversation_id: HIDDEN, type: 'report' }),
      row('c', 3, { origin: 'task', created_by: null }),
      row('d', 4, { origin: 'schedule', type: 'table', search_tsv: 'weekly citations' }),
      row('e', 5, { organization_id: 'other-org' }),
    ],
  };
});

afterEach(() => vi.unstubAllEnvs());

describe('listChatFiles', () => {
  it('lists the workspace’s files newest first, with who made each and where', async () => {
    const page = await list();
    expect(page.files.map((f) => f.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(page.files.map((f) => f.madeBy)).toEqual([
      { kind: 'schedule' },
      { kind: 'agent' },
      { kind: 'member', name: 'Sam Lee' },
      { kind: 'you' },
    ]);
    const a = page.files.find((f) => f.id === 'a')!;
    expect(a).toMatchObject({
      chat: { href: `/dashboard/chat/${MINE}`, title: 'Pricing FAQ' },
      draftHref: `/dashboard/content/editor/${DRAFT}`,
      formats: ['html', 'md'],
    });
    // A chat the person can't open stays unnamed.
    expect(page.files.find((f) => f.id === 'b')!.chat).toBeNull();
    expect(page.hasMore).toBe(false);
    expect(page.storage).toEqual({ usedBytes: 2 * GB, fileCount: 4, limitBytes: 25 * GB });
  });

  it('keeps a chip’s files: a type, the person’s own, or agents’', async () => {
    expect((await list({ filter: 'reports' })).files.map((f) => f.id)).toEqual(['b']);
    expect((await list({ filter: 'tables' })).files.map((f) => f.id)).toEqual(['d']);
    expect((await list({ filter: 'me' })).files.map((f) => f.id)).toEqual(['d', 'a']);
    expect((await list({ filter: 'agents' })).files.map((f) => f.id)).toEqual(['d', 'c']);
    expect((await list({ filter: 'unknown' })).files).toHaveLength(4);
  });

  it('finds files by the words typed, and pages 50 at a time', async () => {
    expect((await list({ q: 'weekly cit' })).files.map((f) => f.id)).toEqual(['d']);
    db.tables.chat_files = Array.from({ length: FILES_PAGE_ROWS + 2 }, (_, i) =>
      row(`n${i}`, i % 60, { created_at: new Date(Date.UTC(2026, 9, 30, 9, 0, i)).toISOString() }),
    );
    const first = await list();
    expect(first.files).toHaveLength(FILES_PAGE_ROWS);
    expect(first.hasMore).toBe(true);
    const next = await list({ offset: String(FILES_PAGE_ROWS) });
    expect(next.files.map((f) => f.id)).toEqual(['n1', 'n0']);
    expect(next.hasMore).toBe(false);
  });
});
