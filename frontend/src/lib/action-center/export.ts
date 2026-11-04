import type { ActionDetail, ActionItem } from '@/lib/actions/actionCenter';
import { toCsv } from '@/lib/csv';
import { assigneeLabel } from '@/lib/action-center/display';
import { withTemplateCheck } from '@/lib/action-center/taskDetails';
import { locationName, platformName } from '@/lib/signals/names';
import { dayIn } from '@/lib/timeZone';
import type { Sheet } from 'write-excel-file/browser';

/**
 * One action, whole, to take out of the app (AC-005): Markdown for the
 * clipboard ("Copy all"), a CSV with a `section` column, and an Excel
 * workbook with a sheet per section.
 *
 * The drawer first resolves every label in the reader's language into an
 * `ActionExport`, with what each of its tabs shows; the formats below only lay
 * it out, so the three always say the same thing.
 */

/** A labelled fact; a list is shown as one, a single value inline. */
export interface ExportFact {
  label: string;
  value: string | string[];
}

export interface ActionExport {
  /** "AC-52". */
  ref: string;
  title: string;
  /** "94 (Critical)" and "Why this priority?"; null before the action is scored. */
  priority: { label: string; why: string } | null;
  category: string;
  status: string;
  /** Empty when no one is assigned. */
  assignee: string;
  /** `YYYY-MM-DD`, or empty. */
  dueDate: string;
  /** The chips under the title ("Compete", "1 platform"). */
  tags: string[];
  why: string;
  goal: string;
  /** "AI Visibility (target 40)". */
  kpis: string[];
  /**
   * What the action was sent from, when a person sent it: the Improve tab's
   * prompt and platforms, a content opportunity's pages, brief and prompts.
   */
  context: ExportFact[];
  created: string;
  updated: string;
  /** The action's drawer in the app. */
  link: string;
  /** The Affected tab's rows (AC-003). */
  affected: ExportAffected[];
  tasks: ExportTask[];
  signals: ExportSignal[];
  /** The History tab, in its order. */
  events: { date: string; text: string }[];
}

/** One affected item as the exports list it (AC-003). */
export interface ExportAffected {
  /** "Prompt", "Page", "Competitor", "Topic". */
  entity: string;
  label: string;
  /** "4.4–7.5k", or empty when unknown. */
  volume: string;
  /** 'estimate' beside a volume (PROMPT-013), else empty. */
  volumeType: string;
  /** high, medium or low beside a volume, else empty: the CSV's code. */
  volumeConfidence: string;
  /** The same, worded for people ("Medium"): Markdown and Excel. */
  volumeConfidenceLabel: string;
  /** Display names. */
  platforms: string[];
  /** The brand's pages that lost a citation, and those cited instead. */
  lostPages: string[];
  citedInstead: string[];
  /** What else its row says: competitors ahead, a page's visits or issues. */
  details: string;
  /** Where it opens in the app, or the page itself. */
  link: string;
}

export interface ExportTask {
  number: number;
  title: string;
  status: string;
  /** "Content", "Outreach"…; empty when the task has none (AC-004). */
  type: string;
  /** The exact page (AC-010). */
  url: string;
  where: string;
  why: string;
  /** "Before: … → After: …", or "Add: …" (AC-010). */
  change: string;
  how: string[];
  doneWhen: string;
  /** How we check it (AC-010). */
  check: string;
  /** "~2h · Content writer". */
  effort: string;
  /** What else the task carries (an Improve task's body and evidence), and why it was skipped. */
  details: string;
}

export interface ExportSignal {
  /** "Citation · Lost", as the signals list's Type column. */
  type: string;
  /** What it is about, as the Affected column: a prompt, a page, "3 prompts". */
  entity: string;
  title: string;
  description: string;
  category: string;
  status: string;
  impact: string;
  /** Display names, most common first. */
  platforms: string[];
  locations: string[];
  /** `YYYY-MM-DD`. */
  detected: string;
  lastDetected: string;
  /** The signal's drawer in the app. */
  link: string;
}

