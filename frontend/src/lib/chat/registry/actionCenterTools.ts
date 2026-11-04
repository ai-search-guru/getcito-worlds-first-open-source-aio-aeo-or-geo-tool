import { z } from 'zod';
import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import {
  attachFileToTask,
  attachToAction,
  checkChatActionCover,
  createChatAction,
  setTaskReadyForReview,
  type ChatActionProposal,
} from '@/lib/actions/chatActionCenter';
import { actorOf } from '@/lib/chat/actor/access';
import { checkChatActionCoverFor, createChatActionFor } from '@/lib/chat/actor/actionCenter';
import { actingOpen } from '@/lib/chat/actor/api';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { FIXTURE_IDS, defineTool, type ChatToolContext, type ToolResultCard } from './defineTool';
import { listWords, promptTexts } from './targets';
import { PLATFORM_LABELS } from '@/config/platformLabels';

/**
 * Chat's Action Center WRITE rows (CHAT-20 §9 rows 43–46; CHAT-09 §D–E):
 * Send to Action Center, Add to AC-{n}, Attach only and Ready for review.
 * They are the only changes Chat makes there (CHAT-09 item 21): it never
 * completes, dismisses, edits or deletes an action or a task, and no row
 * here marks a task done, in any mode or with any admin setting (item 15).
 * Each calls lib/actions/chatActionCenter.ts as the signed-in member,
 * Admins and Managers (the role model of 2026-10-29), with the run's place
 * for History's source, chat, run and execution.mode (§10a). Send to Action
 * Center also runs for a run with no session, as its person, through the
 * API server (lib/chat/actor/actionCenter.ts), while that way is open.
 */

const BRAND = FIXTURE_IDS.brand;
const ITEM = FIXTURE_IDS.item;

const categoryT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'actionCenter.actionCategories',
});
const typeT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.taskTypes' });
const cardT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.actionCard' });

const CATEGORIES = ['growth', 'protect', 'recover', 'fix', 'compete'] as const;
const TASK_TYPES = ['content', 'on_page', 'technical', 'outreach', 'pr', 'product'] as const;
const line = (max: number) => z.string().trim().min(1).max(max);

const task = z.object({
  title: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .describe(
      'The change to make, naming its one page, prompt or competitor: "Add a pricing FAQ block to /pricing". Never analyze / identify / validate / measure, never "for N prompts".',
    ),
  type: z.enum(TASK_TYPES),
  url: z.string().trim().max(500).optional().describe('The exact page: a path or a full address.'),
  where: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe('Where else it is done, when not on a page: the prompt, platform or competitor.'),
  why: z.string().trim().max(600).optional(),
  how: z.array(line(300)).max(8).optional().describe('The steps, in order.'),
  done_when: line(300).describe('A check anyone can make: "The FAQ block is live on /pricing".'),
  change: z
    .object({ before: z.string().trim().max(1000).optional(), after: line(1000) })
    .optional()
    .describe('The text it replaces (none when it adds), and the new text.'),
  check: z.enum(['auto', 'rerun', 'manual']).optional(),
});

const proposalInput = z.object({
  brand_id: contentUuid.describe('Brand id, from list_brands.'),
  title: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .describe('What the action wins, naming its thing: "Win back pricing citations on /pricing".'),
  category: z.enum(CATEGORIES),
  impact: z.enum(['high', 'medium', 'low']).optional(),
  why: line(600).describe('The finding, as the answer showed it, with its numbers.'),
  goal: z.string().trim().max(300).optional(),
  prompt_ids: z
    .array(contentUuid)
    .max(20)
    .default([])
    .describe('Prompts it is about, from list_prompts.'),
  pages: z.array(line(500)).max(20).default([]).describe('Pages it is about: paths or addresses.'),
  competitor_ids: z
    .array(contentUuid)
    .max(10)
    .default([])
    .describe('Competitors it is about, from list_competitors.'),
  platforms: z.array(line(40)).max(8).default([]).describe('Platform ids, e.g. "google-aio".'),
  tasks: z.array(task).min(1).max(8),
  create_anyway: z
    .boolean()
    .default(false)
    .describe(
      'Only after the person chose Create anyway for an action that shares only some of these.',
    ),
});

type ProposalInput = z.output<typeof proposalInput>;

/** The input as the server's proposal (fromChat.js chatProposalSchema). */
function proposalOf(input: ProposalInput): ChatActionProposal {
  return {
    title: input.title,
    category: input.category,
    ...(input.impact ? { impact: input.impact } : {}),
    why: input.why,
    ...(input.goal ? { goal: input.goal } : {}),
    entities: {
      prompts: input.prompt_ids,
      pages: input.pages,
      competitors: input.competitor_ids,
      platforms: input.platforms,
    },
    tasks: input.tasks,
  };
}

