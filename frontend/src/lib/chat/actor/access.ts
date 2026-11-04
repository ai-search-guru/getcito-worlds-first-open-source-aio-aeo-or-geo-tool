import { isCloud, isSubscriptionActive } from '@/config/plans';
import { canAccessBrand } from '@/lib/brandAccess';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { MANAGER_ROLES } from '@/lib/mcp/roleGate';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DemoBrandError, SubscriptionInactiveError } from '@/lib/subscriptionGuard';

/**
 * What a Chat run with no session behind it (a schedule's or a signal's
 * run, CHAT-12) checks before it writes as its person: the checks the
 * person's session gets from row-level security and from the server action
 * it calls (assertWritable, isManager), asked about them with the service
 * role, as MCP asks about an API key's user. Each reads fresh, so a role, a
 * plan or a brand taken away mid-run counts from the next write. Server only.
 */

/** The person a run acts for, in the workspace it runs in (the engine's tool context). */
export interface RunActor {
  userId: string;
  organizationId: string;
}

/** The run's person from a tool's context; a context with no workspace has none. */
export function actorOf(ctx: Pick<McpAuthContext, 'userId' | 'organizationId'>): RunActor {
  if (!ctx.organizationId) throw new Error('A run acts for a person in a workspace');
  return { userId: ctx.userId, organizationId: ctx.organizationId };
}

/**
 * Whether the person may see the brand now (BRAND-ACCESS, 00388
 * can_access_brand): a brand of the run's workspace, which they are still in,
 * and they are an Admin, have All brands, have it shared, or it is the demo
 * brand. A brand of another workspace, or one they left, is not theirs.
 * The web's one rule (lib/brandAccess.ts).
 */
export async function canAccessBrandFor(actor: RunActor, brandId: string): Promise<boolean> {
  return canAccessBrand(actor.userId, brandId, actor.organizationId);
}

/**
 * Whether the person is an Admin or a Manager of the organization now, as
 * isManager asks of the session: their live role, in that organization,
 * which has to be the run's.
 */
export async function isManagerFor(actor: RunActor, organizationId: string): Promise<boolean> {
  if (organizationId !== actor.organizationId) return false;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', actor.userId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return MANAGER_ROLES.some((role) => role === data?.role);
}

/**
 * Refuse a write on the brand as assertWritable refuses the session's: the
 * demo brand (DemoBrandError), and on the cloud a workspace whose plan isn't
 * active, its trial over or canceled (SubscriptionInactiveError); a plan or
 * brand that can't be read refuses too, and a brand that isn't the run's
 * workspace's ('not_found'). The demo brand is refused off the
 * cloud as well: a session's write there meets the database's demo guard
 * (00381), which the service role passes. Whether the person may see the
 * brand is canAccessBrandFor's: call both.
 */
export async function assertWritableFor(actor: RunActor, brandId: string): Promise<void> {
  const [brand, org] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('is_demo')
      .eq('id', brandId)
      .eq('organization_id', actor.organizationId)
      .maybeSingle(),
    isCloud()
      ? supabaseAdmin
          .from('organizations')
          .select('subscription_status')
          .eq('id', actor.organizationId)
          .maybeSingle()
      : null,
  ]);
  if (brand.error) throw new Error(`Could not read the brand: ${brand.error.message}`);
  // Not the run's workspace's brand: nothing to write, and nothing said about it (its demo flag).
  if (!brand.data) throw new Error('not_found');
  if (brand.data.is_demo) throw new DemoBrandError();
  if (!org) return;
  if (org.error) throw new Error(`Could not read the workspace's plan: ${org.error.message}`);
  if (!isSubscriptionActive(org.data?.subscription_status)) throw new SubscriptionInactiveError();
}
