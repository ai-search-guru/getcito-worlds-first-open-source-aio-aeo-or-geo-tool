import { tool } from 'ai';
import { z } from 'zod';
import type { McpAuthContext } from '@/lib/mcpAuth';
import {
  CONTENT_OPPORTUNITY_STATUSES,
  getCompetitorComparisonFor,
  getVisibilitySummaryFor,
  getVisibilityTrendFor,
  listBrandsFor,
  listCitationsFor,
  listContentOpportunitiesFor,
  listPromptsFor,
  listTopicsFor,
  getPromptPerformanceFor,
  runSiteAuditFor,
  getSiteAuditFor,
  listSiteAuditsFor,
} from '@/lib/mcp/data';
import {
  getMentionCompetitorsFor,
  getMentionFor,
  getMentionsPerceptionFor,
  getMentionsSummaryFor,
  listMentionsFor,
} from '@/lib/mcp/mentions';
import { MENTION_SENTIMENTS, MENTION_SORTS } from '@/lib/mentionsList';

/** The Mentions & Sentiment page's filters, the same on every mentions tool. */
const mentionFilters = {
  brand_id: z.string().uuid(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  platform: z.string().optional(),
  region: z.string().optional(),
  topic_id: z.string().uuid().optional(),
  search: z.string().optional(),
};

const mentionParams = (args: z.infer<z.ZodObject<typeof mentionFilters>>) => ({
  brandId: args.brand_id,
  dateFrom: args.date_from,
  dateTo: args.date_to,
  platform: args.platform,
  region: args.region,
  topicId: args.topic_id,
  search: args.search,
});

/**
 * Vercel AI SDK tool definitions for the in-product agent. Each tool is a
 * thin wrapper around the same MCP data function the external MCP server
 * exposes — `list_brands` is `listBrandsFor`, etc. — so the agent sees the
 * exact same data Claude Desktop / Cursor users see, with the same
 * org-ownership scoping. We don't duplicate any aggregation logic here.
 *
 * Tool names are kept identical to the MCP tool ids so the system prompt's
 * tool list reads the same in both surfaces.
 */
export function buildAgentTools(auth: McpAuthContext) {
  return {
    list_brands: tool({
      description:
        'List the brands the authenticated user can access. Returns id, name, slug, industry, region, created_at. Call this first when the user has not named a brand.',
      inputSchema: z.object({}),
      execute: async () => listBrandsFor(auth),
    }),

    get_visibility_summary: tool({
      description:
        'Get aggregate visibility metrics for a brand over an optional date range. Returns result count, average visibility (0-100), total mentions, total citations, and the top 5 competitors by mention count. Use for snapshot / "how is my brand doing" questions.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        model: z.string().optional(),
        region: z.string().optional(),
      }),
      execute: async (args) =>
        getVisibilitySummaryFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          model: args.model,
          region: args.region,
        }),
    }),

    get_visibility_trend: tool({
      description:
        'Visibility / mentions / citations over time for a brand, bucketed by day or week. Each bucket includes avg_visibility_score, total_mentions, total_citations, avg_competitor_score. Use for trend questions and as the data source for charts.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        granularity: z.enum(['day', 'week']).optional(),
        model: z.string().optional(),
        region: z.string().optional(),
        topic_id: z.string().uuid().optional(),
      }),
      execute: async (args) =>
        getVisibilityTrendFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          model: args.model,
          region: args.region,
          topicId: args.topic_id,
          granularity: args.granularity,
        }),
    }),

    get_competitor_comparison: tool({
      description:
        'Competitor benchmark + share of voice for a brand. Returns the brand and every tracked competitor with avg_visibility_score, total_mentions, total_citations, appearance_count, plus overall_sov_pct and a per-(model_used, platform) SoV split.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        model: z.string().optional(),
        region: z.string().optional(),
        topic_id: z.string().uuid().optional(),
      }),
      execute: async (args) =>
        getCompetitorComparisonFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          model: args.model,
          region: args.region,
          topicId: args.topic_id,
        }),
    }),

    list_citations: tool({
      description:
        'URLs and domains AI engines cite alongside a brand, classified by source type (news / review / owned / social / forum / competitor / you). Returns totals, source_type_breakdown, top_domains, top_urls. Pass source_filter: "owned" to isolate the brand\'s own cited URLs (e.g. "which of OUR URLs did AI cite?"), "competitor" for competitor domains, "external" for everything else.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        model: z.string().optional(),
        region: z.string().optional(),
        topic_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        source_filter: z
          .enum(['all', 'owned', 'competitor', 'external'])
          .optional()
          .describe(
            'Scope by source: "owned" = brand\'s own domains, "competitor" = tracked competitors, "external" = neither, "all" = no filter (default).',
          ),
      }),
      execute: async (args) =>
        listCitationsFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          model: args.model,
          region: args.region,
          topicId: args.topic_id,
          limit: args.limit,
          sourceFilter: args.source_filter,
        }),
    }),

    list_topics: tool({
      description:
        'List topics for a brand, each with prompt_count. Use for coverage audits or before drilling into prompts on a theme.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
      }),
      execute: async (args) => listTopicsFor(auth, args.brand_id),
    }),

    list_prompts: tool({
      description:
        'List the prompts tracked for a brand, optionally filtered by topic or active status. Returns each prompt with text, topic, platforms, models, regions, is_active.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        topic_id: z.string().uuid().optional(),
        is_active: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: async (args) =>
        listPromptsFor(auth, {
          brandId: args.brand_id,
          topicId: args.topic_id,
          isActive: args.is_active,
          limit: args.limit,
        }),
    }),

    list_content_opportunities: tool({
      description:
        'List content opportunities / gaps for a brand, sorted by opportunity score descending. Use for "what should I write?" / strategy-priority questions.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        status: z.enum(CONTENT_OPPORTUNITY_STATUSES).optional(),
        impact: z.enum(['high', 'medium', 'low']).optional(),
        type: z.enum(['owned', 'earned']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async (args) =>
        listContentOpportunitiesFor(auth, {
          brandId: args.brand_id,
          status: args.status,
          impact: args.impact,
          type: args.type,
          limit: args.limit,
        }),
    }),

    get_prompt_performance: tool({
      description:
        'Get aggregate performance metrics (average visibility, total mentions, citations, appearances, and competitor score) grouped by prompt over a date range. Use to answer questions like "what is the best-performing prompt today?" or "which prompts dropped this week?".',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        topic_id: z.string().uuid().optional(),
        sort_by: z.enum(['visibility', 'mentions', 'citations', 'appearances']).optional(),
        order: z.enum(['desc', 'asc']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        model: z.string().optional(),
        region: z.string().optional(),
      }),
      execute: async (args) =>
        getPromptPerformanceFor(auth, {
          brandId: args.brand_id,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          topicId: args.topic_id,
          sortBy: args.sort_by,
          order: args.order,
          limit: args.limit,
          model: args.model,
          region: args.region,
        }),
    }),

    get_mentions_summary: tool({
      description:
        'Mentions & Sentiment overview for a brand: times named (timesNamed, the page\'s Total mentions), responses naming it, mention rate, prompts with mentions, average position and sentiment (counts, shares, net −100…+100), now and in the window before, with changes taken on the prompts both windows answered (changes.basis), as the page\'s cards; the platform that moved net sentiment most; each platform; each day. Use for "how is AI talking about us?" / "why did sentiment drop on Gemini?". Platform ids look like "chatgpt-web", "gemini-web". 30 days when date_from is left out.',
      inputSchema: z.object(mentionFilters),
      execute: async (args) => getMentionsSummaryFor(auth, mentionParams(args)),
    }),

    list_mentions: tool({
      description:
        'The responses naming the brand, 100 a page: prompt, platform, country, sentiment, position, competitors in the same response and an excerpt. Filter by sentiment or competitor_id ("none" for responses naming no competitor); sort newest, oldest, co_mentions or negative. Use to quote what AI actually said.',
      inputSchema: z.object({
        ...mentionFilters,
        sentiment: z.enum(MENTION_SENTIMENTS).optional(),
        competitor_id: z.string().optional(),
        sort: z.enum(MENTION_SORTS).optional(),
        page: z.number().int().min(1).optional(),
      }),
      execute: async (args) =>
        listMentionsFor(auth, {
          ...mentionParams(args),
          sentiment: args.sentiment,
          competitorId: args.competitor_id,
          sort: args.sort,
          page: args.page,
        }),
    }),

    get_mention: tool({
      description:
        'One response in full, by the id list_mentions returns: the stored text, citations, competitors it names, sentiment and its latest correction.',
      inputSchema: z.object({ id: z.string().uuid() }),
      execute: async (args) => getMentionFor(auth, args.id),
    }),

    get_mention_competitors: tool({
      description:
        "How often AI names each competitor in the brand's tracked responses (count, share, change against the window before) and how often in the same response as the brand.",
      inputSchema: z.object(mentionFilters),
      execute: async (args) => getMentionCompetitorsFor(auth, mentionParams(args)),
    }),

    get_mentions_perception: tool({
      description:
        'What AI associates with the brand: the terms next to it (with share of the responses naming it, now and before), the attributes that set it apart from its top competitors, co-mentions, and the biggest gap (an attribute a competitor leads by 20+ points). Found by rule, no LLM.',
      inputSchema: z.object(mentionFilters),
      execute: async (args) => getMentionsPerceptionFor(auth, mentionParams(args)),
    }),

    run_site_audit: tool({
      description:
        'Run a Site Audit (AEO/GEO page score + AI fix recommendations) for a page URL under a brand. WARNING: this consumes one of the org\'s monthly Site Audit credits (shared with the dashboard) and runs asynchronously (~30s). It returns the new audit id with status "running" — then call get_site_audit with that id until status is "completed" (or "failed") to read the result. A page with an audit already running returns that audit, with no new credit. A page audited in the last 10 minutes returns status "recently_audited" with that audit\'s id and starts nothing: ask the user whether to open it or audit again (force: true). Only run on explicit user intent to audit a specific URL; never audit unprompted.',
      inputSchema: z.object({
        brand_id: z.string().uuid(),
        url: z.string().url(),
        force: z.boolean().optional(),
      }),
      execute: async (args) =>
        args.force
          ? runSiteAuditFor(auth, args.brand_id, args.url, { force: true })
          : runSiteAuditFor(auth, args.brand_id, args.url),
    }),

    get_site_audit: tool({
      description:
        'Fetch a Site Audit by id — status, total score, per-category scores, evaluated signals, and AI fix recommendations. Use after run_site_audit to poll for the result: while status is "running" the scores are not yet populated; once "completed" (or "failed") the full result is available. Read — no credit consumed.',
      inputSchema: z.object({
        audit_id: z.string().uuid(),
      }),
      execute: async (args) => getSiteAuditFor(auth, args.audit_id),
    }),

    list_site_audits: tool({
      description:
        "List a brand's recent Site Audits (newest first) — id, url, status, total score, signals, and created date. Use to find a past audit by url/date (then read it with get_site_audit) without needing the id. Read — no credit consumed.",
      inputSchema: z.object({
        brand_id: z.string().uuid(),
      }),
      execute: async (args) => listSiteAuditsFor(auth, args.brand_id),
    }),

    render_chart: tool({
      description:
        'Render a chart inline in the chat. Call this AFTER you have the data from another tool (e.g. get_visibility_trend, get_competitor_comparison, list_citations) and you want to visualize it. Pick the chart type: "line" for time series (trends over dates), "bar" for cross-entity comparisons (brand vs competitors, source-type breakdown), "pie" for share-of-X distributions. Pass the data array straight from the previous tool result — never invent or reformat numbers. The tool just echoes the spec back; the UI renders the chart.',
      inputSchema: z.object({
        type: z
          .enum(['line', 'bar', 'pie'])
          .describe('line = time series, bar = cross-entity comparison, pie = share distribution'),
        title: z
          .string()
          .max(120)
          .optional()
          .describe('Optional short title shown above the chart'),
        data: z
          .array(z.record(z.string(), z.union([z.string(), z.number()])))
          .min(1)
          .max(200)
          .describe('Array of objects. Each row is one point/bar/slice. Max 200 rows.'),
        xKey: z
          .string()
          .optional()
          .describe(
            'For line / bar: the key on each row that holds the x-axis label (e.g. "date" or "competitor").',
          ),
        series: z
          .array(
            z.object({
              key: z.string().describe('Key on each row that holds this series value.'),
              label: z.string().describe('Human-readable name shown in legend / tooltip.'),
              color: z.string().optional().describe('Optional hex / CSS color override.'),
            }),
          )
          .max(5)
          .optional()
          .describe('For line / bar: one entry per measured series. Up to 5.'),
        valueKey: z
          .string()
          .optional()
          .describe('For pie: the key on each row that holds the numeric slice value.'),
        labelKey: z
          .string()
          .optional()
          .describe('For pie: the key on each row that holds the slice label.'),
      }),
      execute: async (args) => args,
    }),
    render_audit: tool({
      description:
        'Render a Site Audit result inline in the chat. Call this AFTER you have the completed audit data from get_site_audit (typically after running run_site_audit and polling until completion). Pass the audit result directly from the previous tool result — never invent or recalculate scores. The tool only echoes the audit data back; the UI renders the audit card.',
      inputSchema: z.object({
        url: z.string().describe('The URL that was audited.'),

        totalScore: z.number().nullable().describe('The overall Site Audit score.'),

        categoryScores: z.record(z.string(), z.unknown()).describe('Per-category audit scores.'),

        // Typed items, not z.unknown(): an untyped `items: {}` is a schema
        // Gemini may refuse, and that fails every Chat turn on it.
        recommendations: z
          .array(
            z.object({
              signalKey: z.string().optional(),
              label: z.string().optional(),
              category: z.string().nullable().optional(),
              priority: z.enum(['high', 'medium', 'low']).optional(),
              recommendation: z.string(),
              draft: z.string().nullable().optional(),
              code: z.string().nullable().optional(),
            }),
          )
          .describe('AI-generated audit recommendations, as get_site_audit returns them.'),

        signalsEvaluated: z.number().nullable().describe('Number of audit signals evaluated.'),

        signalsTotal: z.number().nullable().describe('Total number of audit signals.'),
      }),
      execute: async (args) => args,
    }),
  };
}
