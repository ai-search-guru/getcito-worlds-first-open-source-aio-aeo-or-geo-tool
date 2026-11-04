import { z } from 'zod';
import { addBrandTopic, renameBrandTopic } from '@/lib/actions/topic';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { TOPIC_NAME_CHARS } from '@/lib/topicNames';
import { FIXTURE_IDS, defineTool } from './defineTool';
import { topicName } from './targets';

/**
 * Chat's topic WRITE rows (CHAT-20 §9 row 25): adding a topic and renaming
 * one, through the Topics tab's server actions, as the signed-in member.
 * Topic changes are Admins' and Managers' (00382, #1790).
 */

const BRAND = FIXTURE_IDS.brand;
const ITEM = FIXTURE_IDS.item;

const name = z.string().trim().min(1).max(TOPIC_NAME_CHARS);

export const TOPIC_TOOLS = [
  defineTool({
    name: 'add_topic',
    class: 'write',
    area: 'topics',
    description:
      "Add a topic to the brand, so prompts can be tracked in it (add_prompts). A name the brand already has isn't added again.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    // No topic limit on any plan today: nothing to gate.
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'newTopic',
    route: '/dashboard/prompts/topics',
    mcpTool: null,
    specRow: '25',
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      name: name.describe("The topic's name, as the person would say it."),
    }),
    run: (_ctx, input) => addBrandTopic(input.brand_id, input.name),
    fixture: { input: { brand_id: BRAND, name: 'Pricing' } },
  }),
  defineTool({
    name: 'rename_topic',
    class: 'write',
    area: 'topics',
    description: "Rename one of the brand's topics (its id from list_topics).",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { lookup: 'topics', idField: 'topic_id' },
    costClass: 'C0',
    labelKey: 'topicName',
    route: '/dashboard/prompts/topics',
    mcpTool: null,
    specRow: '25',
    inputSchema: z.object({
      topic_id: contentUuid.describe("The topic's id, from list_topics."),
      name: name.describe('Its new name.'),
    }),
    run: (_ctx, input) => renameBrandTopic(input.topic_id, input.name),
    target: async (input) => {
      const now = await topicName(input.topic_id);
      return now ? `“${now}” → “${input.name}”` : `“${input.name}”`;
    },
    fixture: { input: { topic_id: ITEM, name: 'Pricing and plans' } },
  }),
];
