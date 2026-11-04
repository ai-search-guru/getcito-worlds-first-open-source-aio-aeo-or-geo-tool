// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatGeneralAccess } from '@/lib/chat/generalSettings';

/**
 * The person's Chat settings (CHAT-01 items 4f, 9d, 16; CHAT-04 item 16;
 * Settings › General; DECISIONS N3): written to their own chat_user_prefs row, only with the new
 * Chat on, only what they may pick, and answered as a value — never thrown
 * (#1777).
 */

const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  upserts: [] as { row: unknown; options: unknown }[],
  error: null as { message: string } | null,
  throws: false,
  access: {
    modes: true,
    fullAutoLock: null,
    slack: false,
  } as ChatGeneralAccess | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (db.throws) throw new Error('down');
    return {
      auth: { getUser: async () => ({ data: { user: db.user } }) },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { organization_id: 'org-1' }, error: null }),
          }),
        }),
        upsert: async (row: unknown, options: unknown) => {
          expect(table).toBe('chat_user_prefs');
          db.upserts.push({ row, options });
          return { error: db.error };
        },
      }),
    };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/generalSettings', async (original) => ({
  ...(await original<typeof import('@/lib/chat/generalSettings')>()),
  readChatGeneral: vi.fn(async () => (db.access ? { settings: {}, access: db.access } : null)),
}));

const {
  markFocusPrompted,
  saveChatFocus,
  saveChatGeneralSettings,
  saveChatMenuOpen,
  saveChatPanelSize,
  saveChatRailOpen,
  saveHomeSeen,
  saveUsageNoticePeriod,
  skipChatFocus,
} = await import('./chatPrefs');
const { readChatGeneral } = await import('@/lib/chat/generalSettings');

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.user = { id: 'user-1' };
  db.upserts = [];
  db.error = null;
  db.throws = false;
  db.access = { modes: true, fullAutoLock: null, slack: false };
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  errorLog.mockRestore();
});

describe('saveChatMenuOpen and saveChatRailOpen', () => {
  it("keeps the choice on the person's own row", async () => {
    expect(await saveChatMenuOpen(false)).toEqual({ ok: true });
    expect(await saveChatRailOpen(true)).toEqual({ ok: true });
    expect(db.upserts).toEqual([
      { row: { user_id: 'user-1', menu_open: false }, options: { onConflict: 'user_id' } },
      { row: { user_id: 'user-1', rail_open: true }, options: { onConflict: 'user_id' } },
    ]);
  });

  it('does nothing while the new Chat is off, signed out or for a bad value', async () => {
    db.user = null;
    expect(await saveChatMenuOpen(true)).toEqual({ ok: false });
    expect(await saveChatRailOpen(true)).toEqual({ ok: false });
    db.user = { id: 'user-1' };
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await saveChatMenuOpen(true)).toEqual({ ok: false });
    expect(await saveChatRailOpen(true)).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    expect(await saveChatMenuOpen('yes' as unknown as boolean)).toEqual({ ok: false });
    expect(await saveChatRailOpen(1 as unknown as boolean)).toEqual({ ok: false });
    expect(db.upserts).toEqual([]);
  });

  it('answers a failed write or a thrown error as a value', async () => {
    db.error = { message: 'nope' };
    expect(await saveChatMenuOpen(true)).toEqual({ ok: false });
    expect(await saveChatRailOpen(true)).toEqual({ ok: false });
    db.throws = true;
    expect(await saveChatMenuOpen(true)).toEqual({ ok: false });
    expect(await saveChatRailOpen(true)).toEqual({ ok: false });
  });
});

