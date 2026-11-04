/**
 * The events a Chat run streams to the browser (CHAT-00 "Streaming events",
 * CHAT-03, CHAT-25 §12). One run writes one answer; the browser draws its
 * steps, text, cards and end from these events only.
 *
 * What a customer's browser never gets (CHAT-00 principle 3, CHAT-03 items
 * 22–23, DECISIONS R), held twice: by the payload types below, which have no
 * field for any of it (ChatForbiddenKey), and by chatEvent(), which every
 * event the stream sends goes through. It refuses
 *   - a tool's name, its input, output or result, a debug record, tokens or
 *     latency;
 *   - an id field (`id`, `…Id`, `…_id`);
 *   - a money field: usage is a percent of the monthly AI limit;
 *   - a link that isn't a plain path in the app (`href`, ChatHref);
 * and shows a uuid in any other text as "…" (an id is never shown, CHAT-03
 * item 5), so a page path or a link the person pasted never stops the run.
 * A step is named by its place in the run (`n`, from 1), which is also how a
 * question or an approval points at its step; a reconnect resumes after the
 * last event's `seq`.
 *
 * Adding an event is one entry in ChatEventPayloads and one in EVENT_TYPES
 * (the compiler asks for both). The browser skips a type it doesn't know
 * (isChatEventType), so a newer server never breaks an open page.
 */

import type { KeyFailureClass } from '@/lib/agent/keyErrors';
import type { AiProvider } from '@/lib/agent/providers';
import type { ChatWhy } from './why/view';

// ─── Steps ──────────────────────────────────────────────────────────────────

/**
 * What a step does (CHAT-03 "Labels by kind"; `execute`, CHAT-03 v2, waits on
 * the person's click). The database lists the same kinds in chat_step_kinds
 * (00400); a new kind goes in both.
 */
export const CHAT_STEP_KINDS = [
  'thinking',
  'read',
  'open_page',
  'skill',
  'check',
  'write',
  'ask',
  'schedule',
  'image',
  'execute',
] as const;
export type ChatStepKind = (typeof CHAT_STEP_KINDS)[number];

/** pending: in a plan, not started; waiting: on the person (chat_run_steps.status). */
export const CHAT_STEP_STATUSES = [
  'pending',
  'running',
  'waiting',
  'done',
  'error',
  'skipped',
] as const;
export type ChatStepStatus = (typeof CHAT_STEP_STATUSES)[number];

/** What a read covered, in the app's words: never ids (CHAT-03 item 5). */
export interface ChatStepScope {
  /** "Pricing prompts" */
  subject?: string;
  /** "Last 30 days", "1–15 Oct", "All time" */
  dateRange?: string;
  /** Display names: "ChatGPT", "Perplexity". */
  platforms?: string[];
  /** Only when the read isn't for the chat's brand. */
  brand?: string;
  /** What rowCount counts when it isn't rows: saved notes ("Memory · 3 items", CHAT-14 item 17). */
  unit?: 'items';
}

/** A step as the browser sees it: the label registry's words, never the tool. */
export interface ChatStep {
  /** Its place in the run, from 1. */
  n: number;
  kind: ChatStepKind;
  status: ChatStepStatus;
  /** "Read Citations" */
  label: string;
  /** "Pricing prompts · Last 30 days · ChatGPT, Perplexity · 42 rows", or an error's plain reason. */
  detail?: string;
  scope?: ChatStepScope;
  rowCount?: number;
  /** The newest data the read used, ISO (CHAT-20 §15a). */
  dataAsOf?: string;
}

// ─── Cards ──────────────────────────────────────────────────────────────────

/**
 * Where a card's Open goes: a path in the app, under /dashboard/, with no
 * host, query or fragment ("/dashboard/content/editor/{draft}"). The one
 * field that may name a record, since the app's own routes do; checked by
 * chatEvent().
 */
export type ChatHref = `/dashboard/${string}`;

/** One choice on a question card (CHAT-00 `ask`, CHAT-07). */
export interface ChatAskOption {
  label: string;
  detail?: string;
  recommended?: boolean;
  /** A model's multiplier against Auto (1, 2, 4): never a price. */
  costMultiplier?: number;
}

/** A question card; the run waits on it (CHAT-07). */
export interface ChatAsk {
  /** The step that waits for the answer. */
  n: number;
  question: string;
  options: ChatAskOption[];
  allowOther: boolean;
  multi: boolean;
  /** Its place among the questions asked together ("1 of 2"), when there are more. */
  batch?: { at: number; of: number };
  /** What comes after the answer: "Then I'll write the FAQ draft". */
  then?: string;
}

