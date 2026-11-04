/**
 * The action registry — what this build knows how to present.
 *
 * Same division of labor as signals, with one asymmetry worth naming: the
 * server's definition registry (backend/src/lib/action-center/definitions) is
 * the source of truth for which actions EXIST, and it is meant to grow
 * without this file following. So the list below is not a contract — it is
 * the set of kinds we have written copy and an icon for. Anything the server
 * raises that is not here still reaches the user, presented from its
 * category and its id; see lib/action-center/display.ts.
 *
 * Dropping a kind from this list therefore degrades an action; it never
 * hides one.
 */

export type ActionCategory = 'growth' | 'protect' | 'recover' | 'fix' | 'compete';

export type ActionImpact = 'high' | 'medium' | 'low';

/** Was the work done? Execution only — see ActionOutcome for whether it helped. */
export type ActionStatus = 'new' | 'in_progress' | 'on_hold' | 'completed' | 'dismissed';

/**
 * Did the work help?
 *
 * Kept apart from ActionStatus on purpose: an action is completed by someone
 * finishing it, and measured afterwards by something re-reading its metrics.
 * `no_improvement` used to live in the status column, which made the two
 * questions unanswerable for an action that was completed but never measured
 * — today, every one of them.
 */
export type ActionOutcome =
  | 'pending_measurement'
  | 'improved'
  // One metric up and another down, or a fix's pages only partly passing (learning A4).
  | 'mixed'
  | 'no_meaningful_change'
  | 'declined'
  | 'not_measurable';

/** A kind this build has copy for — the V1 library's sixty-two definitions, plus
 *  the kinds a person sends from another page. */
export type ActionKind =
  | 'capture_ai_traffic'
  | 'convert_mentions'
  | 'expand_prompt_visibility'
  | 'capture_high_demand_prompts'
  | 'expand_topic_visibility'
  | 'capture_fanout_opportunities'
  | 'increase_authority_citations'
  | 'expand_platform_visibility'
  | 'expand_country_visibility'
  | 'strengthen_emerging_content'
  | 'expand_brand_associations'
  | 'convert_search_demand'
  | 'expand_organic_pages'
  | 'scale_ai_landing_pages'
  | 'create_content_for_demand'
  | 'create_content_for_topics'
  | 'optimize_content_for_ai'
  | 'earn_third_party_presence'
  | 'earn_third_party_citations'
  | 'protect_visibility'
  | 'protect_valuable_citations'
  | 'protect_ai_traffic_pages'
  | 'defend_competitor_gains'
  | 'protect_topic_leadership'
  | 'protect_high_performing_content'
  | 'protect_platform_visibility'
  | 'protect_organic_on_ai_pages'
  | 'protect_search_and_ai_assets'
  | 'protect_converting_ai_pages'
  | 'recover_visibility'
  | 'recover_lost_citations'
  | 'recover_ai_traffic'
  | 'recover_lost_mentions'
  | 'recover_topic_visibility'
  | 'recover_platform_visibility'
  | 'recover_after_competitor_gains'
  | 'recover_cited_pages'
  | 'recover_high_value_prompts'
  | 'recover_search_performance'
  | 'recover_traffic_after_visibility_loss'
  | 'fix_low_scores'
  | 'fix_crawler_access'
  | 'fix_structured_data'
  | 'fix_content_gaps'
  | 'fix_outdated_content'
  | 'fix_entity_signals'
  | 'fix_broken_citation_targets'
  | 'fix_brand_inconsistency'
  | 'fix_underperforming_ai_landing_pages'
  | 'fix_internal_connectivity'
  | 'fix_prompt_content_coverage'
  | 'improve_low_ctr_pages'
  | 'align_search_and_ai_content'
  | 'close_competitor_gap'
  | 'close_citation_gap'
  | 'capture_competitor_cited_sources'
  | 'close_topic_coverage_gap'
  | 'compete_on_high_value_prompts'
  | 'capture_competitor_fanouts'
  | 'respond_to_competitor_momentum'
  | 'earn_competitor_source_presence'
  | 'create_content_for_competitor_gaps'
  // Sent by a person from a content opportunity, not raised by a definition.
  | 'content_opportunity'
  // Sent by a person from the Prompts Positions panel's Improve tab (PROMPT-004).
  | 'prompt_improve'
  // Sent by a person from Insights' Topics vs competitors (VIS-010).
  | 'topic_competitor_gap'
  // Sent by a person from an Insights Opportunities topic (VIS-011).
  | 'topic_opportunity'
  // Sent by a person from answers on the Mentions tab (MS-08).
  | 'mention_review'
  // Sent by a person from AI Traffic's Pages section (AT-006).
  | 'traffic_pages'
  // Sent by a person from a Site Audit report (learning D2).
  | 'audit_page'
  // Sent by a person from the Content Editor's Start, as Team (CE-015).
  | 'content_draft'
  // Sent by a person from Product Visibility: a product, or a catalog category (ECOM-013).
  | 'shopping_product'
  | 'shopping_category'
  // Raised by the catalog check for a live page linking products that no
  // longer sell (shopping path, part 7), and closed by it once fixed.
  | 'shopping_links'
  // Sent by a person from Chat: a finding and its tasks, as approved (CHAT-09 §E).
  | 'chat_finding';

