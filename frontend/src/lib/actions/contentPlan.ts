'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSuggestionSourceStates } from '@/lib/actions/integrations';
import { updateOpportunityStatus } from '@/lib/actions/content';
import type { PlanConversions } from '@/lib/content/conversions';
import type { CitedAddress, PlanResults } from '@/lib/content/planMix';
import { PLAN_PERIODS, type PlanPeriod } from '@/lib/content/plan';
import {
  OPEN_OPPORTUNITY_STATUSES,
  OPPORTUNITY_KEY,
  opportunityIdOf,
  readContentPlan,
  type ContentPlanRead,
} from '@/lib/content/planRead';
import { googleSourceStatus } from '@/lib/trafficSources';
import { assertWritable } from '@/lib/subscriptionGuard';

const planInput = z.object({
  brandId: z.guid(),
  days: z.union([
    z.literal(PLAN_PERIODS[0]),
    z.literal(PLAN_PERIODS[1]),
    z.literal(PLAN_PERIODS[2]),
  ]),
});

/**
 * What the Content plan (CE-014) is built from (readContentPlan), read
 * through the signed-in member's session.
 */
export async function getContentPlan(
  brandId: string,
  days: PlanPeriod,
): Promise<ContentPlanRead | null> {
  if (!planInput.safeParse({ brandId, days }).success) throw new Error('invalid');
  const supabase = await createClient();
  return readContentPlan(
    supabase,
    brandId,
    days,
    supabase.auth.getUser().then(({ data }) => data.user?.id ?? null),
  );
}

const markInput = z.object({
  brandId: z.guid(),
  rowKey: z.string().min(1).max(600),
});

/** A row key's opportunity, checked: 'invalid' for an opportunity key without a uuid. */
function checkedOpportunityId(rowKey: string): string | null {
  const id = opportunityIdOf(rowKey);
  if (id !== null && !z.guid().safeParse(id).success) throw new Error('invalid');
  return id;
}

/**
 * Mark a Plan row as a priority, or take the mark off (admins and managers;
 * content_plan_marks' policies refuse anyone else).
 */
