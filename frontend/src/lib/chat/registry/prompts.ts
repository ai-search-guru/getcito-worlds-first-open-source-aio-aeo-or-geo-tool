import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { getFanoutsFor, getPromptInsightsFor, listAiAnswersFor } from '@/lib/mcp/promptReads';
import { FIXTURE_IDS, defineTool } from './defineTool';

/** Chat's Prompts reads (CHAT-20 §9 rows 14, 16, 18; Chat Wave 1 W1-16). */

const brandId = contentUuid.describe('Brand id, from list_brands.');

export const PROMPTS_READS = [
  defineTool({
    name: 'get_fanouts',
    class: 'read',
    area: 'prompts',
    description:
      'The searches AI engines ran behind the brand\'s tracked answers (query fan-out): each sub-query, the engines that ran it, how often, and whether it is tracked as a prompt. For "what do the engines search for" questions.',
    minRole: 'analyst',
    planGate: { platforms: true },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'fanouts',
    route: '/dashboard/prompts/fan-outs',
    mcpTool: null,
    specRow: '18',
    inputSchema: z.object({
      brand_id: brandId,
      days: z.number().int().min(1).max(90).optional().describe('Days back, 30 by default.'),
    }),
    run: (ctx, input) => getFanoutsFor(ctx, { brandId: input.brand_id, days: input.days }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
  defineTool({
    name: 'list_ai_answers',
    class: 'read',
    area: 'prompts',
    description:
      'A tracked prompt\'s newest AI answers, on one platform or all: the answer\'s text (shortened), whether it names or cites the brand, its tone and score. For "what did ChatGPT say" questions.',
    minRole: 'analyst',
    planGate: { platforms: true },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'aiAnswers',
    route: '/dashboard/prompts/tracked',
    mcpTool: null,
    specRow: '14',
    inputSchema: z.object({
      brand_id: brandId,
      prompt_id: contentUuid.describe('Prompt id, from list_prompts.'),
      platform: z.string().optional().describe('One platform id, e.g. "chatgpt-web".'),
      date_from: z.string().optional().describe('ISO timestamp (inclusive) lower bound.'),
      date_to: z.string().optional().describe('ISO timestamp (inclusive) upper bound.'),
      limit: z.number().int().min(1).max(10).optional().describe('Answers, 5 by default.'),
    }),
    run: (ctx, input) =>
      listAiAnswersFor(ctx, {
        brandId: input.brand_id,
        promptId: input.prompt_id,
        platform: input.platform,
        dateFrom: input.date_from,
        dateTo: input.date_to,
        limit: input.limit,
      }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand, prompt_id: FIXTURE_IDS.item } },
  }),
  defineTool({
    name: 'get_prompt_insights',
    class: 'read',
    area: 'prompts',
    description:
      'The Prompts page\'s Insights: estimated AI search volume across the brand\'s prompts, how they split by intent, and the prompts with the most demand. For "which prompts matter most" questions.',
    minRole: 'analyst',
    planGate: { feature: 'prompt_volumes' },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'promptInsights',
    route: '/dashboard/prompts/insights',
    mcpTool: null,
    specRow: '16',
    inputSchema: z.object({
      brand_id: brandId,
      limit: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe('Top prompts listed, 10 by default.'),
    }),
    run: (ctx, input) => getPromptInsightsFor(ctx, { brandId: input.brand_id, limit: input.limit }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
];
