import { z } from 'zod';
import { WHY_METRICS } from '@/lib/chat/why/explain';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { explainChangeFor } from '@/lib/mcp/why';
import { FIXTURE_IDS, defineTool } from './defineTool';

/**
 * Chat's Why did it move read (CHAT-22 §1, CHAT-20 §9 row 72): why a
 * tracked number changed between two periods, from scheduled tracking only
 * (Addendum 2 G) and with no model call (lib/chat/why/explain.ts). The
 * engine keeps each analysis it ran in chat_why_analyses (00420), so the
 * numbers the answer says can be shown again. Every role, on every plan
 * (§1 item 11), the data limited to the plan's engines.
 */

const BRAND = FIXTURE_IDS.brand;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A day as YYYY-MM-DD')
  .optional();

export const WHY_TOOLS = [
  defineTool({
    name: 'explain_change',
    class: 'read',
    area: 'visibility',
    description:
      "Why a brand's tracked number moved between two periods: the Visibility score on the Insights card (visibility_score), visibility, mention rate, share of voice, citation rate or average position. visibility = visible prompts / tracked prompts; the Insights Visibility score is visibility_score, split into its mention rate, citation rate and position parts. Gives the values and change, whether it is beyond normal swing, the day it changed, what a changed prompt set explains, and the ranked causes (a lost or won citation, a competitor entering, a site change) with their share and confidence. By default the last 7 days against the 7 before; give both periods, or `around` for a day the person named. Computed from scheduled tracking, never by asking an engine.",
    minRole: 'analyst',
    planGate: { platforms: true },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'whyChange',
    route: '/dashboard/insights',
    mcpTool: null,
    specRow: '72',
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      metric: z
        .enum(WHY_METRICS)
        .describe(
          'visibility_score (the AI Visibility score on the Insights card: 0.6 × mention rate + 0.25 × citation rate + 0.15 × position factor), visibility (the share of tracked prompts where the brand appears: visible prompts / tracked prompts), mention_rate, share_of_voice, citations (answers citing its pages) or avg_position.',
        ),
      model: z.string().optional().describe('A model slug, or comma-separated slugs.'),
      region: z.string().optional().describe('A region code, e.g. "US" or "TR".'),
      topic_id: contentUuid.optional().describe('Topic id, from list_topics.'),
      period_a_from: day.describe('The earlier period’s first day.'),
      period_a_to: day.describe('The earlier period’s last day.'),
      period_b_from: day.describe('The later period’s first day.'),
      period_b_to: day.describe('The later period’s last day.'),
      around: day.describe(
        'A day the person named: the 7 days before it against it and the 6 after.',
      ),
    }),
    run: (ctx, input) =>
      explainChangeFor(ctx, {
        brandId: input.brand_id,
        metric: input.metric,
        model: input.model,
        region: input.region,
        topicId: input.topic_id,
        // Any day given: all four are needed (explainChangeFor says so).
        periods:
          input.period_a_from || input.period_a_to || input.period_b_from || input.period_b_to
            ? {
                a: { from: input.period_a_from, to: input.period_a_to },
                b: { from: input.period_b_from, to: input.period_b_to },
              }
            : undefined,
        around: input.around,
      }),
    fixture: { input: { brand_id: BRAND, metric: 'visibility' } },
  }),
];
