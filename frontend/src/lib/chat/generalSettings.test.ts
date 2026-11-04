// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { ORG, OTHER_ORG, PEOPLE } from './testing/chatFixtures';

/**
 * Chat Settings › General (CHAT-23 `chatSettings.*`): the person's saved
 * choices with the defaults for anything not saved, and what they may pick —
 * no mode for a role that only reads, Full auto only on a paid Growth plan
 * and where the Admin leaves it on for members, no Slack until it connects.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const general = await import('./generalSettings');
const { LANGUAGES } = await import('./language');

const ME = { userId: PEOPLE.manager, organizationId: ORG };

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  db.failures = {};
  db.tables = {
    profiles: [
      { id: PEOPLE.admin, role: 'admin', organization_id: ORG },
      { id: PEOPLE.manager, role: 'manager', organization_id: ORG },
      { id: PEOPLE.analyst, role: 'analyst', organization_id: ORG },
    ],
    organizations: [
      { id: ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
    ],
    chat_settings: [],
    chat_user_prefs: [],
  };
});
afterEach(() => vi.unstubAllEnvs());

describe('readChatGeneral', () => {
  it('answers the defaults when nothing is saved, with Full auto open on a paid Growth plan', async () => {
    expect(await general.readChatGeneral(ME)).toEqual({
      settings: general.DEFAULT_CHAT_GENERAL,
      access: { modes: true, fullAutoLock: null, slack: false },
    });
  });

  it('reads what the person saved', async () => {
    db.tables.chat_user_prefs = [
      {
        user_id: ME.userId,
        default_mode: 'full_auto',
        answer_language: 'tr',
        notify_via: 'inbox',
        show_thought: false,
        panel_on_pages: false,
      },
    ];
    expect((await general.readChatGeneral(ME))?.settings).toEqual({
      defaultMode: 'full_auto',
      answerLanguage: 'tr',
      notifyVia: 'inbox',
      showThought: false,
      panelOnPages: false,
    });
  });

  it('locks Full auto below Growth, on a trial, or when the Admin turned it off for members', async () => {
    db.tables.chat_user_prefs = [{ user_id: ME.userId, default_mode: 'full_auto' }];
    db.tables.organizations[0].plan = 'starter';
    let read = await general.readChatGeneral(ME);
    expect(read?.access.fullAutoLock).toBe('plan');
    // A saved Full auto that is locked now starts as Auto, as in the composer.
    expect(read?.settings.defaultMode).toBe('auto');

    db.tables.organizations[0].plan = 'growth';
    db.tables.organizations[0].subscription_status = 'trialing';
    expect((await general.readChatGeneral(ME))?.access.fullAutoLock).toBe('plan');

    db.tables.organizations[0].subscription_status = 'active';
    db.tables.chat_settings = [{ organization_id: ORG, full_auto_for_members: false }];
    read = await general.readChatGeneral(ME);
    expect(read?.access.fullAutoLock).toBe('admin');
    // The switch is for members: an Admin keeps Full auto.
    read = await general.readChatGeneral({ userId: PEOPLE.admin, organizationId: ORG });
    expect(read?.access.fullAutoLock).toBeNull();
  });

  it('gives a role that only reads no mode to pick, and nothing to someone outside the workspace', async () => {
    const analyst = await general.readChatGeneral({ userId: PEOPLE.analyst, organizationId: ORG });
    expect(analyst?.access.modes).toBe(false);
    expect(await general.readChatGeneral({ ...ME, organizationId: OTHER_ORG })).toBeNull();
    expect(await general.readChatGeneral({ userId: 'nobody', organizationId: ORG })).toBeNull();
  });

  it('throws when a read fails', async () => {
    db.failures = { chat_user_prefs: { message: 'down' } };
    await expect(general.readChatGeneral(ME)).rejects.toThrow("Could not read Chat's settings");
  });
});

describe('generalFromRow', () => {
  it('reads anything it does not know as the default', () => {
    expect(
      general.generalFromRow({
        default_mode: 'yolo',
        answer_language: 'xx',
        notify_via: 'pager',
        show_thought: null,
      }),
    ).toEqual(general.DEFAULT_CHAT_GENERAL);
  });
});

describe('generalPatchRefusal and generalPatchRow', () => {
  const open = { modes: true, fullAutoLock: null, slack: false } as const;

  it('refuses a mode for a reader, locked Full auto and unconnected Slack', () => {
    expect(general.generalPatchRefusal({ defaultMode: 'auto' }, { ...open, modes: false })).toBe(
      'role',
    );
    expect(
      general.generalPatchRefusal({ defaultMode: 'full_auto' }, { ...open, fullAutoLock: 'plan' }),
    ).toBe('full_auto_locked');
    expect(general.generalPatchRefusal({ notifyVia: 'inbox_slack' }, open)).toBe('slack');
    expect(general.generalPatchRefusal({ defaultMode: 'full_auto', showThought: true }, open)).toBe(
      null,
    );
  });

  it('writes only the columns that changed', () => {
    expect(general.generalPatchRow({ answerLanguage: null, panelOnPages: true })).toEqual({
      answer_language: null,
      panel_on_pages: true,
    });
  });
});

describe('ANSWER_LANGUAGES', () => {
  it('are the languages Chat reads and names, so a set one is the one the engine uses', () => {
    expect([...general.ANSWER_LANGUAGES].sort()).toEqual(Object.keys(LANGUAGES).sort());
  });
});