/** An action's number, by its id: "AC-1258"; null when it isn't there. */
async function actionNo(actionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select('action_no')
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the action: ${error.message}`);
  return data ? `AC-${data.action_no}` : null;
}

/** A task as its card names it: its own title, or its template's, and its action's number. */
async function taskName(taskId: string, brandId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('action_tasks')
    .select('title, task_key, actions!inner(action_no, brand_id)')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the task: ${error.message}`);
  const row = data as {
    title: string | null;
    task_key: string | null;
    actions: { action_no: number; brand_id: string } | null;
  } | null;
  if (!row || row.actions?.brand_id !== brandId) return null;
  const tasks = messages.actionCenter.actionTasks as Record<string, unknown>;
  const text =
    row.title?.trim() ||
    (row.task_key && typeof tasks[row.task_key] === 'string'
      ? (tasks[row.task_key] as string)
      : '');
  return [`AC-${row.actions.action_no}`, text ? `“${text}”` : null].filter(Boolean).join(' ');
}

/**
 * A file's title in Files, within the call's workspace: the brand's, whose
 * scope the precedence checked before any card opens.
 */
async function fileTitle(fileId: string, brandId: string): Promise<string | null> {
  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  if (brandError) throw new Error(`Could not read the brand: ${brandError.message}`);
  if (!brand?.organization_id) return null;
  const { data, error } = await supabaseAdmin
    .from('chat_files')
    .select('title')
    .eq('id', fileId)
    .eq('organization_id', brand.organization_id as string)
    .maybeSingle();
  if (error) throw new Error(`Could not read the file: ${error.message}`);
  return (data?.title as string | undefined) ?? null;
}

/** The brand's competitors among the ids, by name, in the ids' order. */
async function competitorNames(brandId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('competitors')
    .select('id, name')
    .eq('brand_id', brandId)
    .in('id', [...ids]);
  if (error) throw new Error(`Could not read the competitors: ${error.message}`);
  const names = new Map((data ?? []).map((row) => [row.id as string, row.name as string]));
  return ids.map((id) => names.get(id)).filter((name): name is string => !!name);
}

const ok = (output: unknown): Record<string, unknown> | null =>
  output && typeof output === 'object' && (output as { ok?: unknown }).ok === true
    ? (output as Record<string, unknown>)
    : null;

/** The run's place, for History: none outside a run. */
const placeOf = (ctx: ChatToolContext) => ctx.chat;

/**
 * The duplicate check's answer to a Send to Action Center call: the action
 * that covers it, or null to go on. Create anyway goes on to its card only
 * where the entities differ.
 */
function coverRefusal(
  found: Awaited<ReturnType<typeof checkChatActionCover>>,
  createAnyway: boolean,
) {
  return found.ok || (createAnyway && found.can_create_anyway) ? null : found;
}

