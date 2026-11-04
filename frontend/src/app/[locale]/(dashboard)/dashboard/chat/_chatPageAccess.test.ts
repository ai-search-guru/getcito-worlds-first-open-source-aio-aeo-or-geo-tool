// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_SETTINGS, type PrecedenceContext } from '@/lib/chat/precedence';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * The Chat frame's saved choices (chatShellPrefs): none while the new Chat
 * is off, and on the person's first visit their Agent Chat conversations
 * are copied in (W1-02) — once, and never in the way of Chat opening. And
 * the composer's setup (W1-10): Full auto shows open only where the server
 * would run it, so a member whose Admin turned "Full auto for members" off
 * doesn't pick a mode that then asks anyway.
 */

const db = vi.hoisted(() => ({
  prefs: null as {
    menu_open?: boolean;
    rail_open?: boolean;
    legacy_imported_at?: string | null;
    default_mode?: string | null;
    usage_notice_period?: string | null;
    focus?: string[] | null;
    focus_prompted_at?: string | null;
  } | null,
  prefsError: null as { message: string } | null,
  workAreas: [] as string[] | null,
  confirmedAt: null as string | null,
}));

const facts = vi.hoisted(() => ({
  ctx: null as Pick<PrecedenceContext, 'role' | 'plan' | 'settings'> | null,
  fail: false,
  ownKey: false as boolean | 'throws',
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: { id: 'user-1', email: 'jo@example.com', email_confirmed_at: db.confirmedAt },
        },
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'profiles'
              ? { data: { organization_id: 'org-1', work_areas: db.workAreas }, error: null }
              : { data: db.prefs, error: db.prefsError },
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/chat/legacyImport', () => ({
  importLegacyChats: vi.fn(async () => ({ ok: false })),
}));
vi.mock('@/lib/chat/precedenceContext', () => ({
  readPrecedenceContext: vi.fn(async () => {
    if (facts.fail) throw new Error('no answer');
    return facts.ctx;
  }),
}));
vi.mock('@/lib/chat/key', () => ({
  chatRunsOnOwnKey: vi.fn(async () => {
    if (facts.ownKey === 'throws') throw new Error('no answer');
    return facts.ownKey;
  }),
}));
const keyHealth = vi.hoisted(() => ({
  failingKeyFor: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock('@/lib/chat/keyHealth', () => keyHealth);
// The workspace's own skills and the library skills it turned off (W3-06).
vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
const { supabaseAdmin } = await import('@/lib/supabase/admin');
const skillsDb = supabaseAdmin as unknown as FakeSupabase;

const { importLegacyChats } = await import('@/lib/chat/legacyImport');
const { chatPageOpen, chatShellPrefs, chatComposerSetup, chatFocusState } =
  await import('./_chatPageAccess');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.prefs = null;
  db.prefsError = null;
  db.confirmedAt = null;
  db.workAreas = [];
  facts.ctx = null;
  facts.fail = false;
  facts.ownKey = false;
  skillsDb.tables = {};
  vi.mocked(importLegacyChats).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

// Chat's pages and Agent Center's (/dashboard/agents) open only by this.
describe('chatPageOpen', () => {
  it('opens with the new Chat on for every workspace, or for the person’s', async () => {
    expect(await chatPageOpen()).toBe(true);
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2, ORG-1');
    expect(await chatPageOpen()).toBe(true);
  });

  it('stays shut with it off, or on only for other workspaces', async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2');
    expect(await chatPageOpen()).toBe(false);
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await chatPageOpen()).toBe(false);
  });
});

describe('chatShellPrefs', () => {
  it("copies the person's Agent Chat conversations on their first visit, and opens even when that fails", async () => {
    expect(await chatShellPrefs()).toEqual({ menuOpen: true, railOpen: false, staff: false });
    expect(importLegacyChats).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'jo@example.com',
      organizationId: 'org-1',
    });
  });

  it('copies nothing once they were copied, or when the settings could not be read', async () => {
    db.prefs = {
      menu_open: false,
      rail_open: true,
      legacy_imported_at: '2026-10-30T09:00:00.000Z',
    };
    expect(await chatShellPrefs()).toEqual({ menuOpen: false, railOpen: true, staff: false });
    db.prefs = null;
    db.prefsError = { message: 'down' };
    expect(await chatShellPrefs()).toEqual({ menuOpen: true, railOpen: false, staff: false });
    expect(importLegacyChats).not.toHaveBeenCalled();
  });

  it('says whether the person is GetCito staff: a confirmed e-mail in STAFF_EMAILS (W1-15)', async () => {
    vi.stubEnv('STAFF_EMAILS', 'ops@getcito.com, Jo@Example.com');
    expect((await chatShellPrefs())?.staff).toBe(false);
    db.confirmedAt = '2026-10-01T09:00:00.000Z';
    expect((await chatShellPrefs())?.staff).toBe(true);
    vi.stubEnv('STAFF_EMAILS', 'ops@getcito.com');
    expect((await chatShellPrefs())?.staff).toBe(false);
  });

  it('does nothing while the new Chat is off', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await chatShellPrefs()).toBeNull();
    expect(importLegacyChats).not.toHaveBeenCalled();
  });
});