/**
 * A change waiting for the person's OK (CHAT-00 `confirm.required`). The
 * spec's "tool" is the action in words here: the browser never gets a
 * tool's name.
 */
export interface ChatConfirm {
  /** The step that waits for the OK. */
  n: number;
  /** "Add 12 prompts to tracking" */
  action: string;
  /** "Pricing · Northwind CRM" */
  target: string;
  /**
   * What the approval is bound to: a hash of the exact arguments on the card
   * (CHAT-20 §6). Approve sends it back; arguments that changed since are
   * refused (`approval_mismatch`) and the card is shown again.
   */
  digest: string;
  /** offerDontAskAgain: the card may offer "Don't ask again" (CHAT-20 §5 step 6). */
  canDontAskAgain: boolean;
  /** A change with no Undo once made (CHAT-20 §9: a page sent to a CMS, an audit): the card says so. */
  noUndo?: true;
  /** What the change leaves behind, under the card ("Its timeline … doesn't come back"). */
  note?: string;
  /**
   * What it carries, line by line: the tasks Send to Action Center creates
   * (CHAT-09 item 18), each with its new text in full (`body`).
   */
  items?: { title: string; detail?: string; body?: string }[];
  /** Why the change: the finding. */
  why?: string;
  /** What it aims at. */
  goal?: string;
  /** What it is about, by kind, in the person's words: frozen once it's made. */
  targets?: { kind: 'prompts' | 'pages' | 'competitors' | 'platforms'; values: string[] }[];
  /**
   * An editable card (CHAT-12 item 7; W3-02): its fields, as the change
   * would be made. Its button sends the edited values with the Approve; the
   * server checks them against the change's own rules before it runs.
   */
  form?: ChatConfirmForm;
}

/** A field of an editable card: its value as the card shows it. */
export interface ChatFormField {
  /** Its name in the values the card sends back: never an id. */
  name: string;
  kind: 'text' | 'textarea' | 'choice' | 'toggle';
  label: string;
  value: string | boolean;
  /** The longest text it takes. */
  maxLength?: number;
  /**
   * A choice's options, in order; `disabled`: shown, but not the person's to
   * pick (a memory's scope their role doesn't change, W3-12a).
   */
  options?: { value: string; label: string; disabled?: boolean }[];
  /** The line under it: "Every Monday, 09:00 · Europe/Istanbul · Next: Mon 9 Nov, 09:00". */
  hint?: string;
  /** A text that can't be left empty. */
  required?: boolean;
}

/**
 * An editable card's form (a schedule's, and later a skill's and a
 * memory's): its fields, its button ("Create schedule") and the lines under
 * them ("Runs on Auto · Normal").
 */
export interface ChatConfirmForm {
  /** What it makes: the browser helps with its fields as the person types (a schedule's When). */
  kind: 'schedule' | 'skill' | 'memory';
  fields: ChatFormField[];
  submit: string;
  notes?: string[];
  /** The time zone its times are read in (a schedule's). */
  zone?: string;
}

/**
 * What a change sent to the Action Center (CHAT-09 item 19): a new action,
 * or a finding added to one that already covered it, with Open in Actions.
 */
export interface ChatActionSent {
  kind: 'action_created' | 'action_added';
  /** "AC-1271" */
  actionNo: number;
  /** The new action's title, or the finding added. */
  title: string;
  href: ChatHref;
}

/**
 * Chat's work on an Action Center task, in the task strip (CHAT-09 §B item
 * 5, chat_task_state 00418): never the task's own Action Center status.
 * Done only once the person completed the task there (item 6).
 */
export type ChatTaskStatus = 'queued' | 'writing' | 'ready_for_review' | 'done';

/** One task in the strip: by its place, never its id. */
export interface ChatTaskRow {
  /** Its place in the strip, from 1. */
  at: number;
  /** The task as the Action Center words it; empty when it has no words. */
  title: string;
  /** Its action's Priority Score (0–100); null before the engine scored it. */
  priority: number | null;
  /** Its action's category, shown as the Action Center names it ("Fix"). */
  category: 'growth' | 'protect' | 'recover' | 'fix' | 'compete' | null;
  status: ChatTaskStatus;
  /** Its action's due date, YYYY-MM-DD, when it has one. */
  due?: string;
}

