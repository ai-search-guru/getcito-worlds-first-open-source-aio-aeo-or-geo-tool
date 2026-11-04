/**
 * What a task carries beyond its title (AC-004): where to do it, why, how,
 * when it counts as done, what kind of work it is and what it takes; and
 * (AC-010) the exact page, the change to make there, and how we check it's
 * done.
 *
 * A task sent from the Improve tab (PROMPT-004) also carries its body,
 * platform and evidence; both shapes live in `action_tasks.details` and are
 * read through `parseTaskDetails`, so a row written by either, or by neither,
 * never breaks the drawer or the exports.
 */

/** The kinds of work a task can be (AC-004). */
export const TASK_TYPES = ['content', 'on_page', 'technical', 'outreach', 'pr', 'product'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/**
 * How we check a task is done (AC-010): the page fetched again (or a Site
 * Audit), the prompts run again, or the person confirms it.
 */
export const TASK_CHECKS = ['auto', 'rerun', 'manual'] as const;
export type TaskCheck = (typeof TASK_CHECKS)[number];

/** The change a task makes (AC-010): the text it replaces (null when it adds), and the new text. */
export type TaskChange = { before: string | null; after: string };

export interface ActionTaskDetails {
  /** Improve (PROMPT-004): the suggestion as the user edited it. */
  body: string | null;
  platform: string | null;
  platformLabel: string | null;
  sources: { type: string; ref: string }[];
  /** The exact page, prompt, platform, domain or competitor. */
  where: string | null;
  /** The exact page the change is made on (AC-010): a path or a full URL. */
  url: string | null;
  /** The change to make there (AC-010). */
  change: TaskChange | null;
  /** The evidence from the action's signals. */
  why: string | null;
  /** The steps, in order. */
  how: string[];
  /** A measurable check. */
  doneWhen: string | null;
  /** How we check it (AC-010). */
  check: TaskCheck | null;
  type: TaskType | null;
  /** An estimate, e.g. "~2h". */
  effort: string | null;
  /** Who would do it, e.g. "Content writer". */
  role: string | null;
  /** Where the task was sent (AC-004): the Content opportunity it became, the webhook. */
  sent: TaskSent;
  /** Its last automatic check (AC-010): when, whether it passed, and what was missing. */
  lastCheck: TaskLastCheck | null;
}

/** What an automatic check (AC-010) found, as the server keeps it (taskChecks.js). */
export interface TaskLastCheck {
  at: string;
  passed: boolean;
  /** Codes, worded by en.json actionCenter.taskCheckMissing. */
  missing: string[];
}

export interface TaskSent {
  content: { opportunityId: string; at: string | null } | null;
  webhook: { at: string } | null;
}

/** The fields a person edits in the drawer. */
export interface TaskDetailsEdit {
  url: string;
  where: string;
  why: string;
  /** The change's text before and after; an empty after clears the change. */
  before: string;
  after: string;
  how: string[];
  doneWhen: string;
  check: TaskCheck | null;
  type: TaskType | null;
  effort: string;
  role: string;
}

/** How long each field may be. Steps are lines of one list. */
export const TASK_DETAIL_LIMITS = {
  url: 500,
  where: 300,
  change: 1000,
  why: 600,
  step: 300,
  steps: 8,
  doneWhen: 300,
  effort: 40,
  role: 60,
} as const;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && (TASK_TYPES as readonly string[]).includes(value);
}

export function isTaskCheck(value: unknown): value is TaskCheck {
  return typeof value === 'string' && (TASK_CHECKS as readonly string[]).includes(value);
}

function parseChange(raw: unknown): TaskChange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const after = text(c.after);
  return after ? { before: text(c.before), after } : null;
}

/**
 * A task's details as stored, read defensively: any field may be missing or
 * of the wrong type. Null when there is nothing to show.
 */
