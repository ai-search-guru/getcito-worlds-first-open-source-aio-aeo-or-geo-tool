import type { McpAuthContext } from '@/lib/mcpAuth';
import { MAX_SHOWN, readWhatsNew } from '@/lib/chat/whats-new/reads';

/**
 * Chat's get_whats_new (CHAT-11 §C, CHAT-20 §9 row 3; W4-20): What's new
 * for the person's plan, the entry they named first, then the unread, then
 * the newest; never brand data. The team's words as written: no price,
 * the plans by Billing's names. No model, no AI usage. Null without an
 * organization.
 */
export async function getWhatsNewFor(
  auth: McpAuthContext,
  params: { feature?: string; shown?: readonly string[]; limit?: number },
) {
  if (!auth.organizationId) return null;
  const read = await readWhatsNew({
    userId: auth.userId,
    organizationId: auth.organizationId,
    feature: params.feature,
    shown: params.shown,
    limit: Math.min(params.limit ?? MAX_SHOWN, MAX_SHOWN),
  });
  return {
    plan: read.planName,
    updates: read.items.map((item) => ({
      feature: item.feature,
      lines: item.lines,
      try_it: item.route,
      // Not on the person's plan: the plans that include it.
      ...(item.onPlans ? { on_plans: item.onPlans } : {}),
      published: item.published,
      new_for_you: !item.read,
    })),
    older_updates: read.more,
    data_as_of: new Date().toISOString(),
  };
}