/** The task strip under a /tasks answer (CHAT-09 §B, mockup #s-work): at most 4 tasks. */
export interface ChatTaskStrip {
  tasks: ChatTaskRow[];
  /** Ready for review or Done: "1 of 3 ready" (CHAT-01 item 7). */
  ready: number;
  total: number;
  /** Its tasks due by the end of this week: "Action Center tasks · 4 due". */
  due: number;
}

/** The rule behind a refusal (CHAT-20 §4c): denial.ts's kinds. */
export type ChatDenialRuleKind = 'brand' | 'workspace' | 'demo' | 'policy' | 'plan' | 'role';

/** What a refusal offers next, as buttons (CHAT-20 §4c part 4): denial.ts's. */
export type ChatDenialNextAction =
  'ask_admin' | 'see_access' | 'upgrade' | 'choose_plan' | 'compare_plans' | 'open_policy';

/**
 * The out-of-permission answer (CHAT-20 §4c): its four parts, built on the
 * server from the precedence's denial (denial.ts), never by the model.
 */
export interface ChatDenialCard {
  /** 1. What was asked: "You asked: Save drafts in Content · Pricing FAQ." */
  asked: string;
  /** 2. Why not, and where the rule is set (null: nowhere to change it). */
  rule: { kind: ChatDenialRuleKind; detail: string; source: string | null };
  /** 3. Who can, by role: "Admins and Managers can do this." */
  whoCan: string;
  /** 4. What to do next. */
  nextActions: ChatDenialNextAction[];
  /** For a plan gate: the plan's name it needs ("Growth"). */
  needsPlan?: string;
}

/** What Chat made (CHAT-00 `file`, CHAT-06). */
export interface ChatDeliverable {
  title: string;
  type: 'document' | 'table' | 'code' | 'image' | 'report';
  /** "md", "docx", "pdf", "csv", "xlsx"… */
  formats: string[];
  status: 'draft' | 'attached' | 'done';
  /** Its card's Open (CHAT-06): the file, or the page's draft in the editor. */
  href?: ChatHref;
  /**
   * Whether it is in Files (CHAT-06 item 9): filed as it was made, or not,
   * the workspace's storage being full (item 29) or filing failing. Its
   * file is the run's n-th deliverable, never named by its id here.
   */
  filed?: 'in_files' | 'storage_full' | 'failed';
  /**
   * The Action Center task it was drafted for (CHAT-09 item 12): "Task:
   * {title}" on its card, with Attach to task & mark done; `done` once
   * Action Center has the task completed. None when that isn't certain.
   */
  task?: { title: string; state: 'open' | 'done' };
}

/**
 * A next move (CHAT-07 §C): a card under the latest answer whose click sends
 * its prompt. In rank order; never its class or a tool.
 */
export interface ChatNextMove {
  /** "Do the same for /features" */
  label: string;
  /** What a click sends as the person's next message. */
  prompt: string;
  /** It continues this run's object: the first one shows as the composer's ghost text. */
  ghost?: boolean;
}

/** The workspace's monthly AI usage, as a percent of its limit (CHAT-04, DECISIONS R). */
export interface ChatUsage {
  percentUsed: number;
  /** This run's share of the monthly limit. */
  runPercent?: number;
}

/** A run's end, for the collapsed step header (CHAT-03 items 9–12). */
export interface ChatRunSummary {
  workingMs: number;
  stepCount: number;
  /** The "Data used" chips: "Citations · 42". */
  sources: { label: string; count: number }[];
}

/**
 * A What's new entry as its card shows it (CHAT-11 item 10): the team's
 * words as approved, never a price. `slug` is the entry's file name, to mark
 * it read when Try it is opened: not an id.
 */
export interface ChatWhatsNewEntry {
  slug: string;
  feature: string;
  lines: string[];
  /** Try it: the feature's page, with the brand open now. */
  href: ChatHref;
  /** "Growth and Enterprise": the plans that include it, when the person's doesn't. */
  onPlans?: string;
}

/** Where a page Chat writes was opened (CHAT-25 §3). */
export type ChatPageWhere = 'chat' | 'here' | 'editor';

// ─── Events ─────────────────────────────────────────────────────────────────