export function parseTaskDetails(raw: unknown): ActionTaskDetails | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const sent = (r.sent && typeof r.sent === 'object' ? r.sent : {}) as Record<string, unknown>;
  const content = (sent.content ?? {}) as Record<string, unknown>;
  const webhook = (sent.webhook ?? {}) as Record<string, unknown>;
  const details: ActionTaskDetails = {
    body: text(r.body),
    platform: text(r.platform),
    platformLabel: text(r.platformLabel),
    sources: (Array.isArray(r.sources) ? r.sources : [])
      .map((source) => {
        const s = (source ?? {}) as Record<string, unknown>;
        return { type: text(s.type) ?? '', ref: text(s.ref) ?? '' };
      })
      .filter((source) => source.type && source.ref),
    where: text(r.where),
    url: text(r.url),
    change: parseChange(r.change),
    why: text(r.why),
    how: (Array.isArray(r.how) ? r.how : [])
      .map(text)
      .filter((step): step is string => step !== null),
    doneWhen: text(r.doneWhen),
    check: isTaskCheck(r.check) ? r.check : null,
    type: isTaskType(r.type) ? r.type : null,
    effort: text(r.effort),
    role: text(r.role),
    sent: {
      content: text(content.opportunityId)
        ? { opportunityId: text(content.opportunityId)!, at: text(content.at) }
        : null,
      webhook: text(webhook.at) ? { at: text(webhook.at)! } : null,
    },
    lastCheck: parseLastCheck(r.autoCheck),
  };
  return hasTaskDetails(details) ? details : null;
}

/**
 * A library task's details with its template's Done when (AC-010) when it
 * has none of its own, in the reader's language (en.json
 * actionCenter.taskDoneWhen): `doneWhenOf` reads it by task key, null
 * without one.
 */
export function withTemplateDoneWhen(
  details: ActionTaskDetails | null,
  taskKey: string | null,
  doneWhenOf: (taskKey: string) => string | null,
): ActionTaskDetails | null {
  if (details?.doneWhen || !taskKey) return details;
  const doneWhen = doneWhenOf(taskKey);
  if (!doneWhen) return details;
  return details ? { ...details, doneWhen } : parseTaskDetails({ doneWhen });
}

/**
 * An edit with the template's Done when left as it was, given back as none
 * (AC-010): it stays the template's, in the reader's language, as an
 * unchanged title does. `stored` is the task's own details, `shown` them
 * with the template's (withTemplateDoneWhen).
 */
export function withoutTemplateDoneWhen<T extends TaskDetailsEdit>(
  edit: T,
  stored: ActionTaskDetails | null,
  shown: ActionTaskDetails | null,
): T {
  const template = !stored?.doneWhen ? shown?.doneWhen : null;
  return template && edit.doneWhen.trim() === template ? { ...edit, doneWhen: '' } : edit;
}

function parseLastCheck(raw: unknown): TaskLastCheck | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const at = text(c.at);
  if (!at || typeof c.passed !== 'boolean') return null;
  const missing = Array.isArray(c.missing)
    ? c.missing.filter((code): code is string => typeof code === 'string' && code.length > 0)
    : [];
  return { at, passed: c.passed, missing };
}

/** Whether any field says something. */
export function hasTaskDetails(details: ActionTaskDetails): boolean {
  return (
    details.body !== null ||
    details.platformLabel !== null ||
    details.sources.length > 0 ||
    details.sent.content !== null ||
    details.sent.webhook !== null ||
    details.lastCheck !== null ||
    hasTaskSpec(details)
  );
}

/** Whether the AC-004 and AC-010 fields say something; the Improve ones aside. */
export function hasTaskSpec(details: ActionTaskDetails): boolean {
  return (
    details.url !== null ||
    details.where !== null ||
    details.why !== null ||
    details.change !== null ||
    details.how.length > 0 ||
    details.doneWhen !== null ||
    details.check !== null ||
    details.type !== null ||
    details.effort !== null ||
    details.role !== null
  );
}

const clip = (value: string, max: number): string | null => {
  const trimmed = value.trim().slice(0, max).trim();
  return trimmed || null;
};

/**
 * Whether a value has an edit's shape. A server action takes whatever the
 * client sends, so the shape is checked before anything is read or written.
 */
