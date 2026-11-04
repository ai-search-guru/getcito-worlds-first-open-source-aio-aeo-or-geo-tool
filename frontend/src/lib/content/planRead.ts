import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readAssignees } from '@/lib/action-center/assignees';
import { memberLabel } from '@/lib/action-center/display';
import type { DraftMethod } from '@/lib/content/drafts';
import type {
  PlanAnswers,
  PlanDraft,
  PlanMark,
  PlanOpportunity,
  PlanPage,
  PlanPeriod,
  PlanTracking,
} from '@/lib/content/plan';
import { refreshYears } from '@/lib/content/currentYear';

/**
 * What the Content plan (CE-014) is built from: the brand's pages as AI cites
 * them (content_plan_pages, 00220), its open opportunities for its own pages,
 * the drafts still being written (with who their Action Center task is
 * assigned to), and the rows marked as a priority or hidden
 * (content_plan_marks, 00229). lib/content/plan.ts ranks them.
 *
 * Read through the client given: the signed-in member's session on the
 * Content plan page (getContentPlan), the service role for the MCP tool
 * get_content_plan, after its own check that the brand is the key's.
 */

/** Open opportunities, as New content offers them. */
export const OPEN_OPPORTUNITY_STATUSES = ['new', 'reviewed', 'sent', 'in_progress'];
const OPPORTUNITY_LIMIT = 200;
const DRAFT_LIMIT = 500;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const OPPORTUNITY_COLUMNS = 'id, title, decision, opportunity_score, brief, source_data';
export const OPPORTUNITY_KEY = 'opportunity:';
/**
 * The opportunity a row's key names (`opportunity:<id>`), or null for a
 * page's row. The server reads it from the key the mark is written under,
 * so a row's status change can't land on another opportunity.
 */
export function opportunityIdOf(rowKey: string): string | null {
  return rowKey.startsWith(OPPORTUNITY_KEY) ? rowKey.slice(OPPORTUNITY_KEY.length) : null;
}

export interface ContentPlanRead {
  pages: PlanPage[];
  answers: PlanAnswers;
  tracking: PlanTracking;
  opportunities: PlanOpportunity[];
  drafts: PlanDraft[];
  marks: PlanMark[];
}

/**
 * The plan's reads for a brand over `days`; null when the brand isn't the
 * reader's. `me` is who reads it, so their own drafts are marked as theirs.
 */