/** Each event's payload, by type. */
export interface ChatEventPayloads {
  'step.started': { step: ChatStep };
  'step.updated': { step: ChatStep };
  'step.finished': { step: ChatStep };
  /** A chunk of the answer's markdown. */
  'text.delta': { text: string };
  /** The whole answer so far, in place of what streamed: rewritten in the question's language. */
  'text.replaced': { text: string };
  'ask.created': ChatAsk;
  'deliverable.created': ChatDeliverable;
  /** A Why did it move analysis the run kept (CHAT-22 §1, "why.ready"): its card's numbers. */
  'why.ready': ChatWhy;
  'confirm.required': ChatConfirm;
  next_moves: { moves: ChatNextMove[] };
  'usage.updated': ChatUsage;
  /** generatedAt and dataAsOf: the answer's "Generated …" and "Data as of …" (CHAT-06 38–39). */
  'run.finished': ChatRunSummary & { generatedAt: string; dataAsOf: string | null };
  /**
   * code: a standard result code (CHAT-20 §11a); the browser shows its words,
   * or `reason`, the server's own plain words when it has them. `own_key`:
   * the workspace's own AI key failed, `keyFailure` saying why and whose
   * (AGENT-OWN-KEY §5.2); `provider_down`: the provider didn't answer.
   */
  'run.error': ChatRunSummary & {
    code: 'failed' | 'timeout' | 'own_key' | 'provider_down';
    reason?: string;
    keyFailure?: { class: KeyFailureClass; provider: AiProvider };
  };
  /**
   * The next step would pass a limit: the month's AI limit (CHAT-04 item
   * 17), or with `limit: 'run'` an agent run's own cap (CHAT-27 item 22).
   */
  'run.paused_cap': ChatRunSummary & { limit?: 'run' | 'month' };
  /**
   * The run stopped before its end (CHAT-03 item 19, "Stopped after …"): the
   * person's Stop, a card left unanswered for 7 days (`expired`), or a
   * triggered agent run at its cap (`limit`, "Stopped at its limit",
   * CHAT-27 item 22), or the Action Center action an agent run worked on
   * closed (`action_closed`, CHAT-21 edge case 7).
   */
  'run.stopped': ChatRunSummary & { reason: 'person' | 'expired' | 'limit' | 'action_closed' };
  /** A call refused: the out-of-permission answer (CHAT-20 §4c). */
  'access.denied': ChatDenialCard;
  /** Sent to Action Center, or added to an action there (CHAT-09 item 19). */
  'action.sent': ChatActionSent;
  /** The task strip as it stands (CHAT-09 §B): the whole strip each time. */
  'tasks.updated': ChatTaskStrip;
  // Editor in Chat (CHAT-25 §12, Phase 4): payloads grow with it.
  /** A new version card of a page Chat writes. */
  'deliverable.updated': ChatDeliverable & { version: number };
  /** Suggestions Chat made on the open page, for the editor to show. */
  'suggestion.created': { count: number };
  'suggestion.resolved': { count: number };
  /** href: the page's draft, in the editor beside the chat or the Content Editor. */
  'page.opened': { where: ChatPageWhere; href?: ChatHref };
  /** What's new's cards under the answer (CHAT-11 item 10). */
  'whats_new.ready': { entries: ChatWhatsNewEntry[] };
}

export type ChatEventType = keyof ChatEventPayloads;

/** One event on the wire: `seq` counts up within the run, from 1. */
export type ChatEvent = {
  [K in ChatEventType]: { type: K; seq: number; data: ChatEventPayloads[K] };
}[ChatEventType];

/** Every type, once: a type missing here, or one that doesn't exist, doesn't compile. */
const EVENT_TYPES: Record<ChatEventType, true> = {
  'step.started': true,
  'step.updated': true,
  'step.finished': true,
  'text.delta': true,
  'text.replaced': true,
  'ask.created': true,
  'deliverable.created': true,
  'why.ready': true,
  'confirm.required': true,
  next_moves: true,
  'usage.updated': true,
  'run.finished': true,
  'run.error': true,
  'run.paused_cap': true,
  'run.stopped': true,
  'access.denied': true,
  'action.sent': true,
  'tasks.updated': true,
  'deliverable.updated': true,
  'suggestion.created': true,
  'suggestion.resolved': true,
  'page.opened': true,
  'whats_new.ready': true,
};

export const CHAT_EVENT_TYPES = Object.keys(EVENT_TYPES) as ChatEventType[];

/** Whether the browser knows this type; it skips one it doesn't. */
export function isChatEventType(type: unknown): type is ChatEventType {
  return typeof type === 'string' && Object.hasOwn(EVENT_TYPES, type);
}

// ─── What never goes to the browser ─────────────────────────────────────────

type Upper =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z';
type LowerOrDigit = Lowercase<Upper> | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type AnyCase<W extends string> = W | Capitalize<W> | Uppercase<W>;

/**
 * The keys no payload may have, as the types see them; chatEvent() refuses
 * the same at run time (FORBIDDEN_KEYS).
 */
