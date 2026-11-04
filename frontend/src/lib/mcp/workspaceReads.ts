import { allowedBrands, brandAccessFor, readMemberBrandAccess } from '@/lib/brandAccess';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberEmails } from '@/lib/memberEmails';
import { readPrecedenceContext } from '@/lib/chat/precedenceContext';
import { planCardOf } from '@/lib/chat/access';
import { NO_CONNECTION_ROWS, readConnectionRows } from '@/lib/chat/connectionRows';
import {
  CONNECTION_TOOLS,
  connectionRecords,
  connectionToolName,
  readSignIns,
  type ConnectionRecord,
} from '@/lib/chat/connections';
import { planFactsOf } from './chatFacts';
import { merchantCenterOffered } from './productVisibility';

/**
 * Chat's workspace reads (CHAT-20 §9 rows 5, 8, 9 and 10): the team, what
 * is connected, Chat's policy and the plan's facts, for the caller's
 * organization. Nothing secret leaves: e-mails for Admins only (§4a), only
 * the person's own API keys' names (as Settings › API Keys shows them), no
 * key, token or credential, no AI budget in dollars (DECISIONS R). Each
 * answers `data_as_of`; these are live, so it is now. Null without an
 * organization.
 */

const now = () => new Date().toISOString();

export async function listMembersFor(auth: McpAuthContext) {
  if (!auth.organizationId) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role')
    .eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const isAdmin = auth.role === 'admin';
  const [emails, access, brands] = await Promise.all([
    isAdmin ? readMemberEmails(rows.map((r) => r.id)) : null,
    readMemberBrandAccess(auth.organizationId),
    supabaseAdmin
      .from('brands')
      .select('id, name')
      .eq('organization_id', auth.organizationId)
      .eq('is_demo', false)
      .order('created_at', { ascending: true }),
  ]);
  if (brands.error) throw new Error(brands.error.message);
  const brandOrder = (brands.data ?? []) as { id: string; name: string }[];
  return {
    members: rows.map((row) => {
      const member = access.get(row.id);
      const isYou = row.id === auth.userId;
      const selected = member?.scope === 'selected';
      // As Settings › Roles & access shows it: which brands an admin shared
      // with someone is for admins and the person themselves to see.
      const shared = selected && (isAdmin || isYou) ? new Set(member.brandIds) : null;
      return {
        name: row.full_name?.trim() || null,
        role: row.role,
        brand_access: selected ? ('selected' as const) : ('all' as const),
        ...(shared
          ? { brands: brandOrder.filter((b) => shared.has(b.id)).map((b) => b.name) }
          : {}),
        is_you: isYou,
        ...(emails ? { email: emails.get(row.id) ?? null } : {}),
      };
    }),
    data_as_of: now(),
  };
}

/**
 * What is connected, per brand for the brands the person may use
 * (BRAND-ACCESS), from the one read the Connections page and the agents'
 * checks use too (lib/chat/connections.ts, W4-24): each brand's connected
 * tools with their account and access, the ones whose sign-in failed, and
 * the ones it could connect; the tools coming soon; the workspace's AI
 * provider keys (whether set, never the key) and the person's own API keys.
 */
export async function listConnectionsFor(auth: McpAuthContext) {
  if (!auth.organizationId) return null;
  const orgId = auth.organizationId;
  const [brands, aiKeys, access, keys, signIns, offered] = await Promise.all([
    supabaseAdmin.from('brands').select('id, name').eq('organization_id', orgId),
    supabaseAdmin
      .from('organization_ai_keys')
      .select('provider, active')
      .eq('organization_id', orgId),
    brandAccessFor(auth),
    // The person's own keys, as Settings › API Keys lists them: never a teammate's.
    supabaseAdmin
      .from('api_keys')
      .select('name, last_used_at')
      .eq('user_id', auth.userId)
      .is('revoked_at', null),
    readSignIns(orgId),
    merchantCenterOffered(),
  ]);
  for (const read of [brands, aiKeys, keys]) {
    if (read.error) throw new Error(read.error.message);
  }
  const brandRows = allowedBrands(access, brands.data ?? []);
  const rows = await readConnectionRows(brandRows.map((b) => b.id));
  const named = (list: ConnectionRecord[], status: ConnectionRecord['status']) =>
    list.filter((r) => r.status === status).map((r) => connectionToolName(r.key));
  return {
    brands: brandRows.map((b) => {
      const records = connectionRecords({
        rows: rows.get(b.id) ?? NO_CONNECTION_ROWS,
        signIns,
        merchantCenterOffered: offered,
      });
      return {
        brand: b.name,
        connected: records
          .filter((r) => r.status === 'connected')
          .map((r) => ({ tool: connectionToolName(r.key), account: r.account, access: r.access })),
        sign_in_failed: named(records, 'failing'),
        not_connected: named(records, 'not_connected'),
      };
    }),
    // Listed on the Connections page as Soon: nothing to connect yet.
    coming_soon: CONNECTION_TOOLS.filter((t) => !t.kind).map((t) => connectionToolName(t.key)),
    // The person's own keys and when they were used: never their values (§8b).
    your_api_keys: (keys.data ?? []).map((row) => ({
      name: row.name,
      last_used_at: row.last_used_at,
    })),
    ai_providers: (aiKeys.data ?? []).map((row) => ({
      provider: row.provider,
      active: row.active,
    })),
    data_as_of: now(),
  };
}

export async function getChatPolicyFor(auth: McpAuthContext) {
  if (!auth.organizationId) return null;
  const [ctx, row] = await Promise.all([
    readPrecedenceContext({
      userId: auth.userId,
      organizationId: auth.organizationId,
      mode: 'ask_first',
      surface: 'chat',
    }),
    supabaseAdmin
      .from('chat_settings')
      .select('updated_at')
      .eq('organization_id', auth.organizationId)
      .maybeSingle(),
  ]);
  if (row.error) throw new Error(row.error.message);
  if (!ctx) return null;
  return {
    role: ctx.role,
    // Full auto and "Don't ask again" need Growth and up (§7).
    full_auto_in_plan: ctx.plan.fullAuto,
    full_auto_for_members: ctx.settings.fullAutoForMembers,
    dont_ask_again: ctx.settings.dontAskAgain,
    manager_execute_off: [...ctx.settings.managerExecuteOff],
    // An Admin's policy per tool, by label key; a tool not named keeps its default.
    tool_policies: { ...ctx.settings.toolPolicies },
    your_auto_choices: [...ctx.autoChoices],
    data_as_of: row.data?.updated_at ?? null,
  };
}

/** The plan limits a person may read: counts, never a dollar budget. */
const LIMIT_KEYS = [
  'maxBrands',
  'maxPrompts',
  'maxPlatforms',
  'maxTeamMembers',
  'maxDomainsPerBrand',
  'maxSiteAudits',
  'maxOpportunitiesPerMonth',
] as const;

export async function getPlanFactsFor(auth: McpAuthContext) {
  if (!auth.organizationId) return null;
  const facts = await planFactsOf(auth.organizationId);
  return {
    plan_id: facts.planId,
    plan_name: facts.planName,
    self_hosted: facts.selfHosted,
    is_trial: facts.isTrial,
    writable: facts.writable,
    full_auto: facts.fullAuto,
    features: [...facts.features],
    // -1 means no limit.
    limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, facts.limits[key]])),
    card: planCardOf(facts),
    data_as_of: now(),
  };
}
