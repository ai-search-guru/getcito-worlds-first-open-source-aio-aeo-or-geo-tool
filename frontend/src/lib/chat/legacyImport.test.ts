// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { BRAND, ORG, OTHER_ORG, PEOPLE } from './testing/chatFixtures';

/**
 * Agent Chat's conversations copied into Chat on the first visit (W1-02;
 * CHAT-01 item 2): with their ids, the person's own in their workspace only,
 * questions and answers in words (no tool rows), once — a second copy, or
 * two at once, changes nothing — and noted on the person only when the copy
 * is complete. A failure is answered as a value, never thrown.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { importLegacyChats, legacyMessage, legacyTitle } = await import('./legacyImport');

const ME = { userId: PEOPLE.manager, email: null, organizationId: ORG };
const NOW = new Date('2026-10-30T09:00:00.000Z');

const CHAT = (n: number) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MSG = (n: number) => `ffffffff-0000-4000-8000-${String(n).padStart(12, '0')}`;

function legacyChat(n: number, row: Record<string, unknown> = {}) {
  return {
    id: CHAT(n),
    user_id: ME.userId,
    organization_id: ORG,
    brand_id: null,
    title: `Old chat ${n}`,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: `2026-09-${String(n).padStart(2, '0')}T12:00:00.000Z`,
    ...row,
  };
}

function legacyMsg(n: number, chatN: number, role: string, content: string, minute = n) {
  return {
    id: MSG(n),
    conversation_id: CHAT(chatN),
    role,
    content,
    tool_calls: null,
    tool_result: null,
    created_at: `2026-09-0${chatN}T12:${String(minute).padStart(2, '0')}:00.000Z`,
  };
}

/** Rows in id order: the copy writes the newest conversation first. */
const byId = (rows: Record<string, unknown>[]) =>
  [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.failures = {};
  db.log = [];
  db.unique = { chat_user_prefs: [['user_id']] };
  db.tables = {
    agent_conversations: [
      legacyChat(1, { brand_id: BRAND, title: 'Why did citations drop?' }),
      legacyChat(2, { title: 'New conversation' }),
      // Nothing to read in it: stays behind.
      legacyChat(3),
      // Someone else's, and the person's in another workspace.
      legacyChat(4, { user_id: PEOPLE.otherManager }),
      legacyChat(5, { organization_id: OTHER_ORG }),
    ],
    agent_messages: [
      legacyMsg(1, 1, 'user', 'Why did citations drop?'),
      legacyMsg(2, 1, 'assistant', ''),
      legacyMsg(3, 1, 'tool', '{"rows": 4}'),
      legacyMsg(4, 1, 'assistant', 'Two pages lost their citations.'),
      legacyMsg(5, 2, 'user', 'Hello'),
      legacyMsg(6, 3, 'tool', '{}'),
      legacyMsg(7, 4, 'user', 'Not mine'),
      legacyMsg(8, 5, 'user', 'Other workspace'),
    ],
    chat_conversations: [],
    chat_messages: [],
    chat_user_prefs: [{ user_id: ME.userId, menu_open: false, legacy_imported_at: null }],
  };
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorLog.mockRestore());