export type ChatForbiddenKey =
  // A tool, its call, input, output or result: tool, tools, toolName, tool_name…
  | 'tool'
  | 'tools'
  | `tool${Upper | '_'}${string}`
  | `tools${Upper | '_'}${string}`
  | 'input'
  | 'output'
  | 'args'
  | 'arguments'
  | 'params'
  // A debug record and what it measures.
  | `${string}${AnyCase<'debug' | 'token' | 'latency'>}${string}`
  // Money: dollars, prices, amounts, spend, cost, cents (a cost multiplier is fine).
  | `${string}${AnyCase<'usd' | 'dollar' | 'price' | 'amount' | 'spend'>}${string}`
  | 'cost'
  | 'cent'
  | 'cents'
  | `${string}_${'cost' | 'cent' | 'cents'}`
  | `${string}${LowerOrDigit}${'Cost' | 'Cent' | 'Cents'}`
  // An id.
  | 'id'
  | 'ids'
  | `${string}_${'id' | 'ids'}`
  | `${string}${LowerOrDigit}${'Id' | 'Ids'}`;

/** ChatForbiddenKey at run time: each with what it is. */
const FORBIDDEN_KEYS: [RegExp, string][] = [
  [/^tools?($|[A-Z_])|^(input|output|args|arguments|params)$/, 'a tool or its input or output'],
  [/debug|token|latency/i, 'a debug record'],
  [/usd|dollar|price|amount|spend/i, 'money'],
  [/(^|_)(cost|cents?)$|[a-z0-9](Cost|Cents?)$/, 'money'],
  [/^ids?$|_ids?$|[a-z0-9]Ids?$/, 'an id'],
];

/** A path in the app: /dashboard/ and path characters only — no host, query or fragment. */
const APP_PATH = /^\/dashboard\/[A-Za-z0-9\-._~%/]*$/;

/**
 * Whether an href is a plain path in the app (ChatHref): no `//`, and no
 * `.` or `..` part, written out or encoded, that could step out of /dashboard/.
 */
export function isChatHref(href: unknown): href is ChatHref {
  return (
    typeof href === 'string' &&
    APP_PATH.test(href) &&
    !href.includes('//') &&
    !href
      .split('/')
      .map((part) => part.replace(/%2e/gi, '.'))
      .some((part) => part === '.' || part === '..')
  );
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Text with every uuid in it shown as "…": "/products/…" (CHAT-03 item 5). */
export function maskIds(text: string): string {
  return text.replace(UUID, '…');
}

/**
 * Why this event can't go to a customer's browser: every forbidden key, and
 * every href that isn't a plain path in the app, by path. Empty when it can.
 * A uuid in text isn't a reason: chatEvent() shows it as "…".
 */
export function clientEventProblems(event: ChatEvent): string[] {
  const problems: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        const at = `${path}.${key}`;
        const forbidden = FORBIDDEN_KEYS.find(([pattern]) => pattern.test(key));
        if (forbidden) problems.push(`${at}: ${forbidden[1]}`);
        else if (key === 'href' && item !== undefined && !isChatHref(item)) {
          problems.push(`${at}: not a path in the app`);
        }
        walk(item, at);
      }
    }
  };
  walk(event, 'event');
  return problems;
}

/** A copy with every uuid in its text shown as "…", but for links (href). */
function masked(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key === 'href' ? value : maskIds(value);
  if (Array.isArray(value)) return value.map((item) => masked(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, masked(item, k)]));
  }
  return value;
}

/**
 * An event for the stream to send, made safe: throws on anything
 * clientEventProblems finds — a tool's name, an id field, money, a link out
 * of the app — even from a payload built loosely, and shows every uuid in
 * the text as "…".
 *
 * The answer's own text (`text.delta`) is sent as it is: it is the model's
 * words, which may quote what the person wrote, and a uuid can be split
 * across two chunks, so a chunk can't tell. Keeping ids out of the answer is
 * the engine's, on the whole text.
 */
export function chatEvent<K extends ChatEventType>(
  type: K,
  seq: number,
  data: ChatEventPayloads[K],
): Extract<ChatEvent, { type: K }> {
  const problems = clientEventProblems({ type, seq, data } as ChatEvent);
  if (problems.length > 0) {
    throw new Error(`Chat event "${type}" can't go to the browser: ${problems.join('; ')}`);
  }
  const safe = type === 'text.delta' ? data : masked(data);
  return { type, seq, data: safe } as Extract<ChatEvent, { type: K }>;
}
