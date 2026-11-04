import { z } from 'zod';
import { openPageFor } from '@/lib/mcp/navigation';
import { PLATFORM_IDS } from '@/lib/chat/routes';
import { defineTool } from './defineTool';

/**
 * Chat's "Go to a page" (CHAT-19 §2, CHAT-20 §9 row 1; Chat Wave 1 W1-28).
 * Plain requests are answered before the model by the rules-based router
 * (lib/chat/routes.ts routeRequest); this is the tool the model calls for
 * the rest. It reads no workspace data and costs no AI usage.
 */
export const NAVIGATION_READS = [
  defineTool({
    name: 'open_page',
    class: 'read',
    area: 'navigation',
    description:
      'Open a page of the app for the person, with its filters set: a date range ("24h", "7d", "30d", "90d", "all") and a platform id where the page keeps them. The route is the page\'s address without /dashboard/, e.g. "insights", "prompts/tracked", "settings/billing".',
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C0',
    labelKey: 'goToPage',
    route: null,
    mcpTool: null,
    specRow: '1',
    inputSchema: z.object({
      route: z.string().trim().min(1).max(100).describe('The page, e.g. "citations".'),
      range: z.enum(['24h', '7d', '30d', '90d', 'all']).optional(),
      platform: z.enum(PLATFORM_IDS).optional().describe('A platform id, e.g. "perplexity-web".'),
    }),
    run: (ctx, input) =>
      openPageFor(ctx, { route: input.route, range: input.range, platform: input.platform }),
    fixture: { input: { route: 'insights', range: '30d' } },
  }),
];
