import { z } from 'zod';
import type { TeamRole } from '@/components/context/RoleProvider';
import type { Feature, PlanId } from '@/config/plans';
import type { McpAuthContext } from '@/lib/mcpAuth';
import type { ChatConfirmForm } from '../events';

/**
 * Chat's tool registry (CHAT-20 §9): one row per tool Chat may call, saying
 * what it does, who may call it, on which plan and how a call is approved.
 * The same rows feed the model's tool list, the step labels (CHAT-03), the
 * Settings pages (registryCatalog) and the MCP parity checks. A capability
 * without a row isn't available to Chat ("silence = never"), and NEVER has
 * no class here: it is simply no row.
 *
 * A row only describes; the approval precedence that reads it (plan, role,
 * policy, mode) is checked on the server when a run calls the tool
 * (lib/chat/precedence.ts).
 */

/** What a call does (CHAT-20 §3): reads, changes data in GetCito, or goes live / leaves it. */
export const TOOL_CLASSES = ['read', 'write', 'execute'] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];

/**
 * How a call is approved (CHAT-20 §5 step 4 and §9's policy codes): `on` a
 * read runs; `never` an Admin switched it off; `ask` a card in every mode;
 * `ask_full_auto` a card, except in Full auto ("Ask (auto allowed in Full
 * auto)"); `always` runs without a card; `click` an EXECUTE, which only the
 * user's click ever runs.
 */
export const TOOL_POLICIES = ['on', 'never', 'ask', 'ask_full_auto', 'always', 'click'] as const;
export type ToolPolicy = (typeof TOOL_POLICIES)[number];

/** The policies a WRITE row may start at or be raised to, least automatic first. */
export const WRITE_POLICIES = ['ask', 'ask_full_auto', 'always'] as const;
export type WritePolicy = (typeof WRITE_POLICIES)[number];

/**
 * The go-live groups an Admin may switch off for Managers (CHAT-20 §4
 * refinements): publishing, email and outreach, code and pull requests,
 * product feeds. Every EXECUTE row is in one.
 */
export const EXECUTE_GROUPS = ['publishing', 'email_outreach', 'code_prs', 'feeds'] as const;
export type ExecuteGroup = (typeof EXECUTE_GROUPS)[number];

/** The tables whose rows name their brand, for a row whose input names an object, not a brand. */
export const BRAND_LOOKUP_TABLES = [
  'actions',
  'competitors',
  'content_drafts',
  'content_opportunities',
  'prompt_results',
  'prompt_suggestions',
  'site_audits',
  'topics',
] as const;
export type BrandLookupTable = (typeof BRAND_LOOKUP_TABLES)[number];

/**
 * Where a call's brand comes from, so the brand scope and the demo rule see
 * it (CHAT-20 §15b): the input's brand_id, or the brand of the row the
 * input's id names. A row about the person or the workspace (a profile,
 * usage, the brand list) has none: brandOf null.
 */
export type BrandOf = { input: 'brand_id' } | { lookup: BrandLookupTable; idField: string };

/** CHAT-20 §9 cost: C0 no model, C1 a scoped read, C2 a model writing step, C3 heavy. */
export type CostClass = 'C0' | 'C1' | 'C2' | 'C3';

/** The product area a tool belongs to, as "What Chat can do" groups them (CHAT-20 §8). */
export type ToolArea =
  | 'account'
  | 'usage'
  | 'brands'
  | 'visibility'
  | 'prompts'
  | 'topics'
  | 'mentions'
  | 'citations'
  | 'competitors'
  | 'product_visibility'
  | 'ai_traffic'
  | 'site_audit'
  | 'action_center'
  | 'content'
  | 'reports'
  /** Opening a page of the app (CHAT-19 §2). */
  | 'navigation'
  /** Opening a page on the web (CHAT-10 §B). */
  | 'web'
  /** Work Chat does later or on repeat (CHAT-12). */
  | 'scheduling'
  /** The workspace's own skills (CHAT-13). */
  | 'skills'
  /** What Chat remembers between chats (CHAT-14). */
  | 'memory';

