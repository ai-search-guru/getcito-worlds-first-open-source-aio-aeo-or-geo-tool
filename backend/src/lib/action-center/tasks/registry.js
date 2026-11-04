/**
 * The task registry (#818).
 *
 * The shared Task Library of the V1 specification: sixty-two primitives with
 * stable ids, which every definition builds its plan from, and one added
 * since (learning C4's analyze_winning_pages). An action tells the
 * user what to achieve; its tasks say how, and a task is one of these.
 *
 * Each primitive declares, in the specification's terms:
 *
 *  - `mode` — SYSTEM (a deterministic comparison GetCito does), AGENT,
 *    HUMAN, or HUMAN_OR_AGENT (either, depending on the tools connected);
 *  - `permission` — READ, WRITE (changes the brand's own content) or EXECUTE
 *    (acts externally: publishing, sending outreach). WRITE and EXECUTE need a
 *    person's approval unless the workspace authorises autonomy;
 *  - `requires` — sources the brand must have for the task to be planned.
 *    Missing optional data removes a task, never the action (spec §7);
 *  - `dependsOn` — what must finish first (spec §10). The planner drops a
 *    dependency on a task that is not in the plan;
 *  - `outputs` — the structured result, so the next task can read it (§12);
 *  - `tool` — the tool that carries it out automatically, where one exists.
 *
 * Every primitive's user-facing text lives in i18n as `<id>` and, naming what
 * it acts on, `<id>_target` ("Analyze citations across 11 sources"). Internal
 * ids are never shown (spec §11).
 *
 * The twenty-three `legacy` entries are the tasks actions were given before
 * the library existed. They stay so those rows still render and still run;
 * no definition may plan them.
 */

/** A brand source, as resolved by action-center/sources.js. */
const SOURCES = [
  'tracking',
  'competitors',
  'site_audits',
  'analytics',
  'search_console',
  'volumes',
  'ai_traffic',
  'topics',
];

export const MODES = Object.freeze(['system', 'agent', 'human', 'human_or_agent']);
export const PERMISSIONS = Object.freeze(['read', 'write', 'execute']);

/** Modes the runner may carry out without a person. */
export const AUTOMATABLE_MODES = Object.freeze(['system', 'agent', 'human_or_agent']);

/** Permissions that need a person's approval before anything is done. */
export const APPROVAL_PERMISSIONS = Object.freeze(['write', 'execute']);

const task = (id, spec) =>
  Object.freeze({
    id,
    version: 1,
    mode: 'human',
    permission: 'read',
    legacy: false,
    ...spec,
    requires: Object.freeze(spec.requires ?? []),
    dependsOn: Object.freeze(spec.dependsOn ?? []),
    outputs: Object.freeze(spec.outputs ?? []),
    /** Payload keys the `_target` message names. Library tasks all name their
     *  targets as a count and an entity — "11 prompts", "6 sources". */
    titleKeys: Object.freeze(spec.titleKeys ?? (spec.legacy ? [] : ['count', 'entity'])),
    tool: spec.tool ?? null,
  });

/** Every execution step a validation can wait on. The planner keeps only the
 *  ones actually in a plan. */
const EXECUTION = [
  'optimize_content',
  'refresh_content',
  'create_content_draft',
  'strengthen_reference_asset',
  'strengthen_entity_content',
  'add_internal_links',
  'improve_cta_path',
  'publish_content',
  'fix_crawler_access',
  'fix_structured_data',
  'fix_broken_target',
  'fix_technical_issue',
  'execute_outreach',
];

const VALIDATIONS = [
  'validate_ai_visibility',
  'validate_mentions',
  'validate_citations',
  'validate_topic_sov',
  'validate_platform_visibility',
  'validate_country_visibility',
  'validate_ai_traffic',
  'validate_gsc',
  'validate_ga4',
  'validate_competitive_gap',
  'validate_technical_fix',
  'validate_third_party_presence',
  'validate_third_party_citation',
];

const system = (id, spec = {}) => task(id, { mode: 'system', ...spec });
const agent = (id, spec = {}) => task(id, { mode: 'agent', ...spec });
const either = (id, spec = {}) => task(id, { mode: 'human_or_agent', ...spec });
const human = (id, spec = {}) => task(id, { mode: 'human', ...spec });
const validation = (id, spec = {}) =>
  system(id, {
    dependsOn: EXECUTION,
    outputs: ['baseline', 'current', 'absoluteChange', 'relativeChange'],
    ...spec,
  });

