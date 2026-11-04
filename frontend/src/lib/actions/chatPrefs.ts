'use server';

import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { focusPicks } from '@/lib/chat/focus';
import {
  generalPatch,
  generalPatchRefusal,
  generalPatchRow,
  readChatGeneral,
} from '@/lib/chat/generalSettings';
import { PANEL_SIZES, type PanelSize } from '@/lib/chat/panel';

/**
 * A person's Chat settings that follow them to every device (DECISIONS N3;
 * chat_user_prefs, 00400 and 00408), written as the person: the row's
 * policies keep it theirs. Behind CHAT_AGENTIC. Answers as values and never
 * throws (#1777): a setting that didn't save only means it isn't kept for
 * the next visit.
 */

export type ChatPrefResult = { ok: true } | { ok: false };

type Person = { client: Awaited<ReturnType<typeof createClient>>; userId: string; orgId: string };

/** The signed-in person with the new Chat on for their workspace, or null. */
async function chatPerson(): Promise<Person | null> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  const { data: profile } = await client
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const orgId = profile?.organization_id ?? null;
  if (!chatAgenticEnabled(orgId)) return null;
  return { client, userId: user.id, orgId: orgId ?? '' };
}

/**
 * Keeps these columns on the person's own row (the person read here unless
 * given); false when it isn't theirs to keep. Logs a failure, never throws.
 */
async function keepPref(
  row: Record<string, string | string[] | boolean | null>,
  what: string,
  person?: Person,
): Promise<ChatPrefResult> {
  try {
    const who = person ?? (await chatPerson());
    if (!who) return { ok: false };
    const { error } = await who.client
      .from('chat_user_prefs')
      .upsert({ user_id: who.userId, ...row }, { onConflict: 'user_id' });
    if (error) {
      console.error(`[chat-prefs] could not keep ${what}:`, error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.error(`[chat-prefs] could not keep ${what}:`, error);
    return { ok: false };
  }
}

/**
 * The chat menu shown or hidden (CHAT-01 items 9a, 9d: the toggle and
 * `Ctrl+\`), kept on the person for every Chat route and device.
 */
export async function saveChatMenuOpen(open: boolean): Promise<ChatPrefResult> {
  if (typeof open !== 'boolean') return { ok: false };
  return keepPref({ menu_open: open }, 'the menu state');
}

/**
 * The app sidebar on Chat screens expanded or the 56px rail (CHAT-01 item
 * 4f: a click on the logo), kept on the person for every device.
 */
export async function saveChatRailOpen(open: boolean): Promise<ChatPrefResult> {
  if (typeof open !== 'boolean') return { ok: false };
  return keepPref({ rail_open: open }, 'the rail state');
}

/**
 * The side panel's size (CHAT-01 item 16: compact, wide or full screen),
 * kept on the person so the panel opens at its last size on every page and
 * device.
 */
export async function saveChatPanelSize(size: PanelSize): Promise<ChatPrefResult> {
  if (!PANEL_SIZES.includes(size)) return { ok: false };
  return keepPref({ panel_size: size }, 'the panel size');
}

/**
 * The AI usage period whose 80% line above the composer the person saw
 * (CHAT-04 item 16; chat_user_prefs.usage_notice_period, its first day),
 * so the line shows once per person per period, on every device.
 */
export async function saveUsageNoticePeriod(period: string): Promise<ChatPrefResult> {
  if (typeof period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(period)) return { ok: false };
  return keepPref({ usage_notice_period: period }, 'the usage notice');
}

/**
 * The person left Chat Home (CHAT-22 §1; chat_user_prefs.home_seen_at,
 * 00420): "Since you left" counts from it on their next visit, on every
 * device.
 */
export async function saveHomeSeen(): Promise<ChatPrefResult> {
  return keepPref({ home_seen_at: new Date().toISOString() }, 'the Home visit');
}

/**
 * What Chat focuses on for the person (CHAT-24 §3: the picker on first
 * open, Settings › General › Your focus, the Home pill), in the order
 * picked. Empty clears it: Home goes back to the default.
 */
export async function saveChatFocus(areas: unknown): Promise<ChatPrefResult> {
  const parsed = focusPicks.safeParse(areas);
  if (!parsed.success) return { ok: false };
  return keepPref({ focus: parsed.data }, 'the focus');
}

/** "Skip for now" in the focus picker: no focus, and the picker doesn't open by itself again. */
export async function skipChatFocus(): Promise<ChatPrefResult> {
  return keepPref({ focus: [] }, 'a skipped focus');
}

/**
 * The focus picker opened by itself (chat_user_prefs.focus_prompted_at,
 * 00408): it shows once per person, so leaving it without a pick doesn't
 * bring it back on the next visit.
 */
export async function markFocusPrompted(): Promise<ChatPrefResult> {
  return keepPref({ focus_prompted_at: new Date().toISOString() }, 'the focus prompt');
}

/**
 * A change in Chat Settings › General (CHAT-23 `chatSettings.*`): default
 * mode, answer language, notifications, "Thought for N s", Ask Chat on
 * every page. Refused when the person may not pick it: a mode for a role
 * that only reads, Full auto the plan or the Admin keeps closed, Slack
 * while it isn't connected.
 */
export async function saveChatGeneralSettings(patch: unknown): Promise<ChatPrefResult> {
  try {
    const parsed = generalPatch.safeParse(patch);
    if (!parsed.success) return { ok: false };
    const person = await chatPerson();
    if (!person?.orgId) return { ok: false };
    const general = await readChatGeneral({ userId: person.userId, organizationId: person.orgId });
    if (!general || generalPatchRefusal(parsed.data, general.access)) return { ok: false };
    return await keepPref(generalPatchRow(parsed.data), 'a General setting', person);
  } catch (error) {
    console.error('[chat-prefs] could not keep a General setting:', error);
    return { ok: false };
  }
}