/**
 * What the plan decides about a call (CHAT-20 §7), null when nothing. The
 * plan facts come from Billing at run time; self-hosted passes every gate.
 */
export interface PlanGate {
  /** The lowest plan that may call it, of PLAN_ORDER. */
  minPlan?: PlanId;
  /** The plan feature its page checks ("As live page"). */
  feature?: Feature;
  /** Open on every plan, but the data covers only the plan's platforms (allowedScrapers). */
  platforms?: true;
}

export interface ToolFlags {
  /** A WRITE that shows a card in every mode, Full auto included; its policy tops out at Ask. */
  alwaysCard: boolean;
  /**
   * A WRITE with a cost: a card in every mode, which says what it uses
   * before it runs (the month's Site Audit audits). Its policy tops out at Ask.
   */
  costCard: boolean;
  /** A READ an Admin may switch off for the workspace (CHAT-20 §9 ¹). */
  adminMayTurnOff: boolean;
  /**
   * An EXECUTE an agent an Admin allowed may take live on its own
   * (AUTONOMOUS-GO-LIVE §4, step 4b): set by its `goLive`, never by hand.
   */
  goLiveOnOwn: boolean;
}

/** What a step that goes live on its own sends (chat_agent_go_live_events, 00443). */
export interface GoLiveStep {
  kind: 'cms_draft' | 'publish' | 'webhook';
  /** The Library draft that goes out: an id of the run's brand. */
  draftId: string;
  /** Where to: a CMS the brand connected, or its webhook, never an address from the input. */
  target: 'webflow' | 'wordpress' | 'framer' | 'wix' | 'webhook';
}

/**
 * Where a WRITE runs, for a row that records it on what it changes (CHAT-20
 * §10a layer 1: Action History's conversation, run and execution.mode): the
 * chat and run, the approval's key (the run step that asked for it, one per
 * approval) and how it was approved. Set by runLoggedWrite; absent on a read.
 */
export interface ChatWritePlace {
  conversationId: string | null;
  runId: string | null;
  /** The agent run the chat is (CHAT-27): its drafts are made by an agent (00463). */
  agentRunId?: string | null;
  approvalKey: string;
  /** assisted: the person approved it (a card, a click); automated: it ran by itself. */
  executionMode: 'assisted' | 'automated';
}

/**
 * Who a tool acts as: the signed-in user, resolved into the shape the MCP
 * data functions scope by (lib/agent/auth.ts resolveAgentAuth), and, for a
 * WRITE, where it runs. A page read (fetch_page) gets the run's sites too,
 * which its redirects must stay on: the engine's, never the model's.
 */
export type ChatToolContext = McpAuthContext & {
  chat?: ChatWritePlace;
  pageSites?: { hosts: readonly string[]; domains: readonly string[] };
  /** The run's time zone (the person's): what a schedule's date phrase is read in. */
  timezone?: string;
};

/**
 * What an editable card's fields are made and read with: the run's zone,
 * workspace and person (whose role a memory's scopes follow, W3-12a), now.
 */
export interface CardFormContext {
  timezone: string;
  organizationId: string;
  userId: string;
  now: Date;
}

/** The values an editable card sends back with its Approve, by field name. */
export type CardFormValues = Record<string, string | boolean>;

/** A line of what a card's change carries (the approval card's items): a task to create. */
export interface ToolCardItem {
  title: string;
  detail?: string;
  /** Its new text in full (a task's change.after): the card shortens it, with Show all. */
  body?: string;
}

/** The run a card is read for: its workspace, the only one its words may come from. */
export interface ToolCardRun {
  organizationId: string;
}

/** What a card's targets are, by kind: the browser names each kind from en.json. */
export type ToolCardTargetKind = 'prompts' | 'pages' | 'competitors' | 'platforms';

/**
 * What a card shows of a change beyond its target (CHAT-09 item 18: what is
 * frozen when it's made): its items, why, goal and targets.
 */
