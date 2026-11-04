import { z } from 'zod';
import { addTopicPrompts, pauseBrandPrompts } from '@/lib/actions/prompt';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { FIXTURE_IDS, defineTool } from './defineTool';
import { listWords, promptTexts, topicName } from './targets';

/**
 * Chat's prompt WRITE rows (CHAT-20 §9 rows 20, 22): tracking new prompts
 * in one of the brand's topics, and pausing prompts. Each calls the server
 * action the Prompts page's own code path runs, as the signed-in member,
 * with its read-only workspace check and its plan check on prompt locations.
 * Adding and pausing prompts stay with Admins and Managers (the role model
 * of 2026-10-29; MCP #1762).
 */

const BRAND = FIXTURE_IDS.brand;
const ITEM = FIXTURE_IDS.item;

export const PROMPT_TOOLS = [
  defineTool({
    name: 'add_prompts',
    class: 'write',
    area: 'prompts',
    description:
      "Track new prompts in one of the brand's topics (its id from list_topics; a topic the brand doesn't have is added first, with add_topic). Up to 20 texts, each as a person would ask an AI engine. They're tracked like the brand's newest prompt, at its location; a prompt it already tracks is skipped, and the plan's prompt locations may stop the rest (partial).",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    // The plan's prompt locations are the action's check (a quota, not a gate).
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'trackPrompts',
    route: '/dashboard/prompts',
    mcpTool: null,
    specRow: '20',
    // At most 50 a run (§9), counted by prompt (runLimits.ts).
    batch: { field: 'prompts' },
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      topic_id: contentUuid.describe("The topic's id, from list_topics."),
      prompts: z
        .array(z.string().trim().min(1).max(500))
        .min(1)
        .max(20)
        .describe('The prompts to track, in the words a person would use.'),
    }),
    run: (_ctx, input) => addTopicPrompts(input.brand_id, input.topic_id, input.prompts),
    target: async (input) => {
      const topic = await topicName(input.topic_id, input.brand_id);
      return [topic, listWords(input.prompts)].filter(Boolean).join(' · ') || null;
    },
    fixture: {
      input: { brand_id: BRAND, topic_id: ITEM, prompts: ['best crm for small teams'] },
    },
  }),
  defineTool({
    name: 'pause_prompts',
    class: 'write',
    area: 'prompts',
    description:
      "Pause some of the brand's tracked prompts (ids from list_prompts): they stop being tracked and free their locations on the plan, and keep their history. Only when the person asked for these prompts to stop.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'pauseTracking',
    route: '/dashboard/prompts',
    mcpTool: null,
    specRow: '22',
    // More than 5 at once shows a card in every mode (§9 row 22: "> 5 prompts: Ask").
    batch: { field: 'prompt_ids', askAbove: 5 },
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      prompt_ids: z.array(contentUuid).min(1).max(50).describe('The prompts, from list_prompts.'),
    }),
    run: (_ctx, input) => pauseBrandPrompts(input.brand_id, input.prompt_ids),
    target: async (input) => listWords(await promptTexts(input.brand_id, input.prompt_ids)),
    fixture: { input: { brand_id: BRAND, prompt_ids: [ITEM] } },
  }),
];
