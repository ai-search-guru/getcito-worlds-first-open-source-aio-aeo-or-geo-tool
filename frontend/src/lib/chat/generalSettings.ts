import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import type { ChatActor } from './engine';
import { planFactsFromOrgRow } from './planFacts';
import { CHAT_MODES, parseTeamRole, type ChatMode } from './precedence';

/**
 * Chat Settings › General (CHAT-01 owner update 2026-10-26; CHAT-23
 * `chatSettings.*`; mockup #s-settings): the person's own preferences, kept
 * on chat_user_prefs (00408) so they follow them to every device — the mode
 * a new chat starts in, the language Chat answers in, how they hear that an
 * agent needs them, "Thought for N s", and Ask Chat on every page. Read with
 * the service role, with the facts that say what they may pick: their role
 * (Analysts and Agency partners only read, so they pick no mode), the plan
 * and the workspace's switch for Full auto (CHAT-20 §5), and whether Slack
 * is connected. Server only.
 */

/**
 * The answer languages offered, as BCP 47 tags: the ones Chat reads and
 * names (language.ts LANGUAGES), so a set language is the one the engine
 * tells the writer and rewrites into.
 */
export const ANSWER_LANGUAGES = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl'] as const;
export type AnswerLanguage = (typeof ANSWER_LANGUAGES)[number];

/** How the person hears that an agent needs them (00408 notify_via). */
export const NOTIFY_CHANNELS = ['inbox_email', 'inbox', 'inbox_slack'] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export interface ChatGeneralSettings {
  defaultMode: ChatMode;
  /** Null: the language of their question. */
  answerLanguage: AnswerLanguage | null;
  notifyVia: NotifyChannel;
  showThought: boolean;
  panelOnPages: boolean;
}

/** What the person may pick, and why not. */
export interface ChatGeneralAccess {
  /** They pick a default mode: not an Analyst or Agency partner, who only read. */
  modes: boolean;
  /** Why Full auto can't be picked: the plan (Growth+, paid) or the Admin's switch; null when it can. */
  fullAutoLock: 'plan' | 'admin' | null;
  /** Slack is connected, for "Inbox + Slack". The app has no Slack connection yet. */
  slack: boolean;
}

export const DEFAULT_CHAT_GENERAL: ChatGeneralSettings = {
  defaultMode: 'auto',
  answerLanguage: null,
  notifyVia: 'inbox_email',
  showThought: true,
  panelOnPages: true,
};

interface PrefsRow {
  default_mode?: string | null;
  answer_language?: string | null;
  notify_via?: string | null;
  show_thought?: boolean | null;
  panel_on_pages?: boolean | null;
}

/** A saved row as the page shows it: anything it doesn't know is the default. */
export function generalFromRow(row: PrefsRow | null): ChatGeneralSettings {
  const d = DEFAULT_CHAT_GENERAL;
  return {
    defaultMode: CHAT_MODES.find((m) => m === row?.default_mode) ?? d.defaultMode,
    answerLanguage: ANSWER_LANGUAGES.find((l) => l === row?.answer_language) ?? null,
    notifyVia: NOTIFY_CHANNELS.find((n) => n === row?.notify_via) ?? d.notifyVia,
    showThought: row?.show_thought ?? d.showThought,
    panelOnPages: row?.panel_on_pages ?? d.panelOnPages,
  };
}

/**
 * The person's General settings and what they may pick, or null when they
 * aren't a member of the workspace with a live role. A saved Full auto that
 * is locked now shows as Auto, ask before changes, as the composer starts it.
 * A read that fails throws.
 */
export async function readChatGeneral(
  actor: Pick<ChatActor, 'userId' | 'organizationId'>,
): Promise<{ settings: ChatGeneralSettings; access: ChatGeneralAccess } | null> {
  const [profile, org, workspace, prefs] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', actor.userId)
      .maybeSingle(),
    supabaseAdmin
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', actor.organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_settings')
      .select('full_auto_for_members')
      .eq('organization_id', actor.organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_user_prefs')
      .select('default_mode, answer_language, notify_via, show_thought, panel_on_pages')
      .eq('user_id', actor.userId)
      .maybeSingle(),
  ]);
  for (const read of [profile, org, workspace, prefs]) {
    if (read.error) throw new Error(`Could not read Chat's settings: ${read.error.message}`);
  }
  const role = parseTeamRole(profile.data?.role);
  if (!role || profile.data?.organization_id !== actor.organizationId || !org.data) return null;

  const modes = role === 'admin' || role === 'manager';
  // No chat_settings row: Full auto is open to members (00401's default).
  const forMembers =
    (workspace.data as { full_auto_for_members?: boolean } | null)?.full_auto_for_members ?? true;
  const fullAutoLock = !planFactsFromOrgRow(org.data).fullAuto
    ? 'plan'
    : role !== 'admin' && !forMembers
      ? 'admin'
      : null;
  const settings = generalFromRow(prefs.data as PrefsRow | null);
  if (settings.defaultMode === 'full_auto' && fullAutoLock) settings.defaultMode = 'auto';
  return { settings, access: { modes, fullAutoLock, slack: false } };
}

/** A change from Settings › General: one setting or more. */
export const generalPatch = z
  .object({
    defaultMode: z.enum(CHAT_MODES).optional(),
    answerLanguage: z.enum(ANSWER_LANGUAGES).nullable().optional(),
    notifyVia: z.enum(NOTIFY_CHANNELS).optional(),
    showThought: z.boolean().optional(),
    panelOnPages: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);
export type GeneralPatch = z.infer<typeof generalPatch>;

/** Why a change can't be kept for this person, or null when it can. */
export function generalPatchRefusal(
  patch: GeneralPatch,
  access: ChatGeneralAccess,
): 'role' | 'full_auto_locked' | 'slack' | null {
  if (patch.defaultMode !== undefined && !access.modes) return 'role';
  if (patch.defaultMode === 'full_auto' && access.fullAutoLock) return 'full_auto_locked';
  if (patch.notifyVia === 'inbox_slack' && !access.slack) return 'slack';
  return null;
}

/** The change as chat_user_prefs' columns (00408). */
export function generalPatchRow(patch: GeneralPatch): Record<string, string | boolean | null> {
  const row: Record<string, string | boolean | null> = {};
  if (patch.defaultMode !== undefined) row.default_mode = patch.defaultMode;
  if (patch.answerLanguage !== undefined) row.answer_language = patch.answerLanguage;
  if (patch.notifyVia !== undefined) row.notify_via = patch.notifyVia;
  if (patch.showThought !== undefined) row.show_thought = patch.showThought;
  if (patch.panelOnPages !== undefined) row.panel_on_pages = patch.panelOnPages;
  return row;
}