export interface ToolCardDetails {
  items?: ToolCardItem[];
  why?: string;
  goal?: string;
  targets?: { kind: ToolCardTargetKind; values: string[] }[];
}

/**
 * What a change made, shown under the answer with its Open (CHAT-09 item
 * 19): an action sent to the Action Center, or a finding added to one.
 */
export interface ToolResultCard {
  kind: 'action_created' | 'action_added';
  /** The action's number: "AC-1271". */
  actionNo: number;
  title: string;
  /** Open in Actions. */
  href: `/dashboard/${string}`;
}

interface ToolFields<S extends z.ZodObject> {
  /** The internal name. Never shown to customers: steps show the label (CHAT-03). */
  name: string;
  area: ToolArea;
  /** What the model reads to pick the tool. */
  description: string;
  /** The lowest role that may call it: `analyst` means every role (CHAT-20 §20). */
  minRole: TeamRole;
  /**
   * Roles left out of a row open to every role, where the server and the
   * database refuse them (an Agency partner dismissing a prompt suggestion).
   * Never an Admin.
   */
  excludeRoles?: readonly TeamRole[];
  planGate: PlanGate | null;
  /** Where a call's brand comes from; null for a row about no brand. */
  brandOf: BrandOf | null;
  /**
   * A row about no brand whose answer names every brand the person can
   * access (the brand list, the connections): a chat it runs in has touched
   * each of them (lib/chat/touchedBrands.ts, 00436).
   */
  namesBrands?: true;
  costClass: CostClass;
  /**
   * The key under `chatTools` in messages/en.json (`name` for Settings, `step`
   * for CHAT-03), and the row's key in the browser's catalog.
   */
  labelKey: string;
  /** The page in the app that shows the same thing (CHAT-19), or null. */
  route: string | null;
  /** The GetCito MCP Server tool that does the same work, or null. */
  mcpTool: string | null;
  /** Its row in CHAT-20 §9. */
  specRow: string;
  inputSchema: S;
  run(ctx: ChatToolContext, input: z.output<S>): Promise<unknown>;
  /**
   * A WRITE that can also run with no session behind it (a schedule's or a
   * signal's run, CHAT-12), where `run`'s server action has no one signed in.
   * Its runFor makes the same change as the run's person, with the service
   * role, after checking them as their session would be checked
   * (lib/chat/actor). The engine calls it in such a run once the precedence
   * lets the change go (runLoggedWrite's withoutSession), and `run` otherwise.
   */
  sessionFree?: true;
  runFor?(ctx: ChatToolContext, input: z.output<S>): Promise<unknown>;
  /**
   * An EXECUTE an allowed agent may take live on its own (AUTONOMOUS-GO-LIVE
   * §4): what its step sends, from its input. The engine reserves its slot
   * and the API sends it as the run's person (PR 4's internal route); `run`
   * stays the person's click. Its input takes ids and fixed choices only,
   * so a target comes from the workspace's data, never from text (§6.3 B1).
   */
  goLive?(input: z.output<S>): GoLiveStep;
  /**
   * A sessionFree row whose runFor writes through the API server as its
   * person (lib/chat/actor/api.ts): whether that way is open now
   * (CHAT_ACTING_SECRET set). Closed, the row asks first in a run with no
   * session, as a row without runFor does. Without it, always open.
   */
  runForOpen?(): boolean;
  /** A sessionFree row's precheck for a run with no session: the same check, as its person. */
  precheckFor?(ctx: ChatToolContext, input: z.output<S>): Promise<unknown>;
  /**
   * A batch row (CHAT-20 §11b: add_prompts, add_competitors, pausing
   * prompts): the input field holding its items. A run's cap counts the
   * items, not the calls (§14), and a call with more than `askAbove` of them
   * shows a card in every mode (§9 row 22: "> 5 prompts: Ask").
   */
  batch?: { field: string; askAbove?: number };
  /**
   * What its card and step name as the target when the input's own words
   * don't (a list, an id): read from the data if need be, in the person's
   * words. Without it the engine reads the input's title, name or text.
   * `run`: the run's workspace, the only one it may read from.
   */
  target?(input: z.output<S>, run: ToolCardRun): string | null | Promise<string | null>;
  /**
   * What a call made, for the answer's output card and Files (CHAT-06
   * items 1, 9): filed as it is made. Null when the call made nothing to
   * file; a row without it makes nothing.
   */
  deliverable?(input: z.output<S>, output: unknown): ToolDeliverable | null;
  /**
   * A WRITE's check before its card or its run (CHAT-20 §12 rule 1: Send to
   * Action Center's duplicate check): a refusal it returns ({ ok: false,
   * reason, message }) answers the call, with no card and nothing changed;
   * anything else lets it go on. A check that fails lets it go on too: the
   * change checks again.
   */
  precheck?(ctx: ChatToolContext, input: z.output<S>): Promise<unknown>;
  /**
   * What its card shows beyond the target, read in the person's words where
   * the input has ids: an action's tasks, why, goal and targets. `run` as
   * for `target`.
   */
  cardDetails?(input: z.output<S>, run: ToolCardRun): ToolCardDetails | Promise<ToolCardDetails>;
  /**
   * A call this input makes shows its card in every mode, Full auto too:
   * a choice that is the person's (Create anyway, CHAT-09 item 18a).
   */
  alwaysCardWhen?(input: z.output<S>): boolean;
  /** What it made, as a card with its Open (CHAT-09 item 19); null when nothing. */
  resultCard?(input: z.output<S>, output: unknown): ToolResultCard | null;
  /**
   * The kind of step its card and its change are (CHAT-03): `schedule` for a
   * job Chat schedules. Without it, a write's step is `write`.
   */
  stepKind?: 'schedule';
  /**
   * An editable card (ChatConfirm.form; W3-02): its fields, read from the
   * input, and the input the person's edited values make, or why they make
   * none. The engine checks what `apply` makes against the input schema
   * again before the change runs: what runs is what the card was sent with.
   */
  form?: {
    fields(input: z.output<S>, ctx: CardFormContext): ChatConfirmForm | Promise<ChatConfirmForm>;
    apply(
      input: z.output<S>,
      values: CardFormValues,
      ctx: CardFormContext,
    ): { ok: true; input: Record<string, unknown> } | { ok: false; error: string };
  };
  /** Its step once the change is made ("Scheduled: Weekly report"), when its words say more than the row's. */
  doneStep?(input: z.output<S>, output: unknown): { label: string; detail?: string } | null;
  /** A valid input, for the registry's tests and the permission fixtures (CHAT-20 §19). */
  fixture: { input: z.input<S> };
}

