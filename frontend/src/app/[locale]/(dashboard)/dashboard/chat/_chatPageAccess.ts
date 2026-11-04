import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { focusFromWorkAreas, focusOf, type FocusArea } from '@/lib/chat/focus';
import { skillsByFocus } from '@/lib/chat/focusHome';
import { firstNameOf } from '@/lib/chat/home';
import { importLegacyChats } from '@/lib/chat/legacyImport';
import { chatRunsOnOwnKey } from '@/lib/chat/key';
import { failingKeyFor } from '@/lib/chat/keyHealth';
import { CAREFUL_SETUP, composerSetupOf, type ChatComposerSetup } from '@/lib/chat/composerSetup';
import { readPrecedenceContext } from '@/lib/chat/precedenceContext';
import { skillMenuFor } from '@/lib/chat/skills/store';
import { isChatStaff } from '@/lib/chat/staff';

export { composerSetupOf, type ChatComposerSetup };

/** Whether the signed-in person's workspace has the new Chat on (CHAT_AGENTIC). */
export async function chatPageOpen(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  return chatAgenticEnabled(profile?.organization_id ?? null);
}

/** What the Chat shell opens with: the person's saved choices (chat_user_prefs). */
export interface ChatShellPrefs {
  /** The chat menu shown (the default) or hidden (CHAT-01 item 9d). */
  menuOpen: boolean;
  /** The app sidebar expanded beside Chat, or the rail (the default; CHAT-01 4f). */
  railOpen: boolean;
  /** GetCito staff (STAFF_EMAILS): the chat's ⋯ menu offers Debug (CHAT-03 item 25). */
  staff: boolean;
}

/**
 * The shell's saved choices, or null while the new Chat is off for the
 * person's workspace (the Chat pages then answer as they do today). A
 * choice that can't be read falls back to its default. On the person's
 * first visit their Agent Chat conversations are copied in first (W1-02),
 * so the menu lists them; a copy that fails is tried again next time and
 * never keeps Chat from opening.
 */
export async function chatShellPrefs(): Promise<ChatShellPrefs | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const organizationId = profile?.organization_id ?? null;
  if (!chatAgenticEnabled(organizationId)) return null;
  const { data: prefs, error } = await supabase
    .from('chat_user_prefs')
    .select('menu_open, rail_open, legacy_imported_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (organizationId && !error && !prefs?.legacy_imported_at) {
    await importLegacyChats({ userId: user.id, email: user.email ?? null, organizationId });
  }
  return {
    menuOpen: prefs?.menu_open ?? true,
    railOpen: prefs?.rail_open ?? false,
    staff: isChatStaff(user),
  };
}

/**
 * The first name Chat Home greets the person with (CHAT-01 item 10): their
 * profile's name, else their sign-in's; null without one.
 */
export async function chatFirstName(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();
  const metadataName = (user.user_metadata as { full_name?: unknown } | null)?.full_name;
  return firstNameOf(
    profile?.full_name ?? (typeof metadataName === 'string' ? metadataName : null),
  );
}

/** What Chat focuses on for the person (CHAT-24 §3), as Home and Settings › General open. */
export interface ChatFocusState {
  /** The picked areas, in order; empty when skipped or cleared; null when never asked. */
  focus: FocusArea[] | null;
  /** The picker opens by itself: never answered and never shown (it shows once). */
  ask: boolean;
  /** The picks the picker starts with when there are none: from the person's work areas. */
  prefill: FocusArea[];
}

const NO_FOCUS: ChatFocusState = { focus: null, ask: false, prefill: [] };

/**
 * The person's focus, whether the picker should open by itself, and the
 * picks their work areas (Settings › Menu access) suggest. A read that
 * fails opens Home as it is, without the picker.
 */
export async function chatFocusState(): Promise<ChatFocusState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NO_FOCUS;
  const [profile, prefs] = await Promise.all([
    supabase.from('profiles').select('work_areas').eq('id', user.id).maybeSingle(),
    supabase
      .from('chat_user_prefs')
      .select('focus, focus_prompted_at')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);
  if (prefs.error) return NO_FOCUS;
  const focus = focusOf(prefs.data?.focus);
  return {
    focus,
    ask: focus === null && !prefs.data?.focus_prompted_at,
    prefill: focusFromWorkAreas(profile.data?.work_areas ?? null),
  };
}

/**
 * The composer's setup: the default mode the person chose in Chat's settings
 * (chat_user_prefs.default_mode; Auto, ask before changes, when none), and
 * Full auto as the server will decide it, the period whose 80% usage line
 * the person already saw, whether Chat runs on the workspace's own key, and
 * the skills in the / menu, their focus's first (CHAT-24 §1). A value that
 * can't be read falls back to the careful one.
 */
export async function chatComposerSetup(): Promise<ChatComposerSetup> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return CAREFUL_SETUP;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.organization_id) return CAREFUL_SETUP;
  const [{ data: prefs }, ctx, onOwnKey] = await Promise.all([
    supabase
      .from('chat_user_prefs')
      .select('default_mode, usage_notice_period, focus')
      .eq('user_id', user.id)
      .maybeSingle(),
    readPrecedenceContext({
      userId: user.id,
      organizationId: profile.organization_id,
      mode: 'ask_first',
      surface: 'chat',
    }).catch(() => null),
    chatRunsOnOwnKey(profile.organization_id).catch(() => false),
  ]);
  return {
    ...composerSetupOf(prefs?.default_mode, ctx),
    usageNoticeSeen: prefs?.usage_notice_period ?? null,
    onOwnKey,
    // Read only where Chat runs on the own key (AGENT-OWN-KEY §5.2 item 5).
    keyFailure: onOwnKey ? await failingKeyFor(profile.organization_id) : null,
    skills: skillsByFocus(
      await skillMenuFor(profile.organization_id, user.id),
      focusOf(prefs?.focus) ?? [],
    ),
  };
}