describe('saveChatGeneralSettings', () => {
  it('keeps each General setting as its column', async () => {
    expect(
      await saveChatGeneralSettings({
        defaultMode: 'ask_first',
        answerLanguage: 'tr',
        notifyVia: 'inbox',
        showThought: false,
        panelOnPages: false,
      }),
    ).toEqual({ ok: true });
    expect(await saveChatGeneralSettings({ answerLanguage: null })).toEqual({ ok: true });
    expect(db.upserts.map((u) => u.row)).toEqual([
      {
        user_id: 'user-1',
        default_mode: 'ask_first',
        answer_language: 'tr',
        notify_via: 'inbox',
        show_thought: false,
        panel_on_pages: false,
      },
      { user_id: 'user-1', answer_language: null },
    ]);
    expect(readChatGeneral).toHaveBeenCalledWith({ userId: 'user-1', organizationId: 'org-1' });
  });

  it('refuses an unknown setting, a bad value or nothing at all', async () => {
    for (const bad of [
      {},
      null,
      { theme: 'dark' },
      { defaultMode: 'yolo' },
      { answerLanguage: 'xx' },
      { showThought: 'yes' },
    ]) {
      expect(await saveChatGeneralSettings(bad)).toEqual({ ok: false });
    }
    expect(db.upserts).toEqual([]);
  });

  it('refuses what the person may not pick: a mode for a reader, locked Full auto, Slack unconnected', async () => {
    db.access = { modes: false, fullAutoLock: null, slack: false };
    expect(await saveChatGeneralSettings({ defaultMode: 'auto' })).toEqual({ ok: false });
    // A reader still keeps their other settings.
    expect(await saveChatGeneralSettings({ showThought: false })).toEqual({ ok: true });
    db.access = { modes: true, fullAutoLock: 'plan', slack: false };
    expect(await saveChatGeneralSettings({ defaultMode: 'full_auto' })).toEqual({ ok: false });
    expect(await saveChatGeneralSettings({ notifyVia: 'inbox_slack' })).toEqual({ ok: false });
    db.access = null;
    expect(await saveChatGeneralSettings({ showThought: true })).toEqual({ ok: false });
    expect(db.upserts.map((u) => u.row)).toEqual([{ user_id: 'user-1', show_thought: false }]);
  });

  it('answers a failure as a value', async () => {
    db.error = { message: 'nope' };
    expect(await saveChatGeneralSettings({ showThought: true })).toEqual({ ok: false });
    db.throws = true;
    expect(await saveChatGeneralSettings({ showThought: true })).toEqual({ ok: false });
    vi.mocked(readChatGeneral).mockRejectedValueOnce(new Error('down'));
    db.throws = false;
    expect(await saveChatGeneralSettings({ showThought: true })).toEqual({ ok: false });
  });
});

describe('saveChatPanelSize', () => {
  it("keeps the panel's size on the person's own row", async () => {
    expect(await saveChatPanelSize('wide')).toEqual({ ok: true });
    expect(db.upserts).toEqual([
      { row: { user_id: 'user-1', panel_size: 'wide' }, options: { onConflict: 'user_id' } },
    ]);
  });

  it('keeps no size it does not know', async () => {
    expect(await saveChatPanelSize('huge' as 'wide')).toEqual({ ok: false });
    expect(db.upserts).toEqual([]);
  });
});

describe('saveUsageNoticePeriod', () => {
  it('keeps the period whose 80% line the person saw on their own row', async () => {
    expect(await saveUsageNoticePeriod('2026-10-01')).toEqual({ ok: true });
    expect(db.upserts).toEqual([
      {
        row: { user_id: 'user-1', usage_notice_period: '2026-10-01' },
        options: { onConflict: 'user_id' },
      },
    ]);
  });

  it('keeps nothing that is not a day', async () => {
    expect(await saveUsageNoticePeriod('2026-10-01T00:00:00Z')).toEqual({ ok: false });
    expect(await saveUsageNoticePeriod(7 as unknown as string)).toEqual({ ok: false });
    expect(db.upserts).toEqual([]);
  });
});

describe('saveHomeSeen', () => {
  it('keeps when the person left Chat Home on their own row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
    expect(await saveHomeSeen()).toEqual({ ok: true });
    vi.useRealTimers();
    expect(db.upserts).toEqual([
      {
        row: { user_id: 'user-1', home_seen_at: '2026-10-31T09:00:00.000Z' },
        options: { onConflict: 'user_id' },
      },
    ]);
  });
});

describe('saveChatFocus, skipChatFocus and markFocusPrompted (CHAT-24 §3)', () => {
  it('keeps the picks in their order, a skip as none, and when the picker opened', async () => {
    expect(await saveChatFocus(['pd', 'comp'])).toEqual({ ok: true });
    expect(await saveChatFocus([])).toEqual({ ok: true });
    expect(await skipChatFocus()).toEqual({ ok: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
    expect(await markFocusPrompted()).toEqual({ ok: true });
    vi.useRealTimers();
    expect(db.upserts.map((u) => u.row)).toEqual([
      { user_id: 'user-1', focus: ['pd', 'comp'] },
      { user_id: 'user-1', focus: [] },
      { user_id: 'user-1', focus: [] },
      { user_id: 'user-1', focus_prompted_at: '2026-10-31T09:00:00.000Z' },
    ]);
  });

  it('keeps no area it does not know, none twice, and nothing that is not a list', async () => {
    for (const bad of [['pd', 'pd'], ['devtools'], 'pd', null, [1]]) {
      expect(await saveChatFocus(bad)).toEqual({ ok: false });
    }
    expect(db.upserts).toEqual([]);
  });

  it('does nothing while the new Chat is off, and answers a failure as a value', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await saveChatFocus(['lead'])).toEqual({ ok: false });
    expect(await skipChatFocus()).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    db.error = { message: 'nope' };
    expect(await saveChatFocus(['lead'])).toEqual({ ok: false });
    db.throws = true;
    expect(await markFocusPrompted()).toEqual({ ok: false });
  });
});