/** Something a call made (CHAT-06 item 1): its card, and the file kept for it. */
export interface ToolDeliverable {
  title: string;
  type: 'document' | 'table' | 'code' | 'image' | 'report';
  /** The formats it downloads in, its main one first. */
  formats: string[];
  /** Its canonical content, its type and its object's name in Files. */
  body: string;
  mimeType: string;
  fileName: string;
  /** Its card's Open: an app page (the Content Editor's draft). */
  href?: `/dashboard/${string}`;
  /** The Content draft it is ("Used in Content draft"). */
  contentDraftId?: string;
}

type ClassFields =
  | { class: 'read'; flags?: Partial<Pick<ToolFlags, 'adminMayTurnOff' | 'costCard'>> }
  | {
      class: 'write';
      defaultPolicy: WritePolicy;
      maxPolicy: WritePolicy;
      flags?: Partial<Pick<ToolFlags, 'alwaysCard' | 'costCard'>>;
    }
  | {
      class: 'execute';
      /**
       * Its go-live group, which the Manager switch in Settings › Chat covers.
       * Null for one that only takes back what went out (unpublish_cms,
       * AUTONOMOUS-GO-LIVE PR 10): outside every group, it never goes out on
       * its own, and a Manager may even while publishing is off for Managers.
       */
      executeGroup: ExecuteGroup | null;
      flags?: Partial<Pick<ToolFlags, 'costCard'>>;
    };

