import type { McpAuthContext } from '@/lib/mcpAuth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import { getMinimumPlanForFeature } from '@/config/plans';
import { planFactsFromOrgRow } from '@/lib/chat/planFacts';
import { hrefWithFilters, routeById, type PlatformId, type RouteFilter } from '@/lib/chat/routes';

/**
 * Chat's open_page (CHAT-19 §2, CHAT-20 §9 row 1): a page of the app, with
 * the filters it keeps, as a link for the navigation card. Only pages the
 * workspace's plan opens, and only the plan's platforms as a filter. No
 * model and no AI usage: navigation is free. Null without an organization.
 */
export async function openPageFor(
  auth: McpAuthContext,
  params: { route: string; range?: string; platform?: PlatformId },
) {
  if (!auth.organizationId) return null;
  const route = routeById(params.route);
  if (!route) return { found: false as const };
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', auth.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const facts = planFactsFromOrgRow(data);
  const base = { found: true as const, title: route.name, section: route.section };
  if (route.requiredFeature && !facts.features.includes(route.requiredFeature)) {
    return {
      ...base,
      locked: true as const,
      needs: getMinimumPlanForFeature(route.requiredFeature),
    };
  }
  const allowed = facts.limits.allowedScrapers;
  const platformOff = !!params.platform && !!allowed && !allowed.includes(params.platform);
  const filters: Partial<Record<RouteFilter['key'], string>> = {
    range: params.range,
    platform: platformOff ? undefined : params.platform,
  };
  const { href, applied } = hrefWithFilters(route, filters);
  return {
    ...base,
    locked: false as const,
    href,
    filters: applied,
    // A platform the plan doesn't read isn't set; the card says nothing of it.
    ...(platformOff ? { platform_not_in_plan: params.platform } : {}),
    navigation_only: true as const,
  };
}
