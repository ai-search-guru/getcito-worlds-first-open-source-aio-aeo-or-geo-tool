// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { BRAND, ORG, OTHER_ORG, PEOPLE } from './testing/chatFixtures';

/**
 * Chat's chats (CHAT-01 §1–3, 7–8, 26; CHAT-20 §16c): the menu lists the
 * person's own chats and the team's shared ones, never a deleted one or
 * another person's private one, with each row's dot and step in words; a
 * chat opens for its author or, shared, for the team; Delete stops a running
 * agent first and Undo brings the chat back for a minute; opening it marks
 * its result read for the author only.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('./engine', () => ({ stopChatRun: vi.fn(async () => ({ ok: true })) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { stopChatRun } = await import('./engine');
const chats = await import('./conversations');

const ME = { userId: PEOPLE.manager, email: null, organizationId: ORG };
const ADMIN = { userId: PEOPLE.admin, email: null, organizationId: ORG };
const TEAMMATE = { userId: PEOPLE.otherManager, email: null, organizationId: ORG };
// One fake for both: the person's reads and the server's writes.
const reader = db as never;

const CHAT = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RUN = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;

function chat(n: number, row: Record<string, unknown> = {}) {
  return {
    id: CHAT(n),
    user_id: ME.userId,
    organization_id: ORG,
    brand_id: null,
    title: `Chat ${n}`,
    pinned_at: null,
    archived_at: null,
    shared_at: null,
    last_read_at: null,
    deleted_at: null,
    last_message_at: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00.000Z`,
    ...row,
  };
}

function run(n: number, chatN: number, row: Record<string, unknown> = {}) {
  return {
    id: RUN(n),
    conversation_id: CHAT(chatN),
    status: 'done',
    created_at: '2026-10-20T10:00:00.000Z',
    finished_at: '2026-10-20T10:01:00.000Z',
    ...row,
  };
}

beforeEach(() => {
  db.failures = {};
  db.log = [];
  db.tables = {
    profiles: [
      {
        id: PEOPLE.admin,
        role: 'admin',
        organization_id: ORG,
        brand_scope: 'all',
        full_name: 'Alex Kim',
      },
      {
        id: PEOPLE.manager,
        role: 'manager',
        organization_id: ORG,
        brand_scope: 'all',
        full_name: 'Jo Park',
      },
      {
        id: PEOPLE.otherManager,
        role: 'manager',
        organization_id: ORG,
        brand_scope: 'all',
        full_name: 'Sam Lee',
      },
    ],
    brands: [{ id: BRAND, organization_id: ORG, name: 'GetCito' }],
    chat_conversations: [],
    chat_runs: [],
    chat_run_steps: [],
    member_brands: [],
  };
  // can_access_brand (00388): a brand of the person's organization, with All brands or shared.
  db.rpcs = {
    can_access_brand: ({ p_brand_id, p_user_id }) => {
      const person = db.tables.profiles.find((p) => p.id === p_user_id);
      const brand = db.tables.brands.find((b) => b.id === p_brand_id);
      if (!person || !brand || brand.organization_id !== person.organization_id) return false;
      return (
        person.brand_scope === 'all' ||
        db.tables.member_brands.some((m) => m.user_id === p_user_id && m.brand_id === p_brand_id)
      );
    },
  };
  vi.mocked(stopChatRun).mockClear();
});

describe('listChats', () => {
  it("lists the person's chats and the team's shared ones, newest first, never a deleted or private one", async () => {
    db.tables.chat_conversations = [
      chat(1, { brand_id: BRAND }),
      chat(2, { user_id: TEAMMATE.userId, shared_at: '2026-10-12T00:00:00.000Z' }),
      chat(3, { user_id: TEAMMATE.userId }),
      chat(4, { deleted_at: '2026-10-29T00:00:00.000Z' }),
      chat(5, { archived_at: '2026-10-20T00:00:00.000Z' }),
      chat(6, { organization_id: OTHER_ORG }),
    ];
    const list = await chats.listChats(reader, ME, chats.listQuery.parse({}));
    expect(list.chats.map((c) => c.id)).toEqual([CHAT(2), CHAT(1)]);
    expect(list.total).toBe(2);
    expect(list.archived).toBe(1);
    expect(list.chats[1]).toMatchObject({ brand: 'GetCito', mine: true, ownerInitials: null });
    expect(list.chats[0]).toMatchObject({ mine: false, shared: true, ownerInitials: 'SL' });
  });

  it('never names an author from another workspace', async () => {
    db.tables.profiles.push({ id: 'outsider', organization_id: OTHER_ORG, full_name: 'Zed Q' });
    db.tables.chat_conversations = [
      chat(1, { user_id: 'outsider', shared_at: '2026-10-12T00:00:00.000Z' }),
    ];
    const [row] = (await chats.listChats(reader, ME, chats.listQuery.parse({}))).chats;
    expect(row.ownerInitials).toBeNull();
  });

  it("shows a teammate's initials though the person can read only their own profile", async () => {
    const { createFakeSupabase } = await import('./testing/fakeSupabase');
    const asPerson = createFakeSupabase();
    db.tables.chat_conversations = [
      chat(1, { user_id: TEAMMATE.userId, shared_at: '2026-10-12T00:00:00.000Z' }),
    ];
    // The person's reads, as the policies let them: profiles is own row only.
    asPerson.tables = {
      ...db.tables,
      profiles: db.tables.profiles.filter((p) => p.id === ME.userId),
    };
    const list = await chats.listChats(asPerson as never, ME, chats.listQuery.parse({}));
    expect(list.chats[0]).toMatchObject({ mine: false, ownerInitials: 'SL' });
  });

  it('lists only their own archived chats under Archived', async () => {
    db.tables.chat_conversations = [
      chat(1, { archived_at: '2026-10-20T00:00:00.000Z' }),
      chat(2),
      chat(3, {
        user_id: TEAMMATE.userId,
        shared_at: '2026-10-12T00:00:00.000Z',
        archived_at: '2026-10-20T00:00:00.000Z',
      }),
    ];
    const list = await chats.listChats(reader, ME, chats.listQuery.parse({ view: 'archived' }));
    expect(list.chats.map((c) => c.id)).toEqual([CHAT(1)]);
    expect(list.chats[0].archived).toBe(true);
  });

  it("gives each row its dot from the newest run, and the step it's on while it works", async () => {
    db.tables.chat_conversations = [
      chat(1),
      chat(2),
      chat(3, { last_read_at: '2026-10-21T00:00:00.000Z' }),
      chat(4),
    ];
    db.tables.chat_runs = [
      run(1, 1, { status: 'running', finished_at: null, created_at: '2026-10-21T10:00:00.000Z' }),
      run(2, 1, { status: 'done', created_at: '2026-10-19T10:00:00.000Z' }),
      run(3, 2, { status: 'waiting', finished_at: null }),
      run(4, 3, { status: 'done' }),
      run(5, 4, { status: 'error' }),
    ];
    db.tables.chat_run_steps = [
      {
        id: 's1',
        run_id: RUN(1),
        position: 1,
        kind: 'read',
        status: 'done',
        label: 'Read Citations',
      },
      {
        id: 's2',
        run_id: RUN(1),
        position: 2,
        kind: 'read',
        status: 'running',
        label: 'Comparing cited pages',
      },
      {
        id: 's3',
        run_id: RUN(3),
        position: 1,
        kind: 'write',
        status: 'waiting',
        label: 'Add 3 prompts',
      },
    ];
    const list = await chats.listChats(reader, ME, chats.listQuery.parse({}));
    const byId = new Map(list.chats.map((c) => [c.id, c]));
    expect(byId.get(CHAT(1))).toMatchObject({
      state: 'running',
      step: 'Comparing cited pages',
      progress: { done: 1, total: 2 },
      unread: false,
    });
    expect(byId.get(CHAT(2))).toMatchObject({ state: 'needsYou', step: 'Add 3 prompts' });
    // Read since it finished: idle, not bold.
    expect(byId.get(CHAT(3))).toMatchObject({ state: 'idle', unread: false, step: null });
    expect(byId.get(CHAT(4))).toMatchObject({
      state: 'failed',
      unread: true,
      finishedAt: '2026-10-20T10:01:00.000Z',
    });
    expect(byId.get(CHAT(1))?.finishedAt).toBeNull();
  });

  it("shows a teammate's shared chat unpinned and read, as pin and read are its author's", async () => {
    db.tables.chat_conversations = [
      chat(1, {
        user_id: TEAMMATE.userId,
        shared_at: '2026-10-12T00:00:00.000Z',
        pinned_at: '2026-10-12T00:00:00.000Z',
      }),
    ];
    db.tables.chat_runs = [run(1, 1)];
    const [row] = (await chats.listChats(reader, ME, chats.listQuery.parse({}))).chats;
    expect(row).toMatchObject({ pinned: false, unread: false, state: 'idle' });
  });

  it('masks an id in a title', async () => {
    db.tables.chat_conversations = [chat(1, { title: `About ${BRAND}` })];
    const [row] = (await chats.listChats(reader, ME, chats.listQuery.parse({}))).chats;
    expect(row.title).toBe('About …');
  });

  it('refuses a limit past the most a list answers with', () => {
    expect(chats.listQuery.safeParse({ limit: '500' }).success).toBe(false);
    expect(chats.listQuery.parse({ limit: '20' }).limit).toBe(20);
  });
});

describe('readChat', () => {
  it("opens the person's own chat and a shared one, never a private or deleted one", async () => {
    db.tables.chat_conversations = [
      chat(1),
      chat(2, { user_id: TEAMMATE.userId, shared_at: '2026-10-12T00:00:00.000Z' }),
      chat(3, { user_id: TEAMMATE.userId }),
      chat(4, { deleted_at: '2026-10-29T00:00:00.000Z' }),
    ];
    expect(await chats.readChat(reader, ME, CHAT(1))).toMatchObject({ id: CHAT(1) });
    expect(await chats.readChat(reader, ME, CHAT(2))).toMatchObject({ mine: false });
    expect(await chats.readChat(reader, ME, CHAT(3))).toBeNull();
    expect(await chats.readChat(reader, ME, CHAT(4))).toBeNull();
  });
});

describe('createChat', () => {
  it("starts an untitled chat on the workspace's brand", async () => {
    const made = await chats.createChat(
      reader,
      ME,
      chats.createInput.parse({
        brandId: BRAND,
        origin: 'panel',
        originPage: '/dashboard/visibility',
      }),
    );
    expect(made).toMatchObject({ title: null, brand: 'GetCito', mine: true, state: 'idle' });
    expect(db.tables.chat_conversations[0]).toMatchObject({
      user_id: ME.userId,
      organization_id: ORG,
      origin: 'panel',
      origin_page: '/dashboard/visibility',
    });
  });

  it('refuses a brand the person may not use (BRAND-ACCESS), and keeps the brands it touches', async () => {
    const SECOND = CHAT(8);
    db.tables.brands.push({ id: SECOND, organization_id: ORG, name: 'Second' });
    db.tables.member_brands = [{ user_id: ME.userId, brand_id: SECOND }];
    db.tables.profiles.find((p) => p.id === ME.userId)!.brand_scope = 'selected';
    const started: unknown[] = [];
    db.rpcs.chat_start_touched_brands = ({ p_conversation_id }) => started.push(p_conversation_id);
    expect(
      await chats.createChat(reader, ME, chats.createInput.parse({ brandId: BRAND })),
    ).toBeNull();
    expect(db.tables.chat_conversations).toEqual([]);
    const made = await chats.createChat(reader, ME, chats.createInput.parse({ brandId: SECOND }));
    expect(made).toMatchObject({ brand: 'Second' });
    expect(started).toEqual([db.tables.chat_conversations[0].id]);
  });

  it("refuses another workspace's brand, and a full address as its page", async () => {
    db.tables.brands.push({ id: CHAT(9), organization_id: OTHER_ORG, name: 'Other' });
    expect(
      await chats.createChat(reader, ME, chats.createInput.parse({ brandId: CHAT(9) })),
    ).toBeNull();
    expect(chats.createInput.safeParse({ originPage: 'https://evil.example/x' }).success).toBe(
      false,
    );
  });

  it('takes the demo brand’s id, made by hand, and refuses what isn’t an id', () => {
    const demo = '33333333-3333-3333-3333-333333333333';
    expect(chats.createInput.parse({ brandId: demo }).brandId).toBe(demo);
    expect(chats.createInput.safeParse({ brandId: '3333-3333' }).success).toBe(false);
  });
});

describe('deleteChat and restoreChat', () => {
  it('stops a running agent first, then hides the chat; Undo brings it back', async () => {
    db.tables.chat_conversations = [chat(1)];
    db.tables.chat_runs = [run(1, 1, { status: 'running', finished_at: null })];
    expect(await chats.deleteChat(ME, CHAT(1))).toEqual({ ok: true });
    expect(stopChatRun).toHaveBeenCalledWith(
      { userId: ME.userId, email: null, organizationId: ORG },
      RUN(1),
    );
    expect(db.tables.chat_conversations[0].deleted_at).toEqual(expect.any(String));
    expect(await chats.readChat(reader, ME, CHAT(1))).toBeNull();

    expect(await chats.restoreChat(ME, CHAT(1))).toEqual({ ok: true });
    expect(db.tables.chat_conversations[0].deleted_at).toBeNull();
  });

  it('refuses Undo once its minute is over', async () => {
    db.tables.chat_conversations = [chat(1, { deleted_at: '2026-10-30T10:00:00.000Z' })];
    const later = Date.parse('2026-10-30T10:00:00.000Z') + chats.DELETED_CHAT_UNDO_MS + 1;
    expect(await chats.restoreChat(ME, CHAT(1), later)).toEqual({ ok: false, reason: 'expired' });
  });

  it("lets an Admin delete a teammate's shared chat, never a private one; a teammate can't", async () => {
    db.tables.chat_conversations = [
      chat(1, { user_id: TEAMMATE.userId, shared_at: '2026-10-12T00:00:00.000Z' }),
      chat(2, { user_id: TEAMMATE.userId }),
      chat(3),
    ];
    expect(await chats.deleteChat(ADMIN, CHAT(2))).toEqual({ ok: false, reason: 'not_found' });
    expect(await chats.deleteChat(TEAMMATE, CHAT(3))).toEqual({ ok: false, reason: 'not_found' });
    expect(await chats.deleteChat(ADMIN, CHAT(1))).toEqual({ ok: true });
  });

  it("doesn't delete another workspace's chat", async () => {
    db.tables.chat_conversations = [chat(1, { organization_id: OTHER_ORG })];
    expect(await chats.deleteChat(ME, CHAT(1))).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('markChatRead', () => {
  it("marks the author's chat read, leaves a teammate's shared one as it was, refuses a private one", async () => {
    db.tables.chat_conversations = [
      chat(1),
      chat(2, { user_id: TEAMMATE.userId, shared_at: '2026-10-12T00:00:00.000Z' }),
      chat(3, { user_id: TEAMMATE.userId }),
    ];
    const now = new Date('2026-10-30T12:00:00.000Z');
    expect(await chats.markChatRead(ME, CHAT(1), now)).toEqual({ ok: true });
    expect(await chats.markChatRead(ME, CHAT(2), now)).toEqual({ ok: true });
    expect(await chats.markChatRead(ME, CHAT(3), now)).toEqual({ ok: false, reason: 'not_found' });
    expect(db.tables.chat_conversations.map((c) => c.last_read_at)).toEqual([
      now.toISOString(),
      null,
      null,
    ]);
  });
});

describe('sweepDeletedChats', () => {
  it('removes for good only the chats whose Undo is over', async () => {
    const now = Date.parse('2026-10-30T12:00:00.000Z');
    db.tables.chat_conversations = [
      chat(1, { deleted_at: new Date(now - chats.DELETED_CHAT_UNDO_MS - 1).toISOString() }),
      chat(2, { deleted_at: new Date(now - 1_000).toISOString() }),
      chat(3),
    ];
    expect(await chats.sweepDeletedChats(now)).toBe(1);
    expect(db.tables.chat_conversations.map((c) => c.id)).toEqual([CHAT(2), CHAT(3)]);
  });
});

describe('initialsOf', () => {
  it('takes the first and last names', () => {
    expect(chats.initialsOf('Sam Lee')).toBe('SL');
    expect(chats.initialsOf('Ana María López')).toBe('AL');
    expect(chats.initialsOf('Cher')).toBe('C');
    expect(chats.initialsOf('  ')).toBeNull();
  });
});

describe('updateChat', () => {
  it("pins, renames, shares and archives the author's chat, and undoes each", async () => {
    db.tables.chat_conversations = [chat(1)];
    const now = new Date('2026-10-30T12:00:00.000Z');
    const patch = (p: Record<string, unknown>) =>
      chats.updateChat(reader, ME, CHAT(1), chats.updateInput.parse(p), now);
    expect(await patch({ pinned: true, title: '  Board update ' })).toMatchObject({
      pinned: true,
      title: 'Board update',
    });
    expect(await patch({ shared: true, archived: true })).toMatchObject({
      shared: true,
      archived: true,
    });
    expect(db.tables.chat_conversations[0]).toMatchObject({
      pinned_at: now.toISOString(),
      shared_at: now.toISOString(),
      archived_at: now.toISOString(),
    });
    expect(await patch({ pinned: false, shared: false, archived: false })).toMatchObject({
      pinned: false,
      shared: false,
      archived: false,
    });
  });

  it("refuses a teammate's chat, even a shared one, and a deleted one", async () => {
    db.tables.chat_conversations = [
      chat(1, { user_id: TEAMMATE.userId, shared_at: '2026-10-12T00:00:00.000Z' }),
      chat(2, { deleted_at: '2026-10-29T00:00:00.000Z' }),
    ];
    const pin = chats.updateInput.parse({ pinned: true });
    expect(await chats.updateChat(reader, ME, CHAT(1), pin)).toBeNull();
    expect(await chats.updateChat(reader, ME, CHAT(2), pin)).toBeNull();
    expect(db.tables.chat_conversations.every((c) => c.pinned_at === null)).toBe(true);
  });

  it('refuses an empty change, an empty title and an unknown field', () => {
    expect(chats.updateInput.safeParse({}).success).toBe(false);
    expect(chats.updateInput.safeParse({ title: '   ' }).success).toBe(false);
    expect(chats.updateInput.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
    expect(chats.updateInput.safeParse({ user_id: 'x' }).success).toBe(false);
  });
});

describe('searchChats', () => {
  const search = (q: string, view?: 'active' | 'archived') =>
    chats.searchChats(reader, ME, chats.searchQuery.parse({ q, view }));

  beforeEach(() => {
    db.tables.chat_conversations = [
      chat(1, { search_tsv: 'Why did citations drop' }),
      chat(2, { search_tsv: 'Weekly report', title: 'Weekly report' }),
      chat(3, {
        user_id: TEAMMATE.userId,
        shared_at: '2026-10-12T00:00:00.000Z',
        search_tsv: 'Citations on Perplexity',
      }),
      // A teammate's private chat, a deleted one, an archived one, another workspace.
      chat(4, { user_id: TEAMMATE.userId, search_tsv: 'Citations private' }),
      chat(5, { deleted_at: '2026-10-29T00:00:00.000Z', search_tsv: 'Citations deleted' }),
      chat(6, { archived_at: '2026-10-20T00:00:00.000Z', search_tsv: 'Old citations plan' }),
      chat(7, { organization_id: OTHER_ORG, search_tsv: 'Citations elsewhere' }),
    ];
    db.tables.chat_messages = [
      {
        id: 'm1',
        conversation_id: CHAT(2),
        created_at: '2026-10-20T10:00:00.000Z',
        search_tsv: 'Which pages lost citations?',
      },
      {
        id: 'm2',
        conversation_id: CHAT(4),
        created_at: '2026-10-20T10:00:00.000Z',
        search_tsv: 'citations',
      },
      {
        id: 'm3',
        conversation_id: CHAT(1),
        created_at: '2026-10-20T10:00:00.000Z',
        search_tsv: 'citations again',
      },
    ];
  });

  it('finds chats by title or message words, newest first, never a private, deleted or archived one', async () => {
    const found = await search('citat');
    expect(found.map((c) => c.id)).toEqual([CHAT(3), CHAT(2), CHAT(1)]);
    expect(found[0]).toMatchObject({ mine: false, ownerInitials: 'SL' });
  });

  it('needs every word, and finds their own archived chats under Archived', async () => {
    expect((await search('citations perplexity')).map((c) => c.id)).toEqual([CHAT(3)]);
    expect((await search('citations', 'archived')).map((c) => c.id)).toEqual([CHAT(6)]);
  });

  it("answers nothing for words it can't search, without asking the database", async () => {
    db.log = [];
    expect(await search(' :* & ! ')).toEqual([]);
    expect(db.log).toEqual([]);
  });

  it('finds a domain, a number or an email address as it was written', async () => {
    db.tables.chat_messages.push({
      id: 'm4',
      conversation_id: CHAT(2),
      created_at: '2026-10-21T10:00:00.000Z',
      search_tsv: 'Share fell to 4.5 on nike.com, ask ops@nike.com',
    });
    expect((await search('nike.com')).map((c) => c.id)).toEqual([CHAT(2)]);
    expect((await search('4.5 nike')).map((c) => c.id)).toEqual([CHAT(2)]);
    expect((await search('ops@nike.com')).map((c) => c.id)).toEqual([CHAT(2)]);
  });
});

describe('searchTermsOf', () => {
  it('quotes each word as a prefix for Postgres to split, all of them required', () => {
    expect(chats.searchTermsOf('Why did Citations drop?')).toBe(
      "'Why':* & 'did':* & 'Citations':* & 'drop?':*",
    );
    // One token in the text ("nike.com", "4.5") stays one word to look for.
    expect(chats.searchTermsOf('nike.com 4.5 İstanbul')).toBe(
      "'nike.com':* & '4.5':* & 'İstanbul':*",
    );
    expect(chats.searchTermsOf("Gökhan's Q4")).toBe("'Gökhan''s':* & 'Q4':*");
    // The person's operators stay inside the quotes, never Postgres's.
    expect(chats.searchTermsOf("') | !foo:* <-> bar\\'")).toBe("'!foo:*':* & 'bar ''':*");
    expect(chats.searchTermsOf('   ')).toBeNull();
    expect(chats.searchTermsOf('a b c d e f g h i j')?.split(' & ')).toHaveLength(8);
  });
});