export type TaskStatus =
  'todo' | 'in_progress' | 'waiting_approval' | 'completed' | 'skipped' | 'failed';

export const ACTION_CATEGORIES: readonly ActionCategory[] = [
  'growth',
  'protect',
  'recover',
  'fix',
  'compete',
];

export const ACTION_STATUSES: readonly ActionStatus[] = [
  'new',
  'in_progress',
  'on_hold',
  'completed',
  'dismissed',
];

/** Statuses of an action still to be worked on. */
export const OPEN_ACTION_STATUSES: readonly ActionStatus[] = ['new', 'in_progress', 'on_hold'];

export const ACTION_OUTCOMES: readonly ActionOutcome[] = [
  'pending_measurement',
  'improved',
  'mixed',
  'no_meaningful_change',
  'declined',
  'not_measurable',
];

/**
 * Why an action was dismissed, as the person says it (00366, learning A5):
 * it doesn't matter to the brand, the work is already done, the data behind
 * it is wrong, or not now.
 */
export const ACTION_DISMISS_REASONS = [
  'not_relevant',
  'already_done',
  'wrong_data',
  'not_now',
] as const;
export type ActionDismissReason = (typeof ACTION_DISMISS_REASONS)[number];

/** A stored dismiss reason, if it is one of ACTION_DISMISS_REASONS; null otherwise. */
export function dismissReasonOf(value: unknown): ActionDismissReason | null {
  return (ACTION_DISMISS_REASONS as readonly unknown[]).includes(value)
    ? (value as ActionDismissReason)
    : null;
}

/**
 * The error a database without 00366 gives for naming dismiss_reason:
 * PGRST204 from PostgREST's schema cache on a write, 42703 from Postgres.
 * Only that one, so a missing column of any other name still fails.
 */
export function missingDismissReason(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    (error?.code === 'PGRST204' || error?.code === '42703') &&
    (error.message ?? '').includes('dismiss_reason')
  );
}

/** An action whose cycle is over: it is history, and its kind's slot is free. */
export const CLOSED_ACTION_STATUSES: readonly ActionStatus[] = ['completed', 'dismissed'];

export const TASK_STATUSES: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'waiting_approval',
  'completed',
  'skipped',
  'failed',
];

/** Statuses that leave the progress denominator — the work is not outstanding. */
export const UNCOUNTED_TASK_STATUSES: readonly TaskStatus[] = ['skipped', 'failed'];

