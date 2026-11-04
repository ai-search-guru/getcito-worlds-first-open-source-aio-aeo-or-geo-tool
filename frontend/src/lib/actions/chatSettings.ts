'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { TeamRole } from '@/components/context/RoleProvider';
import { autoGoLiveEnabled, chatAgenticEnabled } from '@/lib/chat/flag';
import { readPrecedenceContext } from '@/lib/chat/precedenceContext';
import {
  ADMIN_POLICIES,
  effectivePolicy,
  policyChoiceLock,
  policyChoices,
  type AdminPolicy,
  type ChatSettings,
  type PrecedenceContext,
} from '@/lib/chat/precedence';
import { CHAT_TOOLS, chatToolByKey } from '@/lib/chat/registry/tools';
import {
  EXECUTE_GROUPS,
  type ExecuteGroup,
  type ToolArea,
  type ToolClass,
  type ToolFlags,
  type ToolPolicy,
} from '@/lib/chat/registry/defineTool';
import { planCardOf, type PlanCard } from '@/lib/chat/access';
import { qualityPhase } from '@/lib/content/quality';
import { GO_LIVE_GROUPS, GO_LIVE_TERMS } from '@/lib/chat/goLive';

/**
 * Settings › Chat (CHAT-20 §5, §8b; mockup #g-policy), behind CHAT_AGENTIC:
 * the tool policy per tool, Full auto for members, "Don't ask again", the
 * go-live groups Managers may click through, and the person's own "Don't
 * ask again" ticks. Everyone reads the rules Chat follows for them; only an
 * Admin changes the workspace's, and only within what each tool and the
 * plan allow (policyChoices, policyChoiceLock), checked here again. The
 * person removes their own ticks.
 *
 * Every action answers { ok } and never throws for a refusal or an
 * unreachable database (#1777): the page says what happened in plain words.
 */

export type SettingsFailure =
  | 'chat_off'
  | 'forbidden'
  | 'invalid'
  | 'locked'
  | 'read_only'
  | 'quality_off'
  | 'unavailable'
  | 'failed';
export type SettingsResult = { ok: true } | { ok: false; failure: SettingsFailure };

/** A tool as Settings › Chat lists it: by its label key, never its name. */
export interface PolicyRow {
  key: string;
  area: ToolArea;
  class: ToolClass;
  flags: ToolFlags;
  /** What applies now: the Admin's choice, else the row's default. */
  policy: ToolPolicy;
  defaultPolicy: ToolPolicy;
  /** Set by an Admin, not the default. */
  changed: boolean;
  /** What an Admin may pick besides the default, and which the plan locks. */
  choices: { policy: AdminPolicy; locked: boolean }[];
}

export interface ChatSettingsView {
  role: TeamRole;
  plan: PlanCard | null;
  /** Full auto and "Don't ask again" need Growth: the plan, when this workspace's lacks it. */
  fullAutoLocked: 'growth' | null;
  fullAutoForMembers: boolean;
  dontAskAgain: boolean;
  managerExecuteOff: ExecuteGroup[];
  rows: PolicyRow[];
  /** The person's own "Don't ask again" ticks, by label key. */
  autoChoices: string[];
  /** Agents that publish on their own (AUTONOMOUS-GO-LIVE §7.1); null with its flag off or before 00443. */
  goLive: GoLiveView | null;
}

/** The workspace switch for agents going live on their own, as Settings › Chat shows it. */
export interface GoLiveView {
  on: boolean;
  /** When it was last turned on, and by whom (their name, else their e-mail). */
  since: string | null;
  byName: string | null;
  /** Content Quality is off: each page is checked by it before it goes live. */
  qualityOff: boolean;
  /** The workspace's name, for the responsibility dialog. */
  workspace: string;
}

/** A column 00443 adds, missing: the web ahead of its migration. */
const beforeGoLive = (error: { code?: string; message?: string } | null) =>
  !!error &&
  (error.code === '42703' || error.code === 'PGRST204') &&
  (error.message ?? '').includes('auto_go_live');

interface Who {
  userId: string;
  organizationId: string;
  ctx: PrecedenceContext;
}