export async function setPlanRowPriority(
  brandId: string,
  rowKey: string,
  priority: boolean,
): Promise<void> {
  await assertWritable({ brandId });
  if (!markInput.safeParse({ brandId, rowKey }).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('not_found');
  const { error } = await supabase.from('content_plan_marks').upsert(
    {
      brand_id: brandId,
      row_key: rowKey,
      priority,
      updated_by: user.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id,row_key' },
  );
  if (error) throw new Error(error.message);
}

/** How many opportunities one priority lookup covers: a page of the list. */
const MAX_PRIORITY_LOOKUPS = 200;

/**
 * Which of these opportunities' Plan rows are marked as a priority, for the
 * Opportunities list's Send to Plan: their ids. Ids that aren't ids are left
 * out; an empty list when the member can't read the brand's marks.
 */
export async function getPlanPriorities(
  brandId: string,
  opportunityIds: string[],
): Promise<string[]> {
  const keys = [...new Set(opportunityIds)]
    .filter((id) => z.guid().safeParse(id).success)
    .slice(0, MAX_PRIORITY_LOOKUPS)
    .map((id) => `${OPPORTUNITY_KEY}${id}`);
  if (!z.guid().safeParse(brandId).success || !keys.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_plan_marks')
    .select('row_key')
    .eq('brand_id', brandId)
    .eq('priority', true)
    .in('row_key', keys);
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => m.row_key.slice(OPPORTUNITY_KEY.length));
}

/**
 * Hide a Plan row until someone shows it again (admins and managers). An
 * opportunity's row dismisses the opportunity too, so the Opportunities page
 * agrees, and remembers the status it had for showing it again.
 */
export async function hidePlanRow(brandId: string, rowKey: string): Promise<void> {
  await assertWritable({ brandId });
  if (!markInput.safeParse({ brandId, rowKey }).success) throw new Error('invalid');
  const opportunityId = checkedOpportunityId(rowKey);
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('not_found');
  let restoreStatus: string | null = null;
  if (opportunityId) {
    const { data, error } = await supabase
      .from('content_opportunities')
      .select('status')
      .eq('id', opportunityId)
      .eq('brand_id', brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('not_found');
    restoreStatus = OPEN_OPPORTUNITY_STATUSES.includes(data.status) ? data.status : 'new';
  }
  // The mark first: one that isn't the member's to write stops here.
  const { error } = await supabase.from('content_plan_marks').upsert(
    {
      brand_id: brandId,
      row_key: rowKey,
      hidden_at: new Date().toISOString(),
      restore_status: restoreStatus,
      updated_by: user.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id,row_key' },
  );
  if (error) throw new Error(error.message);
  if (opportunityId) await updateOpportunityStatus(opportunityId, 'dismissed');
}

/**
 * Show a hidden Plan row again. An opportunity still dismissed gets back the
 * status it had; one completed or reopened elsewhere since keeps its status,
 * and only the mark goes.
 */
export async function showPlanRow(brandId: string, rowKey: string): Promise<void> {
  await assertWritable({ brandId });
  if (!markInput.safeParse({ brandId, rowKey }).success) throw new Error('invalid');
  const opportunityId = checkedOpportunityId(rowKey);
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('not_found');
  const { data: mark, error: readError } = await supabase
    .from('content_plan_marks')
    .select('restore_status')
    .eq('brand_id', brandId)
    .eq('row_key', rowKey)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!mark) throw new Error('not_found');
  const { data, error } = await supabase
    .from('content_plan_marks')
    .update({
      hidden_at: null,
      restore_status: null,
      updated_by: user.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('brand_id', brandId)
    .eq('row_key', rowKey)
    .select('row_key')
    .maybeSingle();
  if (error) throw new Error(error.message);
  // No row changed: not the member's to write.
  if (!data) throw new Error('not_found');
  if (!opportunityId) return;
  const { data: opportunity, error: statusError } = await supabase
    .from('content_opportunities')
    .select('status')
    .eq('id', opportunityId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (statusError) throw new Error(statusError.message);
  if (opportunity?.status === 'dismissed') {
    await updateOpportunityStatus(opportunityId, mark.restore_status ?? 'new');
  }
}

/**
 * What AI cites in the brand's tracked answers, and what AI visits brought
 * in, for the Plan's page-type mix and results strip (content_plan_insights,
 * 00221). Analytics counts as connected as AI Traffic says it is: the
 * property set, the connection live and data synced (googleSourceStatus).
 * Null outside the member's organization.
 */
export async function getContentPlanInsights(
  brandId: string,
  days: PlanPeriod,
): Promise<{
  citations: CitedAddress[];
  totalCitations: number;
  results: PlanResults;
  /** The snippet's conversions (CE-017, 00288): null when they couldn't be read. */
  conversions: PlanConversions | null;
} | null> {
  if (!planInput.safeParse({ brandId, days }).success) throw new Error('invalid');
  const supabase = await createClient();
  const [{ data, error }, gaConnected, conversions] = await Promise.all([
    supabase.rpc('content_plan_insights', { p_brand_id: brandId, p_days: days }),
    getSuggestionSourceStates(brandId).then(
      (states) => googleSourceStatus(states.ga) === 'connected',
      // The property alone decides then, as before.
      () => null,
    ),
    // Its own read: the strip goes on without it.
    Promise.resolve(supabase.rpc('brand_ai_conversions', { p_brand_id: brandId, p_days: days }))
      .then(({ data: read, error: readError }) => {
        if (readError) throw new Error(readError.message);
        return (read as PlanConversions | null) ?? null;
      })
      .catch((err) => {
        console.error('Failed to read the conversions from AI journeys:', err);
        return null;
      }),
  ]);
  if (error) throw new Error(error.message);
  if (!data) return null;
  const read = data as unknown as {
    totalCitations?: number;
    citations?: CitedAddress[];
    results?: Partial<PlanResults>;
  };
  const r = read.results ?? {};
  return {
    totalCitations: Number(read.totalCitations ?? 0),
    citations: (read.citations ?? []).map((c) => ({
      url: c.url,
      title: c.title ?? null,
      own: Boolean(c.own),
      citations: Number(c.citations ?? 0),
    })),
    results: {
      visits: Number(r.visits ?? 0),
      keyEvents: Number(r.keyEvents ?? 0),
      transactions: Number(r.transactions ?? 0),
      revenue: Number(r.revenue ?? 0),
      analytics: Boolean(r.analytics) && gaConnected !== false,
      purchases: Boolean(r.purchases),
    },
    conversions,
  };
}
