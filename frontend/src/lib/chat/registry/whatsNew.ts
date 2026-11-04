import { z } from 'zod';
import { getWhatsNewFor } from '@/lib/mcp/whatsNew';
import { defineTool } from './defineTool';

/**
 * What's new (CHAT-11 §C, CHAT-20 §9 row 3; Chat Wave 4 W4-20): the
 * team's notes on what GetCito added, for the person's plan. It reads no
 * brand data and costs no AI usage.
 */
export const WHATS_NEW_READS = [
  defineTool({
    name: 'get_whats_new',
    class: 'read',
    area: 'account',
    description:
      'What\'s new in GetCito for the person\'s plan: up to 3 updates, the feature they named first, then the ones new for them, then the newest. Each has the feature, its lines (why it was built, what it does, how it helps, what to do), the page to try it, and on_plans when their plan doesn\'t include it. The updates show as cards under your answer: don\'t repeat their lines; add at most one sentence tying an update to what the person asked, and when they write in another language give the lines in it. Benefit only: never add a price or a technical detail. Next moves: "Try it on my brand" and, when older_updates is true, "Show older updates" (call again with shown listing the feature of every update already shown in this conversation).',
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C0',
    labelKey: 'whatsNew',
    route: null,
    mcpTool: null,
    specRow: '3',
    inputSchema: z.object({
      feature: z
        .string()
        .trim()
        .max(80)
        .optional()
        .describe('The feature the person named, e.g. "Agent Center".'),
      shown: z
        .array(z.string().trim().max(80))
        .max(50)
        .optional()
        .describe('The features of the updates already shown, left out for the next ones.'),
      limit: z.number().int().min(1).max(10).optional().describe('Updates, 3 at most.'),
    }),
    run: (ctx, input) =>
      getWhatsNewFor(ctx, {
        feature: input.feature,
        shown: input.shown,
        limit: input.limit,
      }),
    fixture: { input: { feature: 'Agent Center' } },
  }),
];