export const ACTION_CENTER_TOOLS = [
  defineTool({
    name: 'create_action',
    class: 'write',
    area: 'action_center',
    description:
      'Send a finding to the Action Center as a new action, only when the person asked (Send to Action Center): its title, category (growth, protect, recover, fix, compete), the finding, the prompts, pages and competitors it is about, and 1–8 tasks, each naming its exact page (url) or where it is done, with Done when. If an active action already covers it, nothing is made and the answer is `duplicate` with that action: offer to add the finding to it with attach_to_action (recommended); only when can_create_anyway is true may you also offer Create anyway, as a question, and call this again with create_anyway only when the person picks it. The Action Center sets the Priority Score. It is never refused over the daily limit of new actions; when the answer has daily_limit_reached, say its daily_limit_note in one sentence. Never complete, dismiss or edit actions or tasks.',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'sendToActions',
    route: '/dashboard/action-center/actions',
    mcpTool: null,
    specRow: '43',
    inputSchema: proposalInput,
    precheck: async (_ctx, input) =>
      coverRefusal(
        await checkChatActionCover(input.brand_id, proposalOf(input).entities, input.category),
        input.create_anyway,
      ),
    run: (ctx, input) =>
      createChatAction(input.brand_id, proposalOf(input), placeOf(ctx), input.create_anyway),
    sessionFree: true,
    precheckFor: async (ctx, input) =>
      coverRefusal(
        await checkChatActionCoverFor(
          actorOf(ctx),
          input.brand_id,
          proposalOf(input).entities,
          input.category,
        ),
        input.create_anyway,
      ),
    runFor: (ctx, input) =>
      createChatActionFor(
        actorOf(ctx),
        input.brand_id,
        proposalOf(input),
        placeOf(ctx),
        input.create_anyway,
      ),
    runForOpen: actingOpen,
    target: (input) =>
      [`“${input.title}”`, categoryT(input.category), cardT('tasks', { count: input.tasks.length })]
        .filter(Boolean)
        .join(' · '),
    // What is frozen once it's made (CHAT-09 item 18b): every task with its new text, the
    // finding, the goal and the targets, in the person's words.
    cardDetails: async (input) => {
      const [prompts, competitors] = await Promise.all([
        input.prompt_ids.length ? promptTexts(input.brand_id, input.prompt_ids) : [],
        competitorNames(input.brand_id, input.competitor_ids),
      ]);
      return {
        items: input.tasks.map((t) => ({
          title: t.title,
          detail: [typeT(t.type), t.url || t.where, cardT('doneWhen', { text: t.done_when })]
            .filter(Boolean)
            .join(' · '),
          ...(t.change ? { body: t.change.after } : {}),
        })),
        why: input.why,
        ...(input.goal ? { goal: input.goal } : {}),
        targets: [
          { kind: 'prompts' as const, values: prompts },
          { kind: 'pages' as const, values: input.pages },
          { kind: 'competitors' as const, values: competitors },
          {
            kind: 'platforms' as const,
            values: input.platforms.map((id) => PLATFORM_LABELS[id] ?? id),
          },
        ],
      };
    },
    // Create anyway is the person's choice (CHAT-09 item 18a): its card shows in Full auto too.
    alwaysCardWhen: (input) => input.create_anyway === true,
    resultCard: (input, output): ToolResultCard | null => {
      const made = ok(output);
      return made
        ? {
            kind: 'action_created',
            actionNo: Number(made.action_no),
            title: input.title,
            href: made.href as `/dashboard/${string}`,
          }
        : null;
    },
    fixture: {
      input: {
        brand_id: BRAND,
        title: 'Win back pricing citations on /pricing',
        category: 'recover',
        why: 'Google AI Overviews stopped citing /pricing for 2 pricing prompts this week.',
        pages: ['/pricing'],
        tasks: [
          {
            title: 'Add a pricing FAQ block to /pricing',
            type: 'on_page',
            url: '/pricing',
            done_when: 'The FAQ block is live on /pricing',
          },
        ],
      },
    },
  }),
  defineTool({
    name: 'attach_to_action',
    class: 'write',
    area: 'action_center',
    description:
      "Add a finding to an active action that already covers it (Add to AC-{n}), as evidence with a note in its History, instead of a duplicate: its id from create_action's duplicate answer or list_action_center_tasks. The action's targets, tasks and priority don't change.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { lookup: 'actions', idField: 'action_id' },
    costClass: 'C0',
    labelKey: 'addToAction',
    route: '/dashboard/action-center/actions',
    mcpTool: null,
    specRow: '44',
    inputSchema: z.object({
      action_id: contentUuid.describe('The action that covers it.'),
      finding: line(600).describe('The finding, as the answer showed it, with its numbers.'),
      note: z.string().trim().max(600).optional().describe('What it adds to the action.'),
      sources: z.array(line(200)).max(5).optional().describe('Where it was read: pages, reads.'),
    }),
    run: (ctx, input) =>
      attachToAction(
        input.action_id,
        { finding: input.finding, note: input.note, sources: input.sources },
        placeOf(ctx),
      ),
    target: async (input) =>
      [await actionNo(input.action_id), listWords([input.finding], 1)].filter(Boolean).join(' · '),
    resultCard: (input, output): ToolResultCard | null => {
      const made = ok(output);
      return made
        ? {
            kind: 'action_added',
            actionNo: Number(made.action_no),
            title: input.finding,
            href: made.href as `/dashboard/${string}`,
          }
        : null;
    },
    fixture: {
      input: {
        action_id: ITEM,
        finding: 'Google AI Overviews cites a 2026 guide instead of /pricing for 2 prompts.',
      },
    },
  }),
  defineTool({
    name: 'attach_file_to_task',
    class: 'write',
    area: 'action_center',
    description:
      'Attach a file or draft in Files to an Action Center task (Attach only), without marking it done: the task id from get_action, the file id from a deliverable this chat made. Marking a task done is always the person’s click in Action Center, never a tool.',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'attachToTask',
    route: '/dashboard/action-center/actions',
    mcpTool: null,
    specRow: '45',
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      task_id: contentUuid.describe('The task, from get_action.'),
      file_id: contentUuid.describe('The file in Files.'),
    }),
    run: (ctx, input) =>
      attachFileToTask(input.brand_id, input.task_id, input.file_id, placeOf(ctx)),
    target: async (input) => {
      const [file, taskWords] = await Promise.all([
        fileTitle(input.file_id, input.brand_id),
        taskName(input.task_id, input.brand_id),
      ]);
      return [file ? `“${file}”` : null, taskWords].filter(Boolean).join(' → ') || null;
    },
    fixture: { input: { brand_id: BRAND, task_id: ITEM, file_id: ITEM } },
  }),
  defineTool({
    name: 'set_task_ready_for_review',
    class: 'write',
    area: 'action_center',
    description:
      "Say Chat finished its work for an Action Center task: Ready for review in this chat's task list and in the task's History (the task id from get_action). The task's Action Center status doesn't change; completing or dismissing it stays the person's click.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'taskReadyForReview',
    route: '/dashboard/action-center/actions',
    mcpTool: null,
    specRow: '46',
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      task_id: contentUuid.describe('The task, from get_action.'),
    }),
    run: (ctx, input) => setTaskReadyForReview(input.brand_id, input.task_id, placeOf(ctx)),
    target: (input) => taskName(input.task_id, input.brand_id),
    fixture: { input: { brand_id: BRAND, task_id: ITEM } },
  }),
];
