import { z } from 'zod';
import type { PlanId } from '@/config/plans';
import { ACTION_CATEGORIES } from '@/lib/action-center/registry';
import { KPI_KEYS } from '@/lib/kpis/registry';
import type { WorkAreaId } from '@/lib/menuAccess';
import { RRULE_DAYS } from '../agentSchedule';
import { CHAT_MODES } from '../precedence';
import type { PlanGate } from '../registry/defineTool';
import catalog from './catalog.json';

/**
 * Agent Center's ready-to-use agents (AGENTS plan §1, §3; CHAT-21 §D item
 * 15). CHAT-21 has no template object, so a ready-to-use agent is a preset:
 * a primary skill and up to 2 follow-on skills, its default triggers, mode
 * and connections. "Use this agent" opens New agent filled with it; the
 * person changes what they like and saves. Nothing turns on by itself.
 *
 * Each preset is a JSON file in ./presets, named by its id; catalog.json
 * holds them all in PRESET_ORDER, and catalog.test.ts keeps it in step with
 * the folder (refresh it with `yarn test -u src/lib/chat/agents`), as the
 * skills library is. A preset's name and line are
 * chatAgents.presets.{id} in messages/en.json.
 *
 * A `soon` preset is shown, never used: it says what it waits for
 * (`needs`). No renamed copies (AGENTS plan §8): two presets never share a
 * primary skill and the same triggers, and a pack's agent does a job the
 * core agents don't. The packs (§8.1 by business type, §8.3 by role) are
 * presets with `businessTypes` or `roles`; a §8.3 helper that is a core
 * agent is that core preset with the role, not a new one. Pure.
 */

/** What a preset is for: the gallery's first filter (Agent Center › Ready to use). */
export const PRESET_GOALS = [
  'visibility',
  'citations',
  'content',
  'competitors',
  'technical',
  'shopping',
  'tasks',
  'reporting',
  'help',
] as const;
export type PresetGoal = (typeof PRESET_GOALS)[number];

/**
 * Business types (AGENTS plan §8.1): a pack's presets carry theirs. The
 * brand's site types (SITE_TYPES, brands.site_type, 00205) by their keys,
 * and Mobile app, which a brand's settings don't offer yet: its agents show
 * under the filter, never as "For your site type".
 */
export const PRESET_BUSINESS_TYPES = ['ecommerce', 'app', 'b2b', 'b2c'] as const;

/** Industries (AGENTS plan §8.2). */
export const PRESET_INDUSTRIES = [
  'healthcare',
  'financial_services',
  'legal',
  'education',
  'saas',
  'ai_companies',
  'ecommerce_retail',
  'consumer_brands',
  'manufacturing',
  'automotive',
  'real_estate',
  'travel_hospitality',
] as const;

/**
 * The teams a role helper is for (AGENTS plan §8.3), by the work areas a
 * person picks (Settings › Menu access, 00374; WORK_AREAS), in their order.
 * E-commerce teams have the e-commerce pack, by business type; Agencies
 * have no work area yet.
 */
export const PRESET_ROLES = [
  'leaders',
  'aeo',
  'content',
  'brand',
  'growth',
  'product',
  'bizdev',
  'developers',
  'analytics',
] as const satisfies readonly WorkAreaId[];

/** What a `soon` preset waits for: chatAgents.ready.needs.{key}. */
export const PRESET_NEEDS = [
  'fanout_skill',
  'prompts_skill',
  'setup_skill',
  'help_articles',
  'catalog_trigger',
  'publish_trigger',
  'sub_agents',
  'ship_as_pr',
  'reddit_youtube',
  'hubspot',
  'jira_linear',
  'brand_access',
  'ads_data',
  'catalog_read',
  'seasonal_skill',
  'app_store_data',
  'review_sites',
  'local_listings',
  'content_plan_skill',
  'traffic_skill',
] as const;

/** The gallery's filters, in order; one shows only once a preset carries one of its values. */
export const PRESET_FILTERS = ['goal', 'businessType', 'industry', 'role'] as const;
export type PresetFilter = (typeof PRESET_FILTERS)[number];

/**
 * The catalog's order (AGENTS plan §0.2): the launch set, then what comes
 * next, then the business-type packs (§8.1: e-commerce, mobile app, B2B,
 * B2C) and the role helpers (§8.3), each in the plan's order.
 */
