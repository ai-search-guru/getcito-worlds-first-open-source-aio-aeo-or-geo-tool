'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberAuth } from '@/lib/memberEmails';
import { readMemberBrandAccess, type MemberBrandAccess } from '@/lib/brandAccess';
import type { TeamRole } from '@/components/context/RoleProvider';
import type { PlanId } from '@/config/plans';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { readPrecedenceContext } from '@/lib/chat/precedenceContext';
import { parseTeamRole } from '@/lib/chat/precedence';
import type { ExecuteGroup } from '@/lib/chat/registry/defineTool';
import { planCardOf, yourAccessRows, type PlanCard, type YourAccessRow } from '@/lib/chat/access';
import { planGateLock } from '@/lib/chat/planFacts';
import { registryCatalog } from '@/lib/chat/registry/tools';

/**
 * What Settings › Team › Roles & access and Settings › Account › Your access
 * show (CHAT-20 §4a, §4b, §7a), read with the same facts the approval
 * precedence checks a tool call by, so a page and the server never
 * disagree. Null while the new Chat is off for the workspace (CHAT_AGENTIC):
 * the pages show nothing new.
 */

/**
 * A person's brands as the access pages show them (BRAND-ACCESS §3.2): All
 * brands, or Selected brands with their names, oldest first. `names` is null
 * where the viewer may not see them: someone else's, to anyone but an admin.
 */
export interface MemberBrands {
  scope: 'all' | 'selected';
  names: string[] | null;
}

export interface ChatAccess {
  role: TeamRole;
  /** The person's own brands (Your access). */
  brands: MemberBrands;
  /** Null off the cloud: no plan. */
  plan: PlanCard | null;
  yourAccess: YourAccessRow[];
  /** The workspace switches that change a role's rights (Settings › Chat, 00401). */
  switches: {
    managerExecuteOff: ExecuteGroup[];
    fullAutoForMembers: boolean;
    /** The plan Full auto needs, when the workspace's doesn't have it. */
    fullAutoLocked: PlanId | null;
    /** Who changed them last; null when no one has. */
    setBy: string | null;
  };
  /** The plan each tool needs that the workspace doesn't have, by catalog key (§7a lock lines). */
  toolLocks: Record<string, PlanId>;
}

export interface RoleMember {
  userId: string;
  name: string;
  /** Admins only (§4a). */
  email: string | null;
  role: TeamRole;
  /** The last sign-in; null when never. */
  lastActiveAt: string | null;
  isYou: boolean;
  brands: MemberBrands;
}

/**
 * Every member's brands in the organization, and how to name them: the
 * brands shared with Selected-brands people (the demo brand, which everyone
 * sees, isn't one of them).
 */
async function readBrandsView(organizationId: string): Promise<{
  access: Map<string, MemberBrandAccess>;
  brandsOf: (userId: string, withNames: boolean) => MemberBrands;
}> {
  const [access, brands] = await Promise.all([
    readMemberBrandAccess(organizationId),
    supabaseAdmin
      .from('brands')
      .select('id, name')
      .eq('organization_id', organizationId)
      .eq('is_demo', false)
      .order('created_at', { ascending: true }),
  ]);
  if (brands.error) throw new Error(brands.error.message);
  const order = (brands.data ?? []) as { id: string; name: string }[];
  return {
    access,
    brandsOf: (userId, withNames) => {
      const member = access.get(userId);
      if (!member || member.scope === 'all') return { scope: 'all', names: [] };
      if (!withNames) return { scope: 'selected', names: null };
      const shared = new Set(member.brandIds);
      return {
        scope: 'selected',
        names: order.filter((brand) => shared.has(brand.id)).map((brand) => brand.name),
      };
    },
  };
}

async function viewer(): Promise<{ userId: string; organizationId: string } | null> {
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
  return { userId: user.id, organizationId };
}

/** Why a read gave nothing: Chat is off for the person, or the database didn't answer. */
export type AccessReadFailure = 'chat_off' | 'failed';

/**
 * The signed-in person's access and plan card. Never throws (#1777): a
 * failed read is `failed`, Chat off for them `chat_off`.
 */
export async function getChatAccess(): Promise<
  { ok: true; access: ChatAccess } | { ok: false; failure: AccessReadFailure }
> {
  try {
    const access = await readChatAccess();
    return access ? { ok: true, access } : { ok: false, failure: 'chat_off' };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

async function readChatAccess(): Promise<ChatAccess | null> {
  const who = await viewer();
  if (!who) return null;
  const [ctx, settings, brandsView] = await Promise.all([
    readPrecedenceContext({ ...who, mode: 'ask_first', surface: 'chat' }),
    supabaseAdmin
      .from('chat_settings')
      .select('updated_by')
      .eq('organization_id', who.organizationId)
      .maybeSingle(),
    readBrandsView(who.organizationId),
  ]);
  if (!ctx) return null;
  const setById = settings.data?.updated_by ?? null;
  const setBy = setById
    ? await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', setById)
        .eq('organization_id', who.organizationId)
        .maybeSingle()
        .then(({ data }) => data?.full_name?.trim() || null)
    : null;
  return {
    role: ctx.role,
    brands: brandsView.brandsOf(who.userId, true),
    plan: planCardOf(ctx.plan),
    yourAccess: yourAccessRows(ctx.role, ctx.settings.managerExecuteOff),
    switches: {
      managerExecuteOff: [...ctx.settings.managerExecuteOff],
      fullAutoForMembers: ctx.settings.fullAutoForMembers,
      fullAutoLocked: ctx.plan.fullAuto ? null : 'growth',
      setBy,
    },
    toolLocks: Object.fromEntries(
      registryCatalog().flatMap((entry) => {
        const lock = planGateLock(ctx.plan, entry.planGate);
        return lock ? [[entry.key, lock]] : [];
      }),
    ),
  };
}

/**
 * The workspace's members for Roles & access: name, role and last sign-in
 * for everyone, e-mails for Admins only (§4a). A member without a name goes
 * by the part of their e-mail before the @. Never throws, as above.
 */
export async function listRoleMembers(): Promise<
  { ok: true; members: RoleMember[] } | { ok: false; failure: AccessReadFailure }
> {
  try {
    const members = await readRoleMembers();
    return members ? { ok: true, members } : { ok: false, failure: 'chat_off' };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

async function readRoleMembers(): Promise<RoleMember[] | null> {
  const who = await viewer();
  if (!who) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, created_at')
    .eq('organization_id', who.organizationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const viewerRole = parseTeamRole(rows.find((row) => row.id === who.userId)?.role);
  const [auth, brandsView] = await Promise.all([
    readMemberAuth(rows.map((row) => row.id)),
    readBrandsView(who.organizationId),
  ]);
  return rows.flatMap((row) => {
    const role = parseTeamRole(row.role);
    if (!role) return [];
    const email = auth.get(row.id)?.email ?? null;
    return [
      {
        userId: row.id,
        name: row.full_name?.trim() || email?.split('@')[0] || '',
        email: viewerRole === 'admin' ? email : null,
        role,
        lastActiveAt: auth.get(row.id)?.lastSignInAt ?? null,
        isYou: row.id === who.userId,
        // Which brands an admin shared with someone is the admins' to see.
        brands: brandsView.brandsOf(row.id, viewerRole === 'admin' || row.id === who.userId),
      },
    ];
  });
}