/**
 * An action's task progress, as the list's "n/m tasks" and the drawer's
 * Tasks tab show it. Skipped and failed tasks leave the denominator: neither
 * is outstanding work, so neither should hold an action below 100% for good.
 */
export function taskProgress(statuses: readonly string[]): { total: number; completed: number } {
  const counted = statuses.filter(
    (status) => !(UNCOUNTED_TASK_STATUSES as readonly string[]).includes(status),
  );
  return {
    total: counted.length,
    completed: counted.filter((status) => status === 'completed').length,
  };
}

export const ACTION_KINDS: readonly ActionKind[] = [
  'capture_ai_traffic',
  'convert_mentions',
  'expand_prompt_visibility',
  'capture_high_demand_prompts',
  'expand_topic_visibility',
  'capture_fanout_opportunities',
  'increase_authority_citations',
  'expand_platform_visibility',
  'expand_country_visibility',
  'strengthen_emerging_content',
  'expand_brand_associations',
  'convert_search_demand',
  'expand_organic_pages',
  'scale_ai_landing_pages',
  'create_content_for_demand',
  'create_content_for_topics',
  'optimize_content_for_ai',
  'earn_third_party_presence',
  'earn_third_party_citations',
  'protect_visibility',
  'protect_valuable_citations',
  'protect_ai_traffic_pages',
  'defend_competitor_gains',
  'protect_topic_leadership',
  'protect_high_performing_content',
  'protect_platform_visibility',
  'protect_organic_on_ai_pages',
  'protect_search_and_ai_assets',
  'protect_converting_ai_pages',
  'recover_visibility',
  'recover_lost_citations',
  'recover_ai_traffic',
  'recover_lost_mentions',
  'recover_topic_visibility',
  'recover_platform_visibility',
  'recover_after_competitor_gains',
  'recover_cited_pages',
  'recover_high_value_prompts',
  'recover_search_performance',
  'recover_traffic_after_visibility_loss',
  'fix_low_scores',
  'fix_crawler_access',
  'fix_structured_data',
  'fix_content_gaps',
  'fix_outdated_content',
  'fix_entity_signals',
  'fix_broken_citation_targets',
  'fix_brand_inconsistency',
  'fix_underperforming_ai_landing_pages',
  'fix_internal_connectivity',
  'fix_prompt_content_coverage',
  'improve_low_ctr_pages',
  'align_search_and_ai_content',
  'close_competitor_gap',
  'close_citation_gap',
  'capture_competitor_cited_sources',
  'close_topic_coverage_gap',
  'compete_on_high_value_prompts',
  'capture_competitor_fanouts',
  'respond_to_competitor_momentum',
  'earn_competitor_source_presence',
  'create_content_for_competitor_gaps',
  'content_opportunity',
  'prompt_improve',
  'topic_competitor_gap',
  'topic_opportunity',
  'mention_review',
  'traffic_pages',
  'audit_page',
  'content_draft',
  'shopping_product',
  'shopping_category',
  'shopping_links',
  'chat_finding',
];

/**
 * The kinds sent from Product Visibility (ECOM-013): a product or a
 * category. The Actions page's "From Products" chip lists them.
 */
export const FROM_PRODUCTS_KINDS: readonly string[] = ['shopping_product', 'shopping_category'];

/**
 * Is this one of the kinds we have copy for?
 *
 * A guard, not a filter. Callers use it to choose between the written
 * presentation and the generic one — never to decide whether a row is real.
 */
export function isActionKind(value: string): value is ActionKind {
  return (ACTION_KINDS as readonly string[]).includes(value);
}

/**
 * Sort orders the toolbar offers. Priority is the server's score (AC-006),
 * which already weighs impact in, so impact is not an order of its own.
 */
export type ActionSort = 'priority' | 'newest' | 'due_date' | 'updated';
export const ACTION_SORTS: readonly ActionSort[] = ['priority', 'newest', 'due_date', 'updated'];