async function who(): Promise<Who | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const organizationId = profile?.organization_id;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return null;
  const ctx = await readPrecedenceContext({
    userId: user.id,
    organizationId,
    mode: 'ask_first',
    surface: 'chat',
  });
  return ctx ? { userId: user.id, organizationId, ctx } : null;
}

function rowsOf(ctx: PrecedenceContext): PolicyRow[] {
  return CHAT_TOOLS.map((tool) => ({
    key: tool.labelKey,
    area: tool.area,
    class: tool.class,
    flags: { ...tool.flags },
    policy: effectivePolicy(tool, ctx.settings),
    defaultPolicy: tool.defaultPolicy,
    changed: tool.labelKey in ctx.settings.toolPolicies,
    choices: policyChoices(tool).map((policy) => ({
      policy,
      locked: policyChoiceLock(ctx.plan, policy) !== null,
    })),
  }));
}

/** The page's facts for the signed-in person; null while Chat is off or the read fails. */
export async function getChatSettingsView(): Promise<
  { ok: true; view: ChatSettingsView } | { ok: false; failure: 'chat_off' | 'failed' }
> {
  try {
    const me = await who();
    if (!me) return { ok: false, failure: 'chat_off' };
    const { ctx } = me;
    return {
      ok: true,
      view: {
        role: ctx.role,
        plan: planCardOf(ctx.plan),
        fullAutoLocked: ctx.plan.fullAuto ? null : 'growth',
        fullAutoForMembers: ctx.settings.fullAutoForMembers,
        dontAskAgain: ctx.settings.dontAskAgain,
        managerExecuteOff: [...ctx.settings.managerExecuteOff],
        rows: rowsOf(ctx),
        autoChoices: [...ctx.autoChoices].filter((key) => chatToolByKey(key)),
        // Hidden while staff haven't turned the feature on (CHAT_AUTO_GO_LIVE).
        goLive: autoGoLiveEnabled(me.organizationId) ? await readGoLive(me.organizationId) : null,
      },
    };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** The workspace's go-live switch, with who turned it on; null before 00443. */
async function readGoLive(organizationId: string): Promise<GoLiveView | null> {
  const [settings, org] = await Promise.all([
    supabaseAdmin
      .from('chat_settings')
      .select('auto_go_live_groups, auto_go_live_at, auto_go_live_by')
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabaseAdmin.from('organizations').select('name').eq('id', organizationId).maybeSingle(),
  ]);
  if (beforeGoLive(settings.error)) return null;
  if (settings.error) throw new Error(settings.error.message);
  const row = settings.data;
  let byName: string | null = null;
  if (row?.auto_go_live_by) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', row.auto_go_live_by)
      .maybeSingle();
    byName = profile?.full_name?.trim() || null;
    if (!byName) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(row.auto_go_live_by);
      byName = data?.user?.email ?? null;
    }
  }
  return {
    on: GO_LIVE_GROUPS.every((group) => (row?.auto_go_live_groups ?? []).includes(group)),
    since: row?.auto_go_live_at ?? null,
    byName,
    qualityOff: qualityPhase() < 1,
    workspace: org.data?.name ?? '',
  };
}

/**
 * Turns agents' going live on their own on or off for the workspace
 * (AUTONOMOUS-GO-LIVE §7.1). On: Admins only, with Full auto's plan and
 * Content Quality on, after the responsibility dialog (its text's version
 * kept, with who and when). Off takes effect from the next call; agents'
 * own permissions are kept, inert.
 */
export async function setAutoGoLive(on: boolean, terms: number): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    const { me } = admin;
    if (!autoGoLiveEnabled(me.organizationId)) return { ok: false, failure: 'unavailable' };
    if (on) {
      if (!me.ctx.plan.fullAuto) return { ok: false, failure: 'locked' };
      if (qualityPhase() < 1) return { ok: false, failure: 'quality_off' };
      if (terms !== GO_LIVE_TERMS) return { ok: false, failure: 'invalid' };
    }
    const { error } = await supabaseAdmin.from('chat_settings').upsert(
      {
        organization_id: me.organizationId,
        auto_go_live_groups: on ? [...GO_LIVE_GROUPS] : [],
        ...(on
          ? {
              auto_go_live_by: me.userId,
              auto_go_live_at: new Date().toISOString(),
              auto_go_live_terms: GO_LIVE_TERMS,
            }
          : {}),
        updated_by: me.userId,
      },
      { onConflict: 'organization_id' },
    );
    if (beforeGoLive(error)) return { ok: false, failure: 'unavailable' };
    return error ? { ok: false, failure: 'failed' } : { ok: true };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** The settings an Admin may change, read and checked; a failure otherwise. */
