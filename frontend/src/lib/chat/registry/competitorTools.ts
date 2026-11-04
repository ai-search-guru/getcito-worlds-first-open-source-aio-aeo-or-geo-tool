import { z } from 'zod';
import { addCompetitors, removeBrandCompetitor } from '@/lib/actions/competitor';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { FIXTURE_IDS, defineTool } from './defineTool';
import { competitorName, competitorWords, listWords } from './targets';

/**
 * Chat's competitor WRITE rows (CHAT-20 §9 rows 30, 32): adding competitors
 * and removing one, through the Competitors page's server actions, as the
 * signed-in member. Admins and Managers (the role model of 2026-10-29).
 */

const BRAND = FIXTURE_IDS.brand;
const ITEM = FIXTURE_IDS.item;

export const COMPETITOR_TOOLS = [
  defineTool({
    name: 'add_competitors',
    class: 'write',
    area: 'competitors',
    description:
      'Add competitors to the brand, each with its name and website domain ("peec.ai"). One the brand already has (the same domain) is skipped. Only the ones the person asked for.',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    // The Competitors page's feature (no competitor limit on any plan today); at most 5 a run
    // (§9, runLimits.ts).
    planGate: { feature: 'competitor_tracking' },
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'trackCompetitors',
    route: '/dashboard/competitors',
    mcpTool: null,
    specRow: '30',
    batch: { field: 'competitors' },
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      competitors: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(100),
            domain: z.string().trim().max(253).default(''),
          }),
        )
        .min(1)
        .max(5),
    }),
    run: (_ctx, input) => addCompetitors(input.brand_id, input.competitors),
    target: (input) => listWords(input.competitors.map(competitorWords)),
    fixture: { input: { brand_id: BRAND, competitors: [{ name: 'Peec AI', domain: 'peec.ai' }] } },
  }),
  defineTool({
    name: 'remove_competitor',
    class: 'write',
    area: 'competitors',
    description:
      "Remove one of the brand's competitors (its id from list_competitors): GetCito stops comparing the brand with it. Only when the person asked for it to go.",
    // A card in every mode (§9 row 32: "Ask (always_card)").
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { alwaysCard: true },
    minRole: 'manager',
    planGate: { feature: 'competitor_tracking' },
    // The brand from the input: once removed, the competitor's row no longer says it (Undo).
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'dropCompetitor',
    route: '/dashboard/competitors',
    mcpTool: null,
    specRow: '32',
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      competitor_id: contentUuid.describe("The competitor's id, from list_competitors."),
    }),
    run: (_ctx, input) => removeBrandCompetitor(input.brand_id, input.competitor_id),
    target: (input) => competitorName(input.competitor_id, input.brand_id),
    fixture: { input: { brand_id: BRAND, competitor_id: ITEM } },
  }),
];