/** The / menu's skills with the new Chat on: the library's, by name and title (W2-04). */
const SKILL_MENU = expect.arrayContaining([{ name: 'faq', title: 'FAQ from fan-outs' }]);

function ctxOf(
  role: PrecedenceContext['role'],
  fullAuto: boolean,
  fullAutoForMembers: boolean,
): Pick<PrecedenceContext, 'role' | 'plan' | 'settings'> {
  return {
    role,
    plan: { fullAuto } as PrecedenceContext['plan'],
    settings: { ...DEFAULT_CHAT_SETTINGS, fullAutoForMembers },
  };
}

describe('chatComposerSetup', () => {
  beforeEach(() => {
    db.prefs = { default_mode: 'full_auto', usage_notice_period: null };
  });

  it('keeps Full auto closed for a member when the Admin turned it off, and says why', async () => {
    facts.ctx = ctxOf('manager', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: true,
      usageNoticeSeen: null,
      onOwnKey: false,
      keyFailure: null,
      skills: SKILL_MENU,
    });
  });

  it('opens Full auto for an Admin whatever the members switch says', async () => {
    facts.ctx = ctxOf('admin', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'full_auto',
      fullAutoOpen: true,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
      onOwnKey: false,
      keyFailure: null,
      skills: SKILL_MENU,
    });
  });

  it('opens Full auto for a member with the switch on', async () => {
    facts.ctx = ctxOf('manager', true, true);
    expect((await chatComposerSetup()).fullAutoOpen).toBe(true);
  });

  it('names the plan, not the Admin, when the plan has no Full auto', async () => {
    facts.ctx = ctxOf('manager', false, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
      onOwnKey: false,
      keyFailure: null,
      skills: SKILL_MENU,
    });
  });

  it('keeps the usage period whose 80% line the person saw', async () => {
    db.prefs = { default_mode: 'auto', usage_notice_period: '2026-10' };
    facts.ctx = ctxOf('admin', true, false);
    expect((await chatComposerSetup()).usageNoticeSeen).toBe('2026-10');
  });

  it('falls back to the careful setup when the facts can’t be read', async () => {
    facts.fail = true;
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
      onOwnKey: false,
      keyFailure: null,
      skills: SKILL_MENU,
    });
  });

  it("lists the library's skills for the / menu, by name and title, and none with the new Chat off", async () => {
    facts.ctx = ctxOf('manager', true, true);
    const { skills } = await chatComposerSetup();
    expect(skills).toHaveLength(21);
    expect(skills.every((skill) => Object.keys(skill).join() === 'name,title')).toBe(true);
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect((await chatComposerSetup()).skills).toEqual([]);
  });

  it("adds the person's own and the shared skills to the / menu, without what the workspace turned off (W3-06)", async () => {
    facts.ctx = ctxOf('manager', true, true);
    const own = { organization_id: 'org-1', status: 'approved', enabled: true, source: 'user' };
    skillsDb.tables.chat_settings = [{ organization_id: 'org-1', disabled_skills: ['faq'] }];
    skillsDb.tables.chat_skills = [
      {
        ...own,
        id: 's1',
        name: 'team-brief',
        title: 'Team brief',
        visibility: 'private',
        created_by: 'user-1',
      },
      {
        ...own,
        id: 's2',
        name: 'house-tone',
        title: 'House tone',
        visibility: 'workspace',
        created_by: 'user-2',
      },
      {
        ...own,
        id: 's3',
        name: 'their-own',
        title: 'Their own',
        visibility: 'private',
        created_by: 'user-2',
      },
      {
        ...own,
        id: 's4',
        name: 'switched-off',
        title: 'Off',
        visibility: 'workspace',
        created_by: 'user-1',
        enabled: false,
      },
    ];
    const { skills } = await chatComposerSetup();
    expect(skills).toContainEqual({ name: 'team-brief', title: 'Team brief' });
    expect(skills).toContainEqual({ name: 'house-tone', title: 'House tone' });
    const names = skills.map((skill) => skill.name);
    for (const name of ['faq', 'their-own', 'switched-off']) expect(names).not.toContain(name);
    expect(skills).toHaveLength(22);
  });

  it("puts the person's focus's skills first in the / menu (CHAT-24 §1)", async () => {
    facts.ctx = ctxOf('manager', true, true);
    db.prefs = { focus: ['brand', 'lead'] };
    const { skills } = await chatComposerSetup();
    expect(skills.slice(0, 3).map((skill) => skill.name)).toEqual([
      'wrongclaim',
      'report',
      'facts',
    ]);
    expect(skills).toHaveLength(21);
  });

  it('passes on the period whose 80% line was seen, and whether Chat runs on its own key', async () => {
    facts.ctx = ctxOf('admin', true, false);
    db.prefs = { default_mode: 'full_auto', usage_notice_period: '2026-10-01' };
    facts.ownKey = true;
    const setup = await chatComposerSetup();
    expect(setup.usageNoticeSeen).toBe('2026-10-01');
    expect(setup.onOwnKey).toBe(true);

    // A key that can't be read: the careful answer, and the server's hold still decides.
    facts.ownKey = 'throws';
    expect((await chatComposerSetup()).onOwnKey).toBe(false);
  });

  it('says the own key fails, read only where Chat runs on it (AGENT-OWN-KEY §5.2)', async () => {
    facts.ctx = ctxOf('admin', true, false);
    keyHealth.failingKeyFor.mockClear();
    facts.ownKey = false;
    expect((await chatComposerSetup()).keyFailure).toBeNull();
    expect(keyHealth.failingKeyFor).not.toHaveBeenCalled();

    facts.ownKey = true;
    keyHealth.failingKeyFor.mockResolvedValueOnce({ class: 'no_credit', provider: 'openai' });
    expect((await chatComposerSetup()).keyFailure).toEqual({
      class: 'no_credit',
      provider: 'openai',
    });
  });
});