export type ToolDefinition<S extends z.ZodObject> = ToolFields<S> & ClassFields;

export type ChatTool<S extends z.ZodObject = z.ZodObject> = Omit<ToolFields<S>, 'excludeRoles'> & {
  /** Roles left out of the row; empty for most. */
  excludeRoles: readonly TeamRole[];
  class: ToolClass;
  defaultPolicy: ToolPolicy;
  maxPolicy: ToolPolicy;
  flags: ToolFlags;
  /** An EXECUTE's go-live group; null on a read or a write. */
  executeGroup: ExecuteGroup | null;
};

/** Ids for the rows' fixtures: any 8-4-4-4-12 hex id passes the inputs' uuid check. */
export const FIXTURE_IDS = {
  brand: '11111111-1111-4111-8111-111111111111',
  item: '22222222-2222-4222-8222-222222222222',
} as const;

const writeRank = (policy: WritePolicy) => WRITE_POLICIES.indexOf(policy);

/** Text a go-live row's field must refuse: a page's address, a mail address, a site. */
const FREE_TARGETS = ['https://example.com/page', 'someone@example.com', 'example.com'];

/**
 * Whether an input field can only name something of the workspace's: a
 * fixed choice (an enum, a literal, a switch), or an id that refuses an
 * address, a mail address or a site. A list or an object never.
 */
function holdsNoFreeTarget(field: z.ZodType): boolean {
  let inner: z.ZodType = field;
  while (
    inner instanceof z.ZodOptional ||
    inner instanceof z.ZodDefault ||
    inner instanceof z.ZodNullable
  ) {
    inner = inner.unwrap() as z.ZodType;
  }
  if (
    inner instanceof z.ZodEnum ||
    inner instanceof z.ZodLiteral ||
    inner instanceof z.ZodBoolean
  ) {
    return true;
  }
  return (
    inner.safeParse(FIXTURE_IDS.item).success &&
    FREE_TARGETS.every((text) => !inner.safeParse(text).success)
  );
}

/**
 * A registry row, with the rules every row keeps checked as it is defined:
 * a READ runs (`on`), an EXECUTE is always a click, and a WRITE's default
 * never goes past its maximum, which an `always_card` WRITE keeps at Ask.
 */
