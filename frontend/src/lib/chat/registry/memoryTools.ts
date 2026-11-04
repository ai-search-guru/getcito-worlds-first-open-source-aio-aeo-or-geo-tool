import { z } from 'zod';
import { forgetChatMemory, saveChatMemory } from '@/lib/actions/chatMemory';
import { applyMemoryCard, forgetDoneStep, memoryCardForm, memoryDoneStep } from '../memory/card';
import {
  brandNameOf,
  checkMemorySave,
  memoryRefusal,
  readMemoryLine,
  readMemoryViewer,
  saidRefusal as said,
  scopeWords,
  visibleMemoryLine,
} from '../memory/store';
import { MAX_MEMORY_LINE, MEMORY_SCOPES, memoryRight } from '../memory/rules';
import { FIXTURE_IDS, defineTool, type ChatToolContext } from './defineTool';

/**
 * Chat's memory rows (CHAT-20 §9 rows 73–74, CHAT-14 items 7–11):
 *
 *   - save_memory: "Remember that…" keeps one short line, for the person
 *     (Me), the chat's brand or the workspace. A card in every mode, Full
 *     auto and "Don't ask again" included (always_card, item 10): nothing
 *     is remembered without a click. Every role saves to Me; the store
 *     checks the scope (Brand: Admins and Managers; Workspace: Admins, a
 *     Manager's goes to the Admins as a request).
 *   - forget_memory: "Forget that…" removes the line it names; Undo brings
 *     it back for 10 seconds (item 23).
 *
 * Both check first (precheck), so a line memory may not keep, a scope the
 * person may not change or memory that is off is said in words before any
 * card. Server only.
 */

/** The run's person as the memory's rules read them, or null. */
const viewerOf = (ctx: ChatToolContext) =>
  ctx.organizationId
    ? readMemoryViewer({ userId: ctx.userId, organizationId: ctx.organizationId })
    : Promise.resolve(null);

const memoryId = z.guid();

export const MEMORY_TOOLS = [
  defineTool({
    name: 'save_memory',
    class: 'write',
    area: 'memory',
    description: `Remember one short line between chats, only when the person asks ("remember that…", in any language): rewrite their fact or preference as one line under ${MAX_MEMORY_LINE} characters in their words. scope user (Me) unless they say it is about the brand (brand, with the chat's brand_id) or for everyone in the workspace (workspace). When it repeats or contradicts a saved note of that scope, pass that note's id as replaces. Never secrets, personal details beyond a first name, tracking numbers or plan prices (they change: read them live). Never on your own.`,
    // A card in every mode (CHAT-14 item 10, CHAT-20 §5 step 4): never Always.
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { alwaysCard: true },
    // Me is every role's; the store checks Brand and Workspace (CHAT-20 §4).
    minRole: 'analyst',
    planGate: null,
    // A Me or Workspace line has no brand; a Brand line's brand is checked by the store.
    brandOf: null,
    costClass: 'C0',
    labelKey: 'memorySave',
    route: null,
    mcpTool: null,
    specRow: '73',
    inputSchema: z.object({
      scope: z
        .enum(MEMORY_SCOPES)
        .describe('user (Me, only this person), brand (the chat’s brand) or workspace (everyone).'),
      text: z
        .string()
        .trim()
        .min(1)
        .max(MAX_MEMORY_LINE)
        .describe('The line, as the person would write it ("Write blog posts in US English").'),
      brand_id: memoryId
        .optional()
        .describe(
          'The chat’s brand_id whenever the chat has a brand, so the person can pick Brand on the card.',
        ),
      replaces: memoryId
        .optional()
        .describe('The id of the saved note this one replaces, from the saved notes.'),
    }),
    precheck: async (ctx, input) => {
      const viewer = await viewerOf(ctx);
      if (!viewer) return null;
      const checked = await checkMemorySave(viewer, {
        scope: input.scope,
        text: input.text,
        brandId: input.brand_id ?? null,
        replaces: input.replaces ?? null,
      });
      return checked.ok ? null : said(checked.refusal);
    },
    run: (_ctx, input) => saveChatMemory(input),
    target: async (input, { organizationId }) => {
      const brandName =
        input.scope === 'brand' && input.brand_id
          ? await brandNameOf(organizationId, input.brand_id)
          : null;
      return `“${input.text}” · ${scopeWords(input.scope, brandName)}`;
    },
    // The Remember card (W3-12a): the line and its scope, editable, and what it replaces.
    form: {
      fields: (input, ctx) => memoryCardForm(input, ctx),
      apply: (input, values) => applyMemoryCard(input, values),
    },
    doneStep: (_input, output) => memoryDoneStep(output),
    fixture: { input: { scope: 'user', text: 'Write blog posts in US English' } },
  }),
  defineTool({
    name: 'forget_memory',
    class: 'write',
    area: 'memory',
    description:
      'Remove a saved note when the person asks ("forget that…", in any language): the id of the one note it names, from the saved notes. Ask which when more than one could be meant. Never on your own.',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    // Me is every role's; the store checks Brand and Workspace (CHAT-20 §4).
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C0',
    labelKey: 'memoryForget',
    route: null,
    mcpTool: null,
    specRow: '74',
    inputSchema: z.object({
      memory_id: memoryId.describe('The saved note’s id, from the saved notes.'),
    }),
    precheck: async (ctx, input) => {
      const viewer = await viewerOf(ctx);
      if (!viewer) return null;
      // Only a line the person sees: never another person's Me line.
      const line = await visibleMemoryLine(viewer, input.memory_id);
      if (!line) return said(memoryRefusal('not_found').refusal);
      if (memoryRight(viewer.role, line.scope) !== 'edit') {
        return said(
          memoryRefusal(line.scope === 'workspace' ? 'role_workspace' : 'role_brand').refusal,
        );
      }
      return null;
    },
    run: (_ctx, input) => forgetChatMemory(input),
    target: async (input, { organizationId }) => {
      // Checked first (precheck): a line the person sees.
      const line = await readMemoryLine(organizationId, input.memory_id);
      return line ? `“${line.text}” · ${scopeWords(line.scope, line.brandName)}` : null;
    },
    doneStep: (_input, output) => forgetDoneStep(output),
    fixture: { input: { memory_id: FIXTURE_IDS.item } },
  }),
];
