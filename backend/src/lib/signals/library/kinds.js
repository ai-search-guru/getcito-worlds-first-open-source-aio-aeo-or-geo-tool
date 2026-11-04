/**
 * The signal kinds behind the V1 definition library (#818).
 *
 * Same shape as the original KIND_META in record.js — category, impact, the
 * KPIs the kind speaks to, and whether the condition persists — and merged
 * into it, so the recorder, the registry checks and the web treat them all
 * alike. Kept in their own file only because there are forty-five of them.
 *
 * Every kind here is read by exactly one definition. Several describe the
 * same data at different severities (a platform slipping versus a platform
 * collapsing), and those are separate kinds on purpose: the specification
 * gives them separate definitions with different work, and one kind feeding
 * two definitions would raise two actions for one condition.
 */

/**
 * Categories are the six the `signals.category` check constraint allows.
 * Anything else fails the insert — and one failed insert throws the whole
 * nightly pass for that brand, the shape of #829 and #834. So content gaps
 * file under `visibility` (a gap in what the brand is seen for) and audit
 * findings under `technical`, and a test pins the list to the constraint.
 */
export const SIGNAL_CATEGORIES = Object.freeze([
  'visibility',
  'citation',
  'mention',
  'traffic',
  'technical',
  'competitor',
]);

const meta = (category, impact, kpiKeys) =>
  Object.freeze({ category, impact, kpiKeys: Object.freeze(kpiKeys), persistent: true });

export const LIBRARY_KINDS = Object.freeze({
  // ── Prompts ───────────────────────────────────────────────────────────────
  prompt_visibility_gap: meta('visibility', 'medium', ['ai_visibility']),
  high_demand_gap: meta('visibility', 'high', ['ai_visibility']),
  uncovered_demand: meta('visibility', 'high', ['ai_visibility', 'citations']),
  prompt_unmapped: meta('visibility', 'medium', ['ai_visibility']),
  content_underperforming: meta('visibility', 'medium', ['ai_visibility', 'citations']),
  lost_mentions: meta('visibility', 'high', ['mentions', 'ai_visibility']),
  high_value_prompt_lost: meta('visibility', 'high', ['ai_visibility']),
  citation_at_risk: meta('citation', 'medium', ['citations']),

  // ── Topics ────────────────────────────────────────────────────────────────
  topic_gap: meta('visibility', 'medium', ['ai_visibility', 'share_of_voice']),
  topic_uncovered: meta('visibility', 'medium', ['ai_visibility', 'share_of_voice']),
  topic_slipping: meta('visibility', 'medium', ['share_of_voice']),
  topic_drop: meta('visibility', 'high', ['share_of_voice', 'ai_visibility']),

  // ── Platforms and regions ─────────────────────────────────────────────────
  platform_slipping: meta('visibility', 'medium', ['ai_visibility']),
  platform_drop: meta('visibility', 'high', ['ai_visibility']),
  country_gap: meta('visibility', 'medium', ['ai_visibility']),

  // ── Competitors ───────────────────────────────────────────────────────────
  competitor_leads: meta('competitor', 'high', ['share_of_voice', 'ai_visibility']),
  competitor_momentum: meta('competitor', 'medium', ['share_of_voice']),
  competitor_topic_lead: meta('competitor', 'medium', ['share_of_voice']),
  competitor_high_value_lead: meta('competitor', 'high', ['share_of_voice', 'ai_visibility']),
  competitor_uncovered_topic: meta('competitor', 'medium', ['share_of_voice']),

  // ── Citation sources ──────────────────────────────────────────────────────
  authority_citation_gap: meta('citation', 'medium', ['citations']),
  third_party_citation_gap: meta('citation', 'medium', ['citations']),
  third_party_presence_gap: meta('citation', 'medium', ['mentions', 'citations']),
  competitor_cited_source: meta('competitor', 'medium', ['citations', 'share_of_voice']),
  competitor_winning_source: meta('competitor', 'medium', ['mentions', 'share_of_voice']),

  // ── Owned pages ───────────────────────────────────────────────────────────
  page_citation_slipping: meta('citation', 'medium', ['citations']),
  owned_page_citation_lost: meta('citation', 'high', ['citations']),

  // ── Query fan-outs ────────────────────────────────────────────────────────
  fanout_gap: meta('visibility', 'medium', ['ai_visibility']),
  competitor_fanout_gap: meta('competitor', 'medium', ['share_of_voice']),

  // ── Search Console ────────────────────────────────────────────────────────
  gsc_demand_gap: meta('visibility', 'medium', ['ai_visibility']),
  search_ai_misalignment: meta('visibility', 'medium', ['ai_visibility']),
  gsc_low_ctr: meta('traffic', 'medium', ['ai_visibility']),
  gsc_risk: meta('traffic', 'medium', ['ai_visibility']),
  gsc_decline: meta('traffic', 'high', ['ai_visibility']),

  // ── AI traffic ────────────────────────────────────────────────────────────
  ai_traffic_slipping: meta('traffic', 'medium', ['ai_referral_traffic']),
  ai_traffic_drop: meta('traffic', 'high', ['ai_referral_traffic']),
  ai_landing_page_winner: meta('traffic', 'medium', ['ai_referral_traffic']),
  ai_landing_underperforming: meta('traffic', 'medium', ['ai_referral_traffic']),
  converting_page_slipping: meta('traffic', 'high', ['ai_referral_traffic']),
  cross_channel_risk: meta('traffic', 'high', ['ai_referral_traffic']),
  visibility_traffic_loss: meta('traffic', 'high', ['ai_referral_traffic', 'ai_visibility']),
  // AI Traffic Analytics' alerts (AT-013, spec §3.8): the week-over-week drop,
  // the pages AI visitors landed on that don't exist (AT-012), and the cited
  // pages no AI search bot read in 30 days (AT-011).
  ai_visits_weekly_drop: meta('traffic', 'high', ['ai_referral_traffic']),
  broken_citation_target: meta('technical', 'high', ['ai_referral_traffic', 'citations']),
  cited_page_uncrawled: meta('technical', 'medium', ['citations']),

  // ── Site Audit findings ───────────────────────────────────────────────────
  crawler_blocked: meta('technical', 'high', []),
  structured_data_issue: meta('technical', 'medium', []),
  outdated_content: meta('technical', 'medium', ['ai_visibility']),
  weak_entity: meta('technical', 'medium', ['mentions']),
  weak_internal_links: meta('technical', 'low', []),
  content_gap: meta('technical', 'medium', ['ai_visibility']),
});

/**
 * Kinds one classifier chooses between for the same subject — a topic is
 * uncovered or slipping or dropped, never two at once. When tonight's pass
 * files a subject under a different kind of its group, the old signal did not
 * end: it changed. The recorder closes it as superseded rather than resolved.
 *
 * Only groups that are exclusive by construction belong here. A competitor
 * can lead and gain at the same time; those stay independent.
 */
export const EXCLUSIVE_KIND_GROUPS = Object.freeze([
  Object.freeze(['topic_gap', 'topic_uncovered', 'topic_slipping', 'topic_drop']),
  Object.freeze(['platform_slipping', 'platform_drop']),
  Object.freeze([
    'competitor_winning_source',
    'competitor_cited_source',
    'third_party_presence_gap',
    'authority_citation_gap',
    'third_party_citation_gap',
  ]),
  Object.freeze(['page_citation_slipping', 'owned_page_citation_lost']),
]);