/** The labels an `ActionExport` is built from, each already in the reader's language. */
export interface ExportTexts {
  title: string;
  priority: { label: string; why: string } | null;
  why: string;
  goal: string;
  category: string;
  status: string;
  tags: string[];
  kpis: string[];
  context: ExportFact[];
  affected: ExportAffected[];
  taskTitle: (task: ActionDetail['tasks'][number]) => string;
  taskStatus: (status: string) => string;
  signal: (signal: ActionDetail['signals'][number]) => {
    type: string;
    entity: string;
    title: string;
    description: string;
    category: string;
    status: string;
    impact: string;
  };
  event: (event: ActionDetail['events'][number]) => string;
  /** "Skipped: {reason}". */
  skipped: (reason: string) => string;
  /** "Content", "On-page"…, for a task's type (AC-004). */
  taskType: (type: string) => string;
  /** "Automatic: we fetch the page again"…, for how a task is checked (AC-010). */
  taskCheck: (check: string) => string;
  /** "Before: … → After: …", or "Add: …" (AC-010). */
  taskChange: (change: { before: string | null; after: string }) => string;
  /** A library task's Done when from its template (AC-010); empty without one. */
  templateDoneWhen: (taskKey: string) => string;
  /** "Sent to Content", "Sent to the webhook" (AC-004). */
  taskSent: (to: 'content' | 'webhook') => string;
  /** What an AI answer a task rests on is called; its id means nothing outside. */
  answerSource: string;
}

/**
 * `YYYY-MM-DD` in the reader's time zone, as the app shows dates. A date
 * without a time (a due date) is already the day.
 */
function dayOf(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : dayIn(iso, timeZone);
}

/** A field on one line: an export row or a Markdown list item holds no line breaks. */
const oneLine = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s*\n+\s*/g, ' ').trim();

/** "1) Add a table. 2) Update the title." */
const steps = (how: string[]): string => how.map((step, i) => `${i + 1}) ${step}`).join(' ');

/** The action and its detail, labelled, in the order the drawer shows them. */
export function buildActionExport(
  action: ActionItem,
  detail: ActionDetail,
  texts: ExportTexts,
  { origin, timeZone }: { origin: string; timeZone: string },
): ActionExport {
  const day = (iso: string | null | undefined) => dayOf(iso, timeZone);
  return {
    ref: `AC-${action.actionNo}`,
    title: texts.title,
    priority: texts.priority,
    category: texts.category,
    status: texts.status,
    assignee: action.assignee ? (assigneeLabel(action.assignee) ?? '') : '',
    dueDate: day(action.dueDate),
    tags: texts.tags,
    why: texts.why,
    goal: texts.goal,
    kpis: texts.kpis,
    context: texts.context,
    created: day(action.createdAt),
    updated: day(action.updatedAt),
    link: `${origin}/dashboard/action-center/actions?action=${action.id}`,
    affected: texts.affected,
    tasks: detail.tasks.map((task, i) => {
      // How we check as the task's template has it now (AC-010).
      const d = withTemplateCheck(task.details, task.taskKey);
      const details: (string | null)[] = d
        ? [
            d.body,
            d.platformLabel,
            ...d.sources.map((source) =>
              source.type === 'answer' ? texts.answerSource : source.ref,
            ),
          ]
        : [];
      if (d?.sent?.content) details.push(texts.taskSent('content'));
      if (d?.sent?.webhook) details.push(texts.taskSent('webhook'));
      if (task.skipReason) details.push(texts.skipped(task.skipReason));
      return {
        number: i + 1,
        title: texts.taskTitle(task),
        status: texts.taskStatus(task.status),
        type: d?.type ? texts.taskType(d.type) : '',
        url: oneLine(d?.url),
        where: oneLine(d?.where),
        why: oneLine(d?.why),
        change: d?.change ? oneLine(texts.taskChange(d.change)) : '',
        how: (d?.how ?? []).map(oneLine),
        // A library task's is its template's until someone writes one (AC-010).
        doneWhen: oneLine(
          d?.doneWhen ?? (task.taskKey ? texts.templateDoneWhen(task.taskKey) : ''),
        ),
        check: d?.check ? texts.taskCheck(d.check) : '',
        effort: [d?.effort, d?.role].filter(Boolean).join(' · '),
        details: details
          .filter((part): part is string => !!part)
          .map(oneLine)
          .join(' · '),
      };
    }),
    signals: detail.signals.map((signal) => ({
      ...texts.signal(signal),
      platforms: signal.where.platforms.map(platformName),
      locations: signal.where.regions.map(locationName),
      detected: day(signal.detectedAt),
      lastDetected: day(signal.lastDetectedAt),
      link: `${origin}/dashboard/action-center/signals?signal=${signal.id}`,
    })),
    events: detail.events.map((event) => ({
      date: day(event.createdAt),
      text: texts.event(event),
    })),
  };
}