export function defineTool<S extends z.ZodObject>(def: ToolDefinition<S>): ChatTool<S> {
  const flags: ToolFlags = {
    alwaysCard: false,
    costCard: false,
    adminMayTurnOff: false,
    ...def.flags,
    goLiveOnOwn: def.goLive !== undefined,
  };
  if (def.brandOf) {
    const field = 'input' in def.brandOf ? def.brandOf.input : def.brandOf.idField;
    if (!(field in def.inputSchema.shape)) {
      throw new Error(`${def.name}: its brand comes from ${field}, which its input lacks`);
    }
  }
  if (def.namesBrands && def.brandOf) {
    throw new Error(`${def.name}: a row about one brand doesn't name every brand`);
  }
  if (def.batch && !(def.batch.field in def.inputSchema.shape)) {
    throw new Error(`${def.name}: its items are in ${def.batch.field}, which its input lacks`);
  }
  if ((def.sessionFree === true) !== (def.runFor !== undefined)) {
    throw new Error(`${def.name}: a session-free row has its runFor, and only it`);
  }
  if ((def.runForOpen || def.precheckFor) && !def.sessionFree) {
    throw new Error(`${def.name}: only a session-free row says when its runFor runs`);
  }
  if (def.precheckFor && !def.precheck) {
    throw new Error(`${def.name}: a precheck for a run without a session has its precheck`);
  }
  // A read already reads as the person (the MCP functions); an EXECUTE waits for their click.
  if (def.sessionFree && def.class !== 'write') {
    throw new Error(`${def.name}: only a write runs for its person without a session`);
  }
  // Going live on its own: an EXECUTE's, whose input can't name an outside target (§6.3 B1).
  if (def.goLive) {
    if (def.class !== 'execute')
      throw new Error(`${def.name}: only an execute goes live on its own`);
    const free = Object.entries(def.inputSchema.shape).find(
      ([, field]) => !holdsNoFreeTarget(field as z.ZodType),
    );
    if (free) {
      throw new Error(
        `${def.name}: a row that goes live on its own takes no free text (${free[0]})`,
      );
    }
  }
  const excludeRoles = [...(def.excludeRoles ?? [])];
  if (excludeRoles.length > 0 && (def.minRole !== 'analyst' || excludeRoles.includes('admin'))) {
    throw new Error(`${def.name}: only a row open to every role leaves roles out, never an Admin`);
  }
  if (def.class === 'read') {
    if (flags.alwaysCard) throw new Error(`${def.name}: a read has no approval card`);
    return {
      ...def,
      defaultPolicy: 'on',
      maxPolicy: 'on',
      flags,
      excludeRoles,
      executeGroup: null,
    };
  }
  if (flags.adminMayTurnOff) throw new Error(`${def.name}: only a read is switched off`);
  if (def.class === 'execute') {
    if (flags.alwaysCard) throw new Error(`${def.name}: an execute is a click, not a card`);
    // Its type has no policy fields; one passed anyway can only ask for less than a click.
    if (
      ('defaultPolicy' in def && def.defaultPolicy !== 'click') ||
      ('maxPolicy' in def && def.maxPolicy !== 'click')
    ) {
      throw new Error(`${def.name}: an execute always needs the user's click`);
    }
    if (def.executeGroup === null) {
      if (def.goLive) throw new Error(`${def.name}: an execute outside the groups never goes live`);
    } else if (!EXECUTE_GROUPS.includes(def.executeGroup)) {
      throw new Error(`${def.name}: an execute belongs to a go-live group`);
    }
    return { ...def, defaultPolicy: 'click', maxPolicy: 'click', flags, excludeRoles };
  }
  if (def.class !== 'write') throw new Error('A tool is a read, a write or an execute');
  if (!WRITE_POLICIES.includes(def.defaultPolicy) || !WRITE_POLICIES.includes(def.maxPolicy)) {
    throw new Error(`${def.name}: a write is asked, asked unless Full auto, or always`);
  }
  if (writeRank(def.defaultPolicy) > writeRank(def.maxPolicy)) {
    throw new Error(`${def.name}: its default policy is past its maximum`);
  }
  if ((flags.alwaysCard || flags.costCard) && def.maxPolicy !== 'ask') {
    throw new Error(`${def.name}: an always_card or cost_card write never runs without a card`);
  }
  return { ...def, flags, excludeRoles, executeGroup: null };
}

/**
 * Whether a row makes its change in a run with no session behind it now: a
 * sessionFree row whose runFor's way is open (runForOpen). Any other asks
 * first in such a run (engine.ts askWithoutSession).
 */
export function runsWithoutSession(tool: Pick<ChatTool, 'sessionFree' | 'runForOpen'>): boolean {
  return tool.sessionFree === true && (tool.runForOpen?.() ?? true);
}

/** How many items a call carries: its batch's length, or 1 for a row that isn't a batch. */
export function batchSize(tool: Pick<ChatTool, 'batch'>, input: Record<string, unknown>): number {
  if (!tool.batch) return 1;
  const items = input[tool.batch.field];
  return Array.isArray(items) ? items.length : 1;
}

/**
 * A call that takes the run past the items its row runs without a card
 * (CHAT-20 §9 row 22), counting those the run's earlier calls of it made
 * (`before`): six pauses of one prompt ask from the sixth.
 */
export function overBatchCard(
  tool: Pick<ChatTool, 'batch'>,
  input: Record<string, unknown>,
  before = 0,
): boolean {
  const above = tool.batch?.askAbove;
  return above !== undefined && before + batchSize(tool, input) > above;
}
