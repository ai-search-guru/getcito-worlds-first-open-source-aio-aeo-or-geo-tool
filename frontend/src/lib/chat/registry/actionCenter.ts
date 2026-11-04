import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { getActionCenterKpisFor, getOnboardingProgressFor } from '@/lib/mcp/actionCenterReads';
import { FIXTURE_IDS, defineTool } from './defineTool';

/** Chat's Action Center reads (CHAT-20 §9 rows 41 and 47; Chat Wave 1 W1-16). */

const brandId = contentUuid.describe('Brand id, from list_brands.');

export const ACTION_CENTER_READS = [
  defineTool({
    name: 'get_action_center_kpis',
    class: 'read',
    area: 'action_center',
    description:
      'The brand\'s KPIs in the Action Center: each one\'s value, change, target, progress and status (on track, at risk, off track). For "are we hitting our goals" questions.',
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'actionCenterKpis',
    route: '/dashboard/action-center/kpis',
    mcpTool: null,
    specRow: '41',
    inputSchema: z.object({ brand_id: brandId }),
    run: (ctx, input) => getActionCenterKpisFor(ctx, { brandId: input.brand_id }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
  defineTool({
    name: 'get_onboarding_progress',
    class: 'read',
    area: 'action_center',
    description:
      'The brand\'s Getting started steps: which are done, which are open, and how far along each is. For "what should I set up next" questions.',
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'onboardingProgress',
    route: '/dashboard/action-center/actions',
    mcpTool: null,
    specRow: '47',
    inputSchema: z.object({ brand_id: brandId }),
    run: (ctx, input) => getOnboardingProgressFor(ctx, { brandId: input.brand_id }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
];