export const TASKS = Object.freeze({
  // ── Research / diagnosis ──────────────────────────────────────────────────
  analyze_ai_responses: agent('analyze_ai_responses', { outputs: ['findings', 'targetRefs'] }),
  analyze_visibility_change: system('analyze_visibility_change', {
    outputs: ['baseline', 'current', 'targetRefs'],
  }),
  analyze_platform_gap: system('analyze_platform_gap', { outputs: ['platformRates'] }),
  analyze_country_gap: system('analyze_country_gap', { outputs: ['regionRates'] }),
  analyze_topic_gap: system('analyze_topic_gap', {
    requires: ['topics'],
    outputs: ['missingTopics', 'targetRefs'],
  }),
  analyze_prompt_gap: system('analyze_prompt_gap', { outputs: ['promptIds', 'findings'] }),
  analyze_fanout_gap: system('analyze_fanout_gap', { outputs: ['queries', 'targetRefs'] }),
  analyze_mention_context: agent('analyze_mention_context', { outputs: ['contexts', 'findings'] }),
  analyze_citations: system('analyze_citations', {
    outputs: [
      'affectedCitationIds',
      'lostSources',
      'currentSources',
      'competitorSources',
      'targetRefs',
      'findings',
    ],
  }),
  analyze_competitor_visibility: system('analyze_competitor_visibility', {
    requires: ['competitors'],
    outputs: ['competitorRates'],
  }),
  analyze_competitor_citations: system('analyze_competitor_citations', {
    requires: ['competitors'],
    outputs: ['competitorSources'],
  }),
  analyze_competitor_content: agent('analyze_competitor_content', {
    requires: ['competitors'],
    outputs: ['findings'],
    // Read free from the pages the brand's answers cite (learning C1).
    tool: 'competitor_page_features',
  }),
  analyze_ai_traffic: system('analyze_ai_traffic', {
    requires: ['ai_traffic'],
    outputs: ['sessions', 'pages'],
    tool: 'ga_traffic_window',
  }),
  analyze_gsc_demand: system('analyze_gsc_demand', {
    requires: ['search_console'],
    outputs: ['queries'],
  }),
  analyze_gsc_ctr: system('analyze_gsc_ctr', {
    requires: ['search_console'],
    outputs: ['queries'],
  }),
  analyze_ga4_outcomes: system('analyze_ga4_outcomes', {
    requires: ['analytics'],
    outputs: ['keyEvents', 'engagement'],
  }),
  analyze_site_audit: system('analyze_site_audit', {
    requires: ['site_audits'],
    outputs: ['failingSignals'],
  }),
  // Learning C4: what the brand's winning pages have that its other audited
  // pages don't, read by GetCito overnight.
  analyze_winning_pages: system('analyze_winning_pages', {
    requires: ['site_audits'],
    outputs: ['patterns', 'missingPages'],
    tool: 'winning_page_features',
  }),
  analyze_entity_signals: agent('analyze_entity_signals', { outputs: ['findings'] }),
  analyze_internal_links: system('analyze_internal_links', {
    requires: ['site_audits'],
    outputs: ['linkGaps'],
  }),
  analyze_third_party_sources: agent('analyze_third_party_sources', {
    outputs: ['sources', 'findings'],
  }),

  // ── Mapping / prioritisation ──────────────────────────────────────────────
  cluster_prompts: agent('cluster_prompts', { outputs: ['clusters'] }),
  map_prompts_to_content: agent('map_prompts_to_content', { outputs: ['mapping'] }),
  map_queries_to_prompts: system('map_queries_to_prompts', {
    requires: ['search_console'],
    outputs: ['mapping'],
  }),
  identify_target_pages: agent('identify_target_pages', { outputs: ['targetPageIds'] }),
  identify_content_gaps: agent('identify_content_gaps', {
    outputs: [
      'targetPageIds',
      'promptIds',
      'missingTopics',
      'missingEntities',
      'missingQuestions',
      'recommendedChanges',
    ],
  }),
  identify_new_content_need: agent('identify_new_content_need', { outputs: ['assetsNeeded'] }),
  identify_citation_gaps: agent('identify_citation_gaps', { outputs: ['citationGaps'] }),
  identify_target_sources: agent('identify_target_sources', { outputs: ['sources'] }),
  identify_inclusion_path: agent('identify_inclusion_path', {
    dependsOn: ['identify_target_sources'],
    outputs: ['paths'],
  }),
  prioritize_targets: system('prioritize_targets', { outputs: ['orderedTargets'] }),
  define_validation_baseline: system('define_validation_baseline', {
    outputs: ['baseline', 'window'],
  }),

  // ── Content execution ─────────────────────────────────────────────────────
  create_content_brief: agent('create_content_brief', {
    outputs: [
      'targetTopic',
      'targetPrompts',
      'intent',
      'recommendedSections',
      'entities',
      'citationOpportunities',
      'internalLinkTargets',
    ],
  }),
  create_content_draft: agent('create_content_draft', {
    dependsOn: ['create_content_brief'],
    outputs: ['draft'],
  }),
  optimize_content: either('optimize_content', {
    permission: 'write',
    dependsOn: ['identify_content_gaps'],
    outputs: ['changes'],
  }),
  refresh_content: either('refresh_content', {
    permission: 'write',
    dependsOn: ['identify_content_gaps'],
    outputs: ['changes'],
  }),
  strengthen_reference_asset: either('strengthen_reference_asset', {
    permission: 'write',
    outputs: ['changes'],
  }),
  strengthen_entity_content: either('strengthen_entity_content', {
    permission: 'write',
    outputs: ['changes'],
  }),
  add_internal_links: either('add_internal_links', { permission: 'write', outputs: ['links'] }),
  improve_cta_path: either('improve_cta_path', { permission: 'write', outputs: ['changes'] }),
  // No publishing integration exists yet, so a person publishes — the action is
  // not blocked for want of a CMS tool (spec §7, test 5).
  publish_content: human('publish_content', {
    permission: 'execute',
    dependsOn: ['create_content_draft', 'optimize_content', 'refresh_content'],
    outputs: ['targetId', 'integrationId', 'toolCallId', 'publishedUrl', 'publishedAt', 'status'],
  }),

  // ── Technical execution ───────────────────────────────────────────────────
  fix_crawler_access: human('fix_crawler_access', { permission: 'write', outputs: ['changes'] }),
  fix_structured_data: human('fix_structured_data', { permission: 'write', outputs: ['changes'] }),
  fix_broken_target: human('fix_broken_target', { permission: 'write', outputs: ['changes'] }),
  fix_technical_issue: human('fix_technical_issue', { permission: 'write', outputs: ['changes'] }),
  validate_technical_fix: validation('validate_technical_fix', { requires: ['site_audits'] }),

  // ── Third-party / authority ───────────────────────────────────────────────
  // Nothing here edits a third-party site. Inclusion is earned through a
  // legitimate path a person, or an approved tool, carries out (spec §22).
  prepare_outreach: either('prepare_outreach', {
    dependsOn: ['identify_inclusion_path'],
    outputs: ['messages'],
  }),
  execute_outreach: human('execute_outreach', {
    permission: 'execute',
    dependsOn: ['prepare_outreach'],
    outputs: ['sent'],
  }),
  prepare_contribution: either('prepare_contribution', {
    dependsOn: ['identify_inclusion_path'],
    outputs: ['material'],
  }),
  track_third_party_status: human('track_third_party_status', {
    dependsOn: ['execute_outreach'],
    outputs: ['status'],
  }),
  validate_third_party_presence: validation('validate_third_party_presence', {
    dependsOn: ['track_third_party_status'],
  }),
  validate_third_party_citation: validation('validate_third_party_citation', {
    dependsOn: ['track_third_party_status'],
  }),

  // ── Validation ────────────────────────────────────────────────────────────
  validate_ai_visibility: validation('validate_ai_visibility', { tool: 'visibility_window' }),
  validate_mentions: validation('validate_mentions'),
  validate_citations: validation('validate_citations'),
  validate_topic_sov: validation('validate_topic_sov', { requires: ['topics'] }),
  validate_platform_visibility: validation('validate_platform_visibility'),
  validate_country_visibility: validation('validate_country_visibility'),
  validate_ai_traffic: validation('validate_ai_traffic', {
    requires: ['ai_traffic'],
    tool: 'ga_traffic_window',
  }),
  validate_gsc: validation('validate_gsc', { requires: ['search_console'] }),
  validate_ga4: validation('validate_ga4', { requires: ['analytics'] }),
  validate_competitive_gap: validation('validate_competitive_gap', { requires: ['competitors'] }),
  // The outcome itself is measured by the nightly validation sweep once the
  // window has passed; this task is its place in the plan.
  measure_action_outcome: system('measure_action_outcome', {
    dependsOn: VALIDATIONS,
    outputs: ['outcome'],
  }),

  // ── Legacy — tasks raised before the library existed ──────────────────────
  analyze_losses: task('analyze_losses', {
    legacy: true,
    mode: 'agent',
    titleKeys: ['promptCount'],
  }),
  diagnose_slip: task('diagnose_slip', { legacy: true, mode: 'agent' }),
  review_responses: task('review_responses', {
    legacy: true,
    mode: 'agent',
    dependsOn: ['diagnose_slip'],
  }),
  review_pages: task('review_pages', { legacy: true, mode: 'agent', titleKeys: ['pageCount'] }),
  review_audits: task('review_audits', {
    legacy: true,
    mode: 'agent',
    requires: ['site_audits'],
    titleKeys: ['pageCount'],
  }),
  identify_prompts: task('identify_prompts', {
    legacy: true,
    mode: 'agent',
    titleKeys: ['promptCount'],
  }),
  compare_platforms: task('compare_platforms', {
    legacy: true,
    mode: 'agent',
    titleKeys: ['platform', 'bestPlatform'],
  }),
  compare_citations: task('compare_citations', {
    legacy: true,
    mode: 'agent',
    requires: ['competitors'],
    titleKeys: ['competitor'],
  }),
  analyze_competitor: task('analyze_competitor', {
    legacy: true,
    mode: 'agent',
    requires: ['competitors'],
    titleKeys: ['competitor'],
  }),
  coverage_gaps: task('coverage_gaps', { legacy: true, mode: 'agent' }),
  identify_sources: task('identify_sources', {
    legacy: true,
    mode: 'agent',
    dependsOn: ['compare_citations'],
  }),
  measure_traffic_impact: task('measure_traffic_impact', {
    legacy: true,
    mode: 'agent',
    requires: ['analytics'],
    dependsOn: ['analyze_losses'],
    tool: 'ga_traffic_window',
  }),
  competitor_pressure: task('competitor_pressure', {
    legacy: true,
    mode: 'agent',
    requires: ['competitors'],
    dependsOn: ['diagnose_slip'],
  }),
  page_readiness: task('page_readiness', {
    legacy: true,
    mode: 'agent',
    requires: ['site_audits'],
    dependsOn: ['review_pages'],
  }),
  update_content: task('update_content', { legacy: true, dependsOn: ['coverage_gaps'] }),
  reinforce_content: task('reinforce_content', { legacy: true, dependsOn: ['review_responses'] }),
  strengthen_content: task('strengthen_content', { legacy: true, dependsOn: ['coverage_gaps'] }),
  create_citable_content: task('create_citable_content', {
    legacy: true,
    dependsOn: ['identify_prompts'],
  }),
  internal_links: task('internal_links', { legacy: true, dependsOn: ['update_content'] }),
  fix_issues: task('fix_issues', {
    legacy: true,
    requires: ['site_audits'],
    dependsOn: ['review_audits'],
  }),
  strengthen_sources: task('strengthen_sources', {
    legacy: true,
    permission: 'execute',
    dependsOn: ['identify_sources'],
  }),
  validate: task('validate', { legacy: true, mode: 'agent', tool: 'visibility_window' }),
  revalidate: task('revalidate', { legacy: true, mode: 'agent', requires: ['site_audits'] }),
});

export function getTask(id) {
  return TASKS[id] ?? null;
}

export function listTasks() {
  return Object.values(TASKS);
}

/** The primitives definitions plan from — the specification's library. */
export function libraryTasks() {
  return listTasks().filter((entry) => !entry.legacy);
}

/** Everything a primitive must get right; run by the registry's own test. */
export function validateTask(entry) {
  const problems = [];
  if (!entry.id || !/^[a-z][a-z0-9_]*$/.test(entry.id))
    problems.push('id must be lower_snake_case');
  if (!Number.isInteger(entry.version) || entry.version < 1) problems.push('version must be >= 1');
  if (!MODES.includes(entry.mode)) problems.push(`unknown mode "${entry.mode}"`);
  if (!PERMISSIONS.includes(entry.permission))
    problems.push(`unknown permission "${entry.permission}"`);
  for (const source of entry.requires) {
    if (!SOURCES.includes(source)) problems.push(`unknown source "${source}"`);
  }
  for (const dependency of entry.dependsOn) {
    if (!TASKS[dependency]) problems.push(`depends on unknown task "${dependency}"`);
  }
  return problems;
}