export const PRESET_ORDER = [
  'visibility-watch',
  'citation-winback',
  'competitor-watch',
  'content-freshness',
  'ready-to-publish',
  'task-finisher',
  'weekly-report',
  'brand-facts-guardian',
  'fanout-gap-filler',
  'prompt-portfolio',
  'onboarding-help',
  'shopping-readiness',
  'localization',
  'aeo-operator',
  'technical-fixer',
  'third-party-sources',
  'revenue-attribution',
  'ticket-loop',
  'agency-reporter',
  'ai-ads-watch',
  'product-answer-pages',
  'shopping-feed-advisor',
  'seasonal-prompt-planner',
  'app-store-listing',
  'app-alternatives-watch',
  'feature-question-coverage',
  'alternatives-comparison-pages',
  'review-site-presence',
  'integration-questions',
  'reviews-ugc-watch',
  'local-store-locator',
  'social-proof-pages',
  'content-plan-builder',
  'narrative-sentiment-watch',
  'source-outreach-list',
  'ceo-brief',
  'ai-traffic-signups',
  'unmet-needs-miner',
  'market-source-finder',
] as const;

const PRESET_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;
const tags = <const T extends readonly string[]>(values: T) =>
  z.array(z.enum(values)).refine(distinct, 'No repeats');

/**
 * A default trigger, as New agent's Trigger step offers it (W2-15): a
 * recurring schedule on the person's clock, a Signal created in Action
 * Center by its category, or a KPI crossing a threshold. None: Manual only.
 */
const presetTriggerSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('schedule'),
    repeat: z.enum(['daily', 'weekdays', ...RRULE_DAYS, 'month_first', 'month_last']),
    time: z.string().regex(CLOCK),
  }),
  z.strictObject({ kind: z.literal('signal'), category: z.enum(ACTION_CATEGORIES) }),
  z.strictObject({
    kind: z.literal('kpi'),
    kpi: z.enum(KPI_KEYS),
    direction: z.enum(['up', 'down', 'any']),
    threshold: z.number().positive(),
    unit: z.enum(['absolute', 'percent']),
    period: z.enum(['day', 'week', 'month']),
  }),
]);
export type PresetTrigger = z.output<typeof presetTriggerSchema>;

export const agentPresetSchema = z
  .strictObject({
    id: z.string().regex(PRESET_ID).max(60),
    goal: z.enum(PRESET_GOALS),
    businessTypes: tags(PRESET_BUSINESS_TYPES),
    industries: tags(PRESET_INDUSTRIES),
    roles: tags(PRESET_ROLES),
    /** The primary skill first, then up to 2 follow-on skills, by their /name. */
    skills: z.array(z.string().regex(PRESET_ID)).max(3).refine(distinct, 'No repeats'),
    triggers: z.array(presetTriggerSchema).max(5),
    mode: z.enum(CHAT_MODES),
    connections: z
      .array(
        z.strictObject({ key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), required: z.boolean() }),
      )
      .refine((list) => distinct(list.map((c) => c.key)), 'No repeats'),
    status: z.enum(['ready', 'soon']),
    needs: tags(PRESET_NEEDS),
  })
  .refine((preset) => preset.status === 'soon' || preset.skills.length > 0, {
    message: 'A ready preset has a skill',
    path: ['skills'],
  })
  .refine((preset) => (preset.status === 'soon') === preset.needs.length > 0, {
    message: 'A soon preset says what it needs; a ready one needs nothing',
    path: ['needs'],
  });
export type AgentPreset = z.output<typeof agentPresetSchema>;

/** The catalog, as catalog.json keeps it: in PRESET_ORDER. */
export const AGENT_PRESETS: readonly AgentPreset[] = (catalog as { presets: AgentPreset[] })
  .presets;