describe('importLegacyChats', () => {
  it("copies the person's conversations in their workspace with their ids, questions and answers only", async () => {
    expect(await importLegacyChats(ME, NOW)).toEqual({ ok: true, chats: 2, messages: 3 });

    expect(byId(db.tables.chat_conversations)).toEqual([
      {
        id: CHAT(1),
        organization_id: ORG,
        user_id: ME.userId,
        brand_id: BRAND,
        title: 'Why did citations drop?',
        origin: 'page',
        origin_page: '/dashboard/chat',
        last_message_at: '2026-09-01T12:04:00.000Z',
        created_at: '2026-09-01T10:00:00.000Z',
        updated_at: '2026-09-01T12:00:00.000Z',
      },
      expect.objectContaining({ id: CHAT(2), title: null, brand_id: null }),
    ]);
    expect(byId(db.tables.chat_messages)).toEqual([
      {
        id: MSG(1),
        conversation_id: CHAT(1),
        role: 'user',
        content_md: 'Why did citations drop?',
        generated_at: null,
        created_at: '2026-09-01T12:01:00.000Z',
      },
      {
        id: MSG(4),
        conversation_id: CHAT(1),
        role: 'assistant',
        content_md: 'Two pages lost their citations.',
        generated_at: '2026-09-01T12:04:00.000Z',
        created_at: '2026-09-01T12:04:00.000Z',
      },
      expect.objectContaining({ id: MSG(5), conversation_id: CHAT(2), role: 'user' }),
    ]);
    // Noted on the person, their other settings kept.
    expect(db.tables.chat_user_prefs).toEqual([
      { user_id: ME.userId, menu_open: false, legacy_imported_at: NOW.toISOString() },
    ]);
    // The old tables are only read.
    expect(db.log.filter(([t, kind]) => t.startsWith('agent_') && kind !== 'select')).toEqual([]);
  });

  it('changes nothing the second time, or for a chat already there', async () => {
    db.tables.chat_conversations = [
      { id: CHAT(1), user_id: ME.userId, organization_id: ORG, title: 'Renamed in Chat' },
    ];
    await importLegacyChats(ME, NOW);
    const after = structuredClone(db.tables);
    expect(await importLegacyChats(ME, NOW)).toEqual({ ok: true, chats: 2, messages: 3 });
    expect(db.tables.chat_conversations).toEqual(after.chat_conversations);
    expect(db.tables.chat_messages).toEqual(after.chat_messages);
    expect(db.tables.chat_conversations[0]).toMatchObject({ title: 'Renamed in Chat' });
  });

  it('copies each chat once when two first visits run together', async () => {
    await Promise.all([importLegacyChats(ME, NOW), importLegacyChats(ME, NOW)]);
    expect(byId(db.tables.chat_conversations).map((c) => c.id)).toEqual([CHAT(1), CHAT(2)]);
    expect(byId(db.tables.chat_messages).map((m) => m.id)).toEqual([MSG(1), MSG(4), MSG(5)]);
  });

  it('notes a person with nothing to copy, creating their settings row', async () => {
    db.tables.agent_conversations = [];
    db.tables.chat_user_prefs = [];
    expect(await importLegacyChats(ME, NOW)).toEqual({ ok: true, chats: 0, messages: 0 });
    expect(db.tables.chat_user_prefs).toEqual([
      expect.objectContaining({ user_id: ME.userId, legacy_imported_at: NOW.toISOString() }),
    ]);
  });

  it('answers a failure as a value and leaves the person to be copied again', async () => {
    db.failures = { chat_messages: { message: 'down' } };
    expect(await importLegacyChats(ME, NOW)).toEqual({ ok: false });
    expect(db.tables.chat_user_prefs[0]).toMatchObject({ legacy_imported_at: null });
    expect(errorLog).toHaveBeenCalled();

    // The next visit finishes it.
    db.failures = {};
    expect(await importLegacyChats(ME, NOW)).toEqual({ ok: true, chats: 2, messages: 3 });
    expect(db.tables.chat_user_prefs[0]).toMatchObject({ legacy_imported_at: NOW.toISOString() });
  });

  it('keeps the order Agent Chat showed a thread in when its messages share one time', async () => {
    // Agent Chat wrote the whole thread again on each turn, in one insert:
    // one created_at for all, and ids that don't follow the order.
    const at = '2026-09-01T12:30:00.000Z';
    db.tables.agent_conversations = [legacyChat(1)];
    db.tables.agent_messages = [
      { ...legacyMsg(9, 1, 'user', 'First question'), created_at: at },
      { ...legacyMsg(3, 1, 'assistant', 'First answer'), created_at: at },
      { ...legacyMsg(7, 1, 'user', 'Second question'), created_at: at },
      { ...legacyMsg(1, 1, 'assistant', 'Second answer'), created_at: at },
    ];
    expect(await importLegacyChats(ME, NOW)).toEqual({ ok: true, chats: 1, messages: 4 });
    const copied = [...db.tables.chat_messages].sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)),
    );
    expect(copied.map((m) => m.content_md)).toEqual([
      'First question',
      'First answer',
      'Second question',
      'Second answer',
    ]);
    expect(copied.map((m) => m.created_at)).toEqual([
      at,
      '2026-09-01T12:30:00.001Z',
      '2026-09-01T12:30:00.002Z',
      '2026-09-01T12:30:00.003Z',
    ]);
    expect(copied[3]).toMatchObject({ generated_at: '2026-09-01T12:30:00.003Z' });
    expect(db.tables.chat_conversations[0]).toMatchObject({
      last_message_at: '2026-09-01T12:30:00.003Z',
    });
  });

  it('reads the messages page by page', async () => {
    db.tables.agent_conversations = [legacyChat(1)];
    db.tables.agent_messages = Array.from({ length: 1_203 }, (_, i) => ({
      ...legacyMsg(i + 1, 1, i % 2 ? 'assistant' : 'user', `Message ${i + 1}`, 0),
      created_at: new Date(Date.UTC(2026, 8, 1, 12, 0, i)).toISOString(),
    }));
    expect(await importLegacyChats(ME, NOW)).toEqual({ ok: true, chats: 1, messages: 1_203 });
    expect(new Set(db.tables.chat_messages.map((m) => m.id)).size).toBe(1_203);
    expect(db.tables.chat_conversations[0]).toMatchObject({
      last_message_at: new Date(Date.UTC(2026, 8, 1, 12, 0, 1_202)).toISOString(),
    });
  });
});

describe('legacyTitle and legacyMessage', () => {
  it("drops Agent Chat's default title and keeps a title within Chat's limit", () => {
    expect(legacyTitle('New conversation')).toBeNull();
    expect(legacyTitle('  ')).toBeNull();
    expect(legacyTitle(null)).toBeNull();
    expect(legacyTitle(`  ${'a'.repeat(250)} `)).toHaveLength(200);
  });

  it('keeps words only, within the message limit', () => {
    const base = { id: MSG(1), conversation_id: CHAT(1), created_at: NOW.toISOString() };
    expect(legacyMessage({ ...base, role: 'tool', content: 'x' })).toBeNull();
    expect(legacyMessage({ ...base, role: 'assistant', content: ' \n' })).toBeNull();
    expect(legacyMessage({ ...base, role: 'user', content: null })).toBeNull();
    expect(
      legacyMessage({ ...base, role: 'user', content: 'x'.repeat(200_005) })?.content_md,
    ).toHaveLength(200_000);

    // Never half of an emoji at the cut.
    expect(
      legacyMessage({ ...base, role: 'user', content: `${'x'.repeat(199_999)}😀` })?.content_md,
    ).toBe('x'.repeat(199_999));
    expect(legacyTitle(`${'a'.repeat(199)}😀`)).toBe('a'.repeat(199));
  });
});