async function asAdmin(): Promise<{ ok: true; me: Who } | { ok: false; failure: SettingsFailure }> {
  const me = await who();
  if (!me) return { ok: false, failure: 'chat_off' };
  if (me.ctx.role !== 'admin') return { ok: false, failure: 'forbidden' };
  if (!me.ctx.plan.writable) return { ok: false, failure: 'read_only' };
  return { ok: true, me };
}

/** Writes the workspace's row with what changed, keeping the rest, and who changed it. */
async function saveSettings(me: Who, next: Partial<ChatSettings>): Promise<SettingsResult> {
  const settings = { ...me.ctx.settings, ...next };
  const { error } = await supabaseAdmin.from('chat_settings').upsert(
    {
      organization_id: me.organizationId,
      tool_policies: { ...settings.toolPolicies },
      full_auto_for_members: settings.fullAutoForMembers,
      dont_ask_again: settings.dontAskAgain,
      manager_execute_off: [...settings.managerExecuteOff],
      updated_by: me.userId,
    },
    { onConflict: 'organization_id' },
  );
  return error ? { ok: false, failure: 'failed' } : { ok: true };
}

/**
 * Sets a tool's policy, or `default` to give it back its row's default. Only
 * a choice the row offers and the plan allows.
 */
export async function setToolPolicy(
  key: string,
  policy: AdminPolicy | 'default',
): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    const tool = chatToolByKey(key);
    if (!tool) return { ok: false, failure: 'invalid' };
    const toolPolicies = { ...admin.me.ctx.settings.toolPolicies };
    if (policy === 'default') {
      delete toolPolicies[key];
    } else {
      if (!ADMIN_POLICIES.includes(policy) || !policyChoices(tool).includes(policy)) {
        return { ok: false, failure: 'invalid' };
      }
      if (policyChoiceLock(admin.me.ctx.plan, policy)) return { ok: false, failure: 'locked' };
      toolPolicies[key] = policy;
    }
    return await saveSettings(admin.me, { toolPolicies });
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Every tool back to its row's default. */
export async function resetToolPolicies(): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    return await saveSettings(admin.me, { toolPolicies: {} });
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Full auto for people other than Admins, or "Don't ask again" (both Growth and up). */
export async function setChatSwitch(
  name: 'fullAutoForMembers' | 'dontAskAgain',
  on: boolean,
): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    if (name !== 'fullAutoForMembers' && name !== 'dontAskAgain') {
      return { ok: false, failure: 'invalid' };
    }
    // Both are Growth and up (CHAT-20 §7): below it, neither applies.
    if (!admin.me.ctx.plan.fullAuto) return { ok: false, failure: 'locked' };
    return await saveSettings(admin.me, { [name]: on === true });
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Whether Managers may click through a go-live group (CHAT-20 §4). */
export async function setManagerExecute(
  group: ExecuteGroup,
  allowed: boolean,
): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    if (!EXECUTE_GROUPS.includes(group)) return { ok: false, failure: 'invalid' };
    const off = new Set(admin.me.ctx.settings.managerExecuteOff);
    if (allowed) off.delete(group);
    else off.add(group);
    // In the switches' order, as the column keeps them distinct.
    return await saveSettings(admin.me, {
      managerExecuteOff: EXECUTE_GROUPS.filter((g) => off.has(g)),
    });
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Removes one of the person's own "Don't ask again" ticks. */
export async function removeAutoChoice(key: string): Promise<SettingsResult> {
  try {
    const me = await who();
    if (!me) return { ok: false, failure: 'chat_off' };
    if (!/^[a-z][A-Za-z0-9]{1,63}$/.test(key)) return { ok: false, failure: 'invalid' };
    const { error } = await supabaseAdmin
      .from('chat_auto_choices')
      .delete()
      .eq('user_id', me.userId)
      .eq('organization_id', me.organizationId)
      .eq('tool_key', key);
    return error ? { ok: false, failure: 'failed' } : { ok: true };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}