/** catalog.json's contents from the preset files: each checked, in PRESET_ORDER. */
export function buildPresetCatalog(files: readonly { file: string; json: unknown }[]): {
  presets: AgentPreset[];
} {
  const rank = (id: string) => {
    const at = (PRESET_ORDER as readonly string[]).indexOf(id);
    return at < 0 ? PRESET_ORDER.length : at;
  };
  const presets = files.map(({ file, json }) => {
    const parsed = agentPresetSchema.safeParse(json);
    if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`);
    return parsed.data;
  });
  return {
    presets: presets.sort(
      (a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
  };
}

/** A preset "Use this agent" may open: a ready one, by its id. */
export function readyPreset(id: string | null | undefined): AgentPreset | null {
  return AGENT_PRESETS.find((preset) => preset.id === id && preset.status === 'ready') ?? null;
}

/**
 * The plan a preset needs beyond what any plan with agents has, as a tool's
 * gate (planGateLock reads it): Full auto is Growth's, paid (CHAT-20 §7,
 * CHAT-21 §D item 19). Own AI keys never: a preset names no key.
 */
export const FULL_AUTO_PLAN: PlanId = 'growth';

export function presetGate(preset: Pick<AgentPreset, 'mode'>): PlanGate | null {
  return preset.mode === 'full_auto' ? { minPlan: FULL_AUTO_PLAN } : null;
}

/**
 * What a ready preset's card says about the workspace (readySetup.ts reads
 * it on the server): the plan its mode needs and the one the workspace is
 * on, or Full auto turned off by an Admin. Plan names only.
 */
export type PresetLock = { kind: 'plan'; plan: string; current: string } | { kind: 'policy' };

/** What makes two presets the same agent under two names: the primary skill and its triggers. */
export function presetSameness(preset: Pick<AgentPreset, 'skills' | 'triggers'>): string | null {
  const primary = preset.skills[0];
  if (!primary) return null;
  const triggers = preset.triggers.map((trigger) =>
    JSON.stringify(
      Object.fromEntries(Object.entries(trigger).sort(([a], [b]) => (a < b ? -1 : 1))),
    ),
  );
  return `${primary}|${[...triggers].sort().join(',')}`;
}

/** A preset's values for a filter. */
export function presetValues(preset: AgentPreset, filter: PresetFilter): readonly string[] {
  switch (filter) {
    case 'goal':
      return [preset.goal];
    case 'businessType':
      return preset.businessTypes;
    case 'industry':
      return preset.industries;
    case 'role':
      return preset.roles;
  }
}

const FILTER_VALUES: Record<PresetFilter, readonly string[]> = {
  goal: PRESET_GOALS,
  businessType: PRESET_BUSINESS_TYPES,
  industry: PRESET_INDUSTRIES,
  role: PRESET_ROLES,
};

/**
 * The filters to show and their values, in their lists' order: only values
 * some preset carries, and only filters with one at least. No empty filter.
 */
export function presetFilterOptions(
  presets: readonly AgentPreset[],
): { filter: PresetFilter; values: string[] }[] {
  return PRESET_FILTERS.map((filter) => {
    const carried = new Set(presets.flatMap((preset) => presetValues(preset, filter)));
    return { filter, values: FILTER_VALUES[filter].filter((value) => carried.has(value)) };
  }).filter((option) => option.values.length > 0);
}

/** What Ready to use knows of the person: the brand on screen's site type and their work areas. */
export interface PresetViewer {
  siteType: string | null;
  workAreas: readonly string[];
}

const NO_VIEWER: PresetViewer = { siteType: null, workAreas: [] };

/** Why a preset is the person's: made for the brand's site type, else for one of their work areas. */
export type PresetFit = 'siteType' | 'role';

export function presetFit(
  preset: Pick<AgentPreset, 'businessTypes' | 'roles'>,
  viewer: PresetViewer,
): PresetFit | null {
  const types: readonly string[] = preset.businessTypes;
  if (viewer.siteType && types.includes(viewer.siteType)) return 'siteType';
  if (preset.roles.some((role) => viewer.workAreas.includes(role))) return 'role';
  return null;
}

/**
 * The presets a set of picked filter values keeps (all of them for none):
 * ready ones first, and in each, the ones that fit the person first.
 */
export function filterPresets(
  presets: readonly AgentPreset[],
  picked: Partial<Record<PresetFilter, string | null>>,
  viewer: PresetViewer = NO_VIEWER,
): AgentPreset[] {
  const kept = presets.filter((preset) =>
    PRESET_FILTERS.every((filter) => {
      const value = picked[filter];
      return !value || presetValues(preset, filter).includes(value);
    }),
  );
  const fits = (preset: AgentPreset) => presetFit(preset, viewer) !== null;
  return (['ready', 'soon'] as const).flatMap((status) => {
    const same = kept.filter((preset) => preset.status === status);
    return [...same.filter(fits), ...same.filter((preset) => !fits(preset))];
  });
}