describe('chatFocusState (CHAT-24 §3)', () => {
  it('opens the picker once, for someone never asked, with their work areas picked', async () => {
    db.workAreas = ['product', 'bizdev', 'developers', 'aeo', 'unknown'];
    expect(await chatFocusState()).toEqual({
      focus: null,
      ask: true,
      prefill: ['pd', 'bd', 'seo'],
    });
    // Shown once already, left without a pick: it doesn't open by itself again.
    db.prefs = { focus: null, focus_prompted_at: '2026-10-31T09:00:00.000Z' };
    expect((await chatFocusState()).ask).toBe(false);
  });

  it('keeps the picks in their order, and a skip as none', async () => {
    db.prefs = { focus: ['brand', 'comp', 'brand', 'nope'], focus_prompted_at: null };
    expect(await chatFocusState()).toEqual({ focus: ['brand', 'comp'], ask: false, prefill: [] });
    db.prefs = { focus: [], focus_prompted_at: null };
    expect(await chatFocusState()).toMatchObject({ focus: [], ask: false });
  });

  it('opens Home as it is, without the picker, when the settings could not be read', async () => {
    db.prefsError = { message: 'down' };
    db.workAreas = null;
    expect(await chatFocusState()).toEqual({ focus: null, ask: false, prefill: [] });
  });
});