export async function readContentPlan(
  supabase: SupabaseClient,
  brandId: string,
  days: PlanPeriod,
  me: Promise<string | null>,
): Promise<ContentPlanRead | null> {
  const [userId, pagesRes, opportunitiesRes, draftsRes, marksRes] = await Promise.all([
    me,
    supabase.rpc('content_plan_pages', { p_brand_id: brandId, p_days: days }),
    supabase
      .from('content_opportunities')
      .select(OPPORTUNITY_COLUMNS)
      .eq('brand_id', brandId)
      .eq('type', 'owned')
      .in('status', OPEN_OPPORTUNITY_STATUSES)
      .order('opportunity_score', { ascending: false })
      .limit(OPPORTUNITY_LIMIT),
    supabase
      .from('content_drafts')
      .select('id, author, created_by, method, opportunity_id, source_url, action_id')
      .eq('brand_id', brandId)
      .in('status', ['draft', 'in_review', 'ready'])
      // An archived draft (00233) is set aside: the row starts afresh.
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(DRAFT_LIMIT),
    supabase
      .from('content_plan_marks')
      .select('row_key, priority, hidden_at')
      .eq('brand_id', brandId),
  ]);
  if (pagesRes.error) throw new Error(pagesRes.error.message);
  if (opportunitiesRes.error) throw new Error(opportunitiesRes.error.message);
  if (draftsRes.error) throw new Error(draftsRes.error.message);
  if (marksRes.error) throw new Error(marksRes.error.message);
  // Null: not the member's brand.
  if (!pagesRes.data) return null;

  const read = pagesRes.data as unknown as {
    pages?: PlanPage[];
    answers?: Partial<PlanAnswers>;
    prevFrom?: string;
    trackedSince?: string | null;
  };
  const answers = {
    cur: Number(read.answers?.cur ?? 0),
    prev: Number(read.answers?.prev ?? 0),
  };
  const tracking = {
    prevFrom: read.prevFrom ?? null,
    trackedSince: read.trackedSince ?? null,
  };
  const pages = (read.pages ?? []).map((p) => ({
    page: p.page,
    title: p.title ?? null,
    citations: { cur: Number(p.citations?.cur ?? 0), prev: Number(p.citations?.prev ?? 0) },
    platformsDown: Array.isArray(p.platformsDown) ? p.platformsDown : [],
    aiVisits: Number(p.aiVisits ?? 0),
    // Null with conversions off (00291), or from a database before it.
    conversions:
      p.conversions === null || p.conversions === undefined ? null : Number(p.conversions),
  }));

  const marks = (marksRes.data ?? []).map((m): PlanMark => ({
    rowKey: m.row_key,
    priority: m.priority,
    hidden: m.hidden_at !== null,
  }));
  // A hidden opportunity's row was dismissed with it: read it too, to show
  // again, while it is still dismissed (not completed or reopened since).
  const openIds = new Set((opportunitiesRes.data ?? []).map((o) => o.id));
  const hiddenIds = marks
    .filter((m) => m.hidden)
    .map((m) => opportunityIdOf(m.rowKey))
    .filter((id): id is string => id !== null && z.guid().safeParse(id).success)
    .filter((id) => !openIds.has(id));
  const hiddenRes = hiddenIds.length
    ? await supabase
        .from('content_opportunities')
        .select(OPPORTUNITY_COLUMNS)
        .eq('brand_id', brandId)
        .eq('status', 'dismissed')
        .in('id', hiddenIds)
    : { data: [], error: null };
  if (hiddenRes.error) throw new Error(hiddenRes.error.message);

  const opportunities = [...(opportunitiesRes.data ?? []), ...(hiddenRes.data ?? [])].map(
    (o): PlanOpportunity => {
      const sd = (o.source_data ?? {}) as Record<string, unknown>;
      const brief = (o.brief ?? null) as { suggestedTitle?: unknown } | null;
      const target = Array.isArray(sd.targetPages)
        ? (sd.targetPages as { url?: unknown; title?: unknown }[]).find((p) => text(p?.url))
        : undefined;
      return {
        id: o.id,
        // A past year in it reads as this year (currentYear.ts).
        title: refreshYears(o.title),
        pageTitle: text(brief?.suggestedTitle) || null,
        decision: o.decision,
        score: Number(o.opportunity_score ?? 0),
        targetPage: target ? text(target.url) : null,
        targetTitle: text(target?.title) || null,
        competitorsCited: Array.isArray(sd.competitorsCited)
          ? sd.competitorsCited.map(text).filter(Boolean).slice(0, 2)
          : [],
        visibility: typeof sd.visibilityScore === 'number' ? sd.visibilityScore : null,
        prompts: Array.isArray(sd.prompts) ? sd.prompts.length : 0,
        assetType: Array.isArray(sd.assets)
          ? text((sd.assets as { type?: unknown }[])[0]?.type) || null
          : null,
      };
    },
  );

  // Who each draft's Action Center task is assigned to.
  const actionIds = [
    ...new Set((draftsRes.data ?? []).map((d) => d.action_id).filter(Boolean)),
  ] as string[];
  const actionsRes = actionIds.length
    ? await supabase.from('actions').select('id, assignee_id').in('id', actionIds)
    : { data: [], error: null };
  if (actionsRes.error) throw new Error(actionsRes.error.message);
  const assigneeOf = new Map(
    (actionsRes.data ?? []).map((a) => [a.id as string, a.assignee_id as string | null]),
  );
  const people = await readAssignees(
    supabase,
    brandId,
    [...assigneeOf.values()].filter(Boolean) as string[],
  );

  const drafts = (draftsRes.data ?? []).map((d): PlanDraft => {
    const assigneeId = d.action_id ? (assigneeOf.get(d.action_id) ?? null) : null;
    const person = assigneeId ? people.get(assigneeId) : undefined;
    return {
      id: d.id,
      author: d.author === 'agent' ? 'agent' : 'user',
      isMine: userId !== null && d.created_by === userId,
      method: d.method as DraftMethod,
      opportunityId: d.opportunity_id,
      sourceUrl: d.source_url,
      actionId: d.action_id ?? null,
      assignee: person
        ? {
            id: person.id,
            name: memberLabel({ fullName: person.fullName, email: person.email ?? '' }),
          }
        : null,
    };
  });

  return { pages, answers, tracking, opportunities, drafts, marks };
}