export function isTaskDetailsEdit(value: unknown): value is TaskDetailsEdit {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const strings = ['url', 'where', 'why', 'before', 'after', 'doneWhen', 'effort', 'role'] as const;
  return (
    strings.every((key) => typeof v[key] === 'string') &&
    Array.isArray(v.how) &&
    v.how.every((step) => typeof step === 'string') &&
    (v.check === null || isTaskCheck(v.check)) &&
    (v.type === null || isTaskType(v.type))
  );
}

/**
 * An edit as it is stored: trimmed, cut to length, blank steps dropped and
 * the list capped. Empty fields are stored as null, so clearing a field
 * clears it.
 */
export function cleanTaskDetailsEdit(
  edit: TaskDetailsEdit,
): Pick<
  ActionTaskDetails,
  'url' | 'where' | 'why' | 'change' | 'how' | 'doneWhen' | 'check' | 'type' | 'effort' | 'role'
> {
  const after = clip(edit.after, TASK_DETAIL_LIMITS.change);
  return {
    url: clip(edit.url, TASK_DETAIL_LIMITS.url),
    where: clip(edit.where, TASK_DETAIL_LIMITS.where),
    why: clip(edit.why, TASK_DETAIL_LIMITS.why),
    change: after ? { before: clip(edit.before, TASK_DETAIL_LIMITS.change), after } : null,
    how: edit.how
      .map((step) => clip(step, TASK_DETAIL_LIMITS.step))
      .filter((step): step is string => step !== null)
      .slice(0, TASK_DETAIL_LIMITS.steps),
    doneWhen: clip(edit.doneWhen, TASK_DETAIL_LIMITS.doneWhen),
    check: isTaskCheck(edit.check) ? edit.check : null,
    type: isTaskType(edit.type) ? edit.type : null,
    effort: clip(edit.effort, TASK_DETAIL_LIMITS.effort),
    role: clip(edit.role, TASK_DETAIL_LIMITS.role),
  };
}

/**
 * The library tasks the API checks on their page (AC-010): its CHECKS'
 * keys (backend/src/lib/action-center/taskChecks.js). Change both together.
 */
export const PAGE_CHECKED_TASKS: readonly string[] = [
  'publish_content',
  'fix_broken_target',
  'fix_structured_data',
  'fix_crawler_access',
  'optimize_content',
  'refresh_content',
  'strengthen_reference_asset',
  'strengthen_entity_content',
];

/**
 * Whether Check now can check a task here, as the API's checkKind reads it:
 * checked Automatic, with a page, and a library task it checks on its page
 * or a written one with its new text. A Site Audit fix is checked by the
 * next audit instead. A shopping links action's task (`actionKind`
 * 'shopping_links') is checked on its draft by the shopping check, with no
 * new text to look for.
 */
export function pageCheckable(
  task: {
    taskKey: string | null;
    details: ActionTaskDetails | null;
  },
  actionKind?: string,
): boolean {
  const d = task.details;
  if (d?.check !== 'auto' || !d.url?.trim()) return false;
  if (task.taskKey) return PAGE_CHECKED_TASKS.includes(task.taskKey);
  return actionKind === 'shopping_links' || Boolean(d.change?.after);
}

/**
 * The library tasks a person confirms (AC-010): their template's check is
 * Manual (backend/src/lib/action-center/tasks/templates.js). Change both
 * together.
 */
export const MANUAL_TASKS: readonly string[] = [
  'improve_cta_path',
  'create_content_brief',
  'create_content_draft',
  'prepare_outreach',
  'execute_outreach',
  'prepare_contribution',
  'track_third_party_status',
  'validate_third_party_presence',
];

/**
 * A library task's details with How we check as its template has it now: a
 * task planned while its template was Automatic (improve_cta_path, made
 * Manual 2026-10-28) keeps check 'auto', which no check reads any more, and
 * reads as Manual, as its Done when says, with no Last check: what a
 * re-fetch found isn't how it's done now. Check now goes too
 * (pageCheckable).
 */
export function withTemplateCheck(
  details: ActionTaskDetails | null,
  taskKey: string | null,
): ActionTaskDetails | null {
  if (details?.check !== 'auto' || !taskKey || !MANUAL_TASKS.includes(taskKey)) return details;
  return { ...details, check: 'manual', lastCheck: null };
}
