import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { getGaSummaryFor, getGscSummaryFor } from '@/lib/mcp/googleReads';
import { FIXTURE_IDS, defineTool } from './defineTool';

/** Chat's Google reads (CHAT-20 §9 row 35; Chat Wave 1 W1-16). Each needs its source connected. */

const input = z.object({
  brand_id: contentUuid.describe('Brand id, from list_brands.'),
  days: z.number().int().min(1).max(90).optional().describe('Days back, 28 by default.'),
});

export const AI_TRAFFIC_READS = [
  defineTool({
    name: 'get_gsc_summary',
    class: 'read',
    area: 'ai_traffic',
    description:
      "The brand's Google Search Console clicks over a period, against the period before, or that Search Console isn't connected. Google reports about two to three days late.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'gscSummary',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: input,
    run: (ctx, params) => getGscSummaryFor(ctx, { brandId: params.brand_id, days: params.days }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
  defineTool({
    name: 'get_ga_summary',
    class: 'read',
    area: 'ai_traffic',
    description:
      "The brand's Google Analytics (GA4) sessions over a period: all, from AI, engaged, key events and revenue, against organic, or that Analytics isn't connected. Analytics reports about a day late.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'gaSummary',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: input,
    run: (ctx, params) => getGaSummaryFor(ctx, { brandId: params.brand_id, days: params.days }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
];