/** Headings and field names, in the reader's language (actionsPage.export). */
type Labels = (key: string, values?: Record<string, string | number>) => string;

const listed = (value: string | string[]) => (Array.isArray(value) ? value.join('; ') : value);

/** One line per signal: what, where, when, about what. */
function signalLine(signal: ExportSignal): string {
  return [
    signal.type,
    signal.platforms.join(', '),
    signal.locations.join(', '),
    signal.detected,
    signal.entity,
    signal.status,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** One affected item on a line: what it is, its demand, where, and what else it says. */
function affectedLine(item: ExportAffected, label: Labels): string {
  return [
    item.label,
    item.volume
      ? label('estimatedVolume', { volume: item.volume, confidence: item.volumeConfidenceLabel })
      : '',
    item.platforms.join(', '),
    item.lostPages.length ? `${label('lostPage')}: ${item.lostPages.join(', ')}` : '',
    item.citedInstead.length ? `${label('citedInstead')}: ${item.citedInstead.join(', ')}` : '',
    item.details,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * "Copy all": the action as Markdown, everything its drawer's tabs show, to
 * paste into Docs, Notion, Jira or an AI agent.
 */
export function actionMarkdown(a: ActionExport, label: Labels): string {
  const facts = (pairs: [string, string][]) =>
    pairs
      .filter(([, value]) => value)
      .map(([key, value]) => `${label(key)}: ${value}`)
      .join(' · ');
  const lines = [
    `# ${a.title} (${a.ref})`,
    facts([
      ['priority', a.priority?.label ?? ''],
      ['category', a.category],
      ['status', a.status],
    ]),
    facts([
      ['assignee', a.assignee],
      ['dueDate', a.dueDate],
    ]),
    a.tags.length ? `${label('tags')}: ${a.tags.join(', ')}` : '',
    a.priority?.why ? `${label('priorityWhy')}: ${a.priority.why}` : '',
    `${label('why')}: ${a.why}`,
    `${label('goal')}: ${a.goal}`,
    a.kpis.length ? `${label('kpis')}: ${a.kpis.join(', ')}` : '',
    ...a.context.flatMap(({ label: name, value }) =>
      Array.isArray(value)
        ? [`${name}:`, ...value.map((item) => `- ${item}`)]
        : [`${name}: ${value}`],
    ),
    `${label('link')}: ${a.link}`,
  ].filter(Boolean);

  if (a.affected.length) {
    lines.push('', `## ${label('affectedHeading', { count: a.affected.length })}`);
    for (const item of a.affected) lines.push(`- ${affectedLine(item, label)}`);
  }

  lines.push('', `## ${label('tasksHeading', { count: a.tasks.length })}`);
  for (const task of a.tasks) {
    lines.push(
      `${task.number}. ${task.title} (${task.status})${task.type ? ` · ${task.type}` : ''}`,
    );
    if (task.url) lines.push(`   ${label('taskUrl')}: ${task.url}`);
    if (task.where) lines.push(`   ${label('taskWhere')}: ${task.where}`);
    if (task.why) lines.push(`   ${label('taskWhy')}: ${task.why}`);
    if (task.change) lines.push(`   ${label('taskChange')}: ${task.change}`);
    if (task.how.length) lines.push(`   ${label('taskHow')}: ${steps(task.how)}`);
    if (task.doneWhen) lines.push(`   ${label('taskDoneWhen')}: ${task.doneWhen}`);
    if (task.check) lines.push(`   ${label('taskCheck')}: ${task.check}`);
    if (task.effort) lines.push(`   ${label('taskEffort')}: ${task.effort}`);
    if (task.details) lines.push(`   ${task.details}`);
  }

  lines.push('', `## ${label('signalsHeading', { count: a.signals.length })}`);
  for (const signal of a.signals) lines.push(`- ${signalLine(signal)}`);

  if (a.events.length) {
    lines.push('', `## ${label('historyHeading', { count: a.events.length })}`);
    for (const event of a.events) lines.push(`- ${event.date} · ${event.text}`);
  }

  return lines.join('\n');
}

/**
 * The CSV columns: a row per affected item, task and signal, marked by
 * `section`, with the columns they share. Machine names, as in the actions
 * list's export.
 */
export const ACTION_CSV_HEADERS = [
  'section',
  'action',
  'ref',
  'title',
  'type',
  'entity',
  'details',
  'url',
  'where',
  'why',
  'change',
  'how',
  'done_when',
  'check',
  'effort',
  'status',
  'category',
  'impact',
  'volume',
  'volume_type',
  'volume_confidence',
  'lost_pages',
  'cited_instead',
  'platforms',
  'locations',
  'first_detected',
  'last_detected',
  'link',
];

/** "Export CSV": the action's affected items, tasks and signals, one row each. */
export function actionCsv(a: ActionExport): string {
  const rows: Record<string, unknown>[] = [
    ...a.affected.map((item, i) => ({
      section: 'affected',
      action: a.ref,
      ref: i + 1,
      title: item.label,
      type: item.entity,
      details: item.details,
      volume: item.volume,
      volume_type: item.volumeType,
      volume_confidence: item.volumeConfidence,
      lost_pages: item.lostPages.join('; '),
      cited_instead: item.citedInstead.join('; '),
      platforms: item.platforms.join('; '),
      link: item.link,
    })),
    ...a.tasks.map((task) => ({
      section: 'task',
      action: a.ref,
      ref: task.number,
      title: task.title,
      type: task.type,
      details: task.details,
      url: task.url,
      where: task.where,
      why: task.why,
      change: task.change,
      how: steps(task.how),
      done_when: task.doneWhen,
      check: task.check,
      effort: task.effort,
      status: task.status,
      link: a.link,
    })),
    ...a.signals.map((signal, i) => ({
      section: 'signal',
      action: a.ref,
      ref: i + 1,
      title: signal.title,
      type: signal.type,
      entity: signal.entity,
      details: signal.description,
      status: signal.status,
      category: signal.category,
      impact: signal.impact,
      platforms: signal.platforms.join('; '),
      locations: signal.locations.join('; '),
      first_detected: signal.detected,
      last_detected: signal.lastDetected,
      link: signal.link,
    })),
  ];
  return toCsv(rows, ACTION_CSV_HEADERS);
}

/** Written first so Excel reads a CSV as UTF-8 and keeps Turkish characters. */
export const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/**
 * The actions list's Export CSV: a row per action. Besides its priority, it
 * says what each action's Affected tab counts and names (AC-005).
 */
export const ACTION_LIST_CSV_HEADERS = [
  'number',
  'priority_score',
  'priority_level',
  'title',
  'category',
  'status',
  'assignee',
  'due_date',
  'tasks_done_total',
  'signal_count',
  'affected_count',
  'affected_items',
  'created',
];

/** One action of the list, labelled in the reader's language. */
export interface ActionListRow {
  number: number;
  priorityScore: number | null;
  /** "High"; empty before the action is scored. */
  priorityLevel: string;
  title: string;
  category: string;
  status: string;
  assignee: string;
  dueDate: string;
  tasksDone: number;
  tasksTotal: number;
  signalCount: number;
  /** What its Affected tab counts and names; missing reads as none. */
  affected?: { count: number; items: string[] };
  created: string;
}

/** The actions list's Export CSV, without the byte order mark the download adds. */
export function actionListCsv(rows: ActionListRow[]): string {
  return toCsv(
    rows.map((row) => ({
      number: row.number,
      priority_score: row.priorityScore ?? '',
      priority_level: row.priorityLevel,
      title: row.title,
      category: row.category,
      status: row.status,
      assignee: row.assignee,
      due_date: row.dueDate,
      tasks_done_total: `${row.tasksDone} / ${row.tasksTotal}`,
      signal_count: row.signalCount,
      affected_count: row.affected?.count ?? 0,
      affected_items: (row.affected?.items ?? []).join('; '),
      created: row.created,
    })),
    ACTION_LIST_CSV_HEADERS,
  );
}

const bold = (value: string) => ({ value, fontWeight: 'bold' as const });

/** "Export Excel": a sheet each for the action, its tasks, its signals and its history. */
export function actionWorkbook(a: ActionExport, label: Labels): Sheet<Blob>[] {
  const summary: [string, string][] = [
    [label('action'), a.ref],
    [label('title'), a.title],
    [label('priority'), a.priority?.label ?? ''],
    [label('priorityWhy'), a.priority?.why ?? ''],
    [label('category'), a.category],
    [label('status'), a.status],
    [label('assignee'), a.assignee],
    [label('dueDate'), a.dueDate],
    [label('tags'), a.tags.join(', ')],
    [label('why'), a.why],
    [label('goal'), a.goal],
    [label('kpis'), a.kpis.join(', ')],
    ...a.context.map(({ label: name, value }): [string, string] => [name, listed(value)]),
    [label('created'), a.created],
    [label('updated'), a.updated],
    [label('link'), a.link],
  ];
  return [
    {
      sheet: label('sheets.action'),
      columns: [{ width: 22 }, { width: 90 }],
      data: summary.map(([name, value]) => [bold(name), value]),
    },
    ...(a.affected.length
      ? [
          {
            sheet: label('sheets.affected'),
            stickyRowsCount: 1,
            columns: [
              { width: 10 },
              { width: 60 },
              { width: 10 },
              { width: 10 },
              { width: 12 },
              { width: 24 },
              { width: 40 },
              { width: 40 },
              { width: 40 },
              { width: 40 },
            ],
            data: [
              [
                label('type'),
                label('item'),
                label('volume'),
                label('volumeType'),
                label('volumeConfidence'),
                label('platforms'),
                label('lostPage'),
                label('citedInstead'),
                label('details'),
                label('link'),
              ].map(bold),
              ...a.affected.map((item) => [
                item.entity,
                item.label,
                item.volume,
                item.volumeType,
                item.volumeConfidenceLabel,
                item.platforms.join(', '),
                item.lostPages.join(', '),
                item.citedInstead.join(', '),
                item.details,
                item.link,
              ]),
            ],
          },
        ]
      : []),
    {
      sheet: label('sheets.tasks'),
      stickyRowsCount: 1,
      columns: [
        { width: 5 },
        { width: 60 },
        { width: 12 },
        { width: 14 },
        { width: 40 },
        { width: 40 },
        { width: 50 },
        { width: 60 },
        { width: 60 },
        { width: 40 },
        { width: 30 },
        { width: 20 },
        { width: 50 },
      ],
      data: [
        [
          '#',
          label('task'),
          label('type'),
          label('status'),
          label('taskUrl'),
          label('taskWhere'),
          label('taskWhy'),
          label('taskChange'),
          label('taskHow'),
          label('taskDoneWhen'),
          label('taskCheck'),
          label('taskEffort'),
          label('details'),
        ].map(bold),
        ...a.tasks.map((task) => [
          task.number,
          task.title,
          task.type,
          task.status,
          task.url,
          task.where,
          task.why,
          task.change,
          steps(task.how),
          task.doneWhen,
          task.check,
          task.effort,
          task.details,
        ]),
      ],
    },
    {
      sheet: label('sheets.signals'),
      stickyRowsCount: 1,
      columns: [
        { width: 22 },
        { width: 40 },
        { width: 50 },
        { width: 60 },
        { width: 12 },
        { width: 10 },
        { width: 24 },
        { width: 16 },
        { width: 14 },
        { width: 14 },
        { width: 40 },
      ],
      data: [
        [
          label('type'),
          label('entity'),
          label('signal'),
          label('description'),
          label('status'),
          label('impact'),
          label('platforms'),
          label('locations'),
          label('firstDetected'),
          label('lastDetected'),
          label('link'),
        ].map(bold),
        ...a.signals.map((signal) => [
          signal.type,
          signal.entity,
          signal.title,
          signal.description,
          signal.status,
          signal.impact,
          signal.platforms.join(', '),
          signal.locations.join(', '),
          signal.detected,
          signal.lastDetected,
          signal.link,
        ]),
      ],
    },
    {
      sheet: label('sheets.history'),
      stickyRowsCount: 1,
      columns: [{ width: 14 }, { width: 90 }],
      data: [
        [label('date'), label('event')].map(bold),
        ...a.events.map((event) => [event.date, event.text]),
      ],
    },
  ];
}

/** `action-AC-52.csv`, as the spec names it. */
export function actionExportFileName(a: ActionExport, extension: 'csv' | 'xlsx' | 'md') {
  return `action-${a.ref}.${extension}`;
}
