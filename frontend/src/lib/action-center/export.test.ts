// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseTaskDetails } from './taskDetails';
import type { ActionDetail, ActionItem } from '@/lib/actions/actionCenter';
import type { Signal } from '@/lib/signals/map';
import {
  ACTION_CSV_HEADERS,
  ACTION_LIST_CSV_HEADERS,
  actionCsv,
  actionListCsv,
  actionExportFileName,
  actionMarkdown,
  actionWorkbook,
  buildActionExport,
  type ExportTexts,
} from './export';

const action = {
  id: 'a1',
  actionNo: 52,
  category: 'recover',
  kind: 'recover_visibility',
  impact: 'high',
  status: 'in_progress',
  payload: {},
  kpiKeys: ['ai_visibility'],
  assignee: { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: null },
  dueDate: '2026-11-09',
  createdAt: '2026-10-08T09:00:00Z',
  updatedAt: '2026-10-15T12:30:00Z',
  taskTotal: 2,
  taskCompleted: 1,
  signalCount: 1,
  priorityScore: 94,
  priorityLevel: 'critical',
  priorityReason: null,
} as ActionItem;

const signal: Signal = {
  id: 's1',
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  // Late on Oct 8 in UTC is Oct 9 in Istanbul.
  detectedAt: '2026-10-08T22:30:00Z',
  lastDetectedAt: '2026-10-15T05:00:00Z',
  resolvedAt: null,
  previousValue: null,
  currentValue: null,
  changeValue: null,
  payload: {},
  kpiKeys: [],
  actionId: 'a1',
  where: { platforms: ['chatgpt-web', 'gemini-web'], regions: ['US'], topics: [] },
};

const detail = {
  tasks: [
    {
      id: 't1',
      position: 0,
      taskKey: null,
      title: 'Add a 2026 comparison table to /blog/best-tools',
      status: 'completed',
      titleParams: {},
      dependsOn: [],
      skipReason: null,
      details: {
        body: 'Lead with the table.\nThen the FAQ.',
        platform: 'chatgpt-web',
        platformLabel: 'ChatGPT',
        sources: [
          { type: 'url', ref: 'https://acme.example/blog/best-tools' },
          { type: 'answer', ref: '9c1e0d2a-0000-4b2f-8000-000000000000' },
        ],
      },
    },
    {
      id: 't2',
      position: 1,
      taskKey: null,
      title: '=HYPERLINK("x")',
      status: 'skipped',
      titleParams: {},
      dependsOn: [],
      skipReason: 'Done by hand',
      details: null,
    },
  ],
  signals: [signal],
  events: [
    { id: 'e1', event: 'created', data: {}, actorId: null, createdAt: '2026-10-08T09:00:00Z' },
  ],
  kpis: [],
} as unknown as ActionDetail;

const texts: ExportTexts = {
  title: 'Recover lost citations on 7 prompts',
  priority: { label: '94 (Critical)', why: 'Lost ground on 7 high-demand prompts 2 days ago.' },
  why: '7 prompts lost their citations.',
  goal: 'Citations back on 5 of 7 prompts',
  category: 'Recover',
  status: 'In progress',
  tags: ['Recover', '1 platform'],
  kpis: ['AI Visibility (target 40)'],
  context: [
    { label: 'Prompt', value: 'Which tools track AI search?' },
    { label: 'Platforms at send time', value: ['Gemini · No runs', 'ChatGPT · Not cited'] },
  ],
  affected: [
    {
      entity: 'Prompt',
      label: 'Which tools track AI search?',
      volume: '18–32k',
      volumeType: 'estimate',
      volumeConfidence: 'medium',
      volumeConfidenceLabel: 'Medium',
      platforms: ['ChatGPT', 'Gemini'],
      lostPages: ['https://acme.example/blog/best-tools'],
      citedInstead: ['https://profound.com/features'],
      details: '',
      link: 'https://app.example/dashboard/prompts/p1',
    },
  ],
  taskTitle: (task) => task.title ?? '',
  taskStatus: (status) => ({ completed: 'Completed', skipped: 'Skipped' })[status] ?? status,
  signal: () => ({
    type: 'Citation · Lost',
    entity: 'Which tools track AI search?',
    title: 'Citations lost for "Which tools track AI search?"',
    description: 'Your pages are no longer cited.',
    category: 'Citation',
    status: 'New',
    impact: 'High',
  }),
  event: () => 'Action created',
  skipped: (reason) => `Skipped: ${reason}`,
  taskType: (type) => ({ content: 'Content', outreach: 'Outreach' })[type] ?? type,
  taskCheck: (check) => `check.${check}`,
  taskChange: ({ before, after }) => (before ? `${before} → ${after}` : `Add: ${after}`),
  templateDoneWhen: (taskKey) =>
    taskKey === 'refresh_content' ? 'The page has its new facts and date' : '',
  taskSent: (to) => (to === 'content' ? 'Sent to Content' : 'Sent to the webhook'),
  answerSource: 'AI answer',
};

// Labels as their keys, with the counts the headings take.
const label = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}(${Object.values(values).join(',')})` : key;

const exported = buildActionExport(action, detail, texts, {
  origin: 'https://app.example',
  timeZone: 'Europe/Istanbul',
});

describe('buildActionExport', () => {
  it("labels the action, its tasks, signals and history, dated in the reader's zone", () => {
    expect(exported).toMatchObject({
      ref: 'AC-52',
      assignee: 'Ada Lovelace',
      dueDate: '2026-11-09',
      created: '2026-10-08',
      link: 'https://app.example/dashboard/action-center/actions?action=a1',
      tasks: [
        {
          number: 1,
          status: 'Completed',
          // An AI answer is named, not given by its id; lines are joined.
          details:
            'Lead with the table. Then the FAQ. · ChatGPT · https://acme.example/blog/best-tools · AI answer',
        },
        { number: 2, status: 'Skipped', details: 'Skipped: Done by hand' },
      ],
      signals: [
        {
          type: 'Citation · Lost',
          platforms: ['ChatGPT', 'Gemini'],
          locations: ['United States'],
          detected: '2026-10-09',
          link: 'https://app.example/dashboard/action-center/signals?signal=s1',
        },
      ],
      events: [{ date: '2026-10-08', text: 'Action created' }],
    });
  });
});

describe('actionMarkdown', () => {
  it('writes what every tab shows as headed Markdown', () => {
    expect(actionMarkdown(exported, label)).toBe(
      [
        '# Recover lost citations on 7 prompts (AC-52)',
        'priority: 94 (Critical) · category: Recover · status: In progress',
        'assignee: Ada Lovelace · dueDate: 2026-11-09',
        'tags: Recover, 1 platform',
        'priorityWhy: Lost ground on 7 high-demand prompts 2 days ago.',
        'why: 7 prompts lost their citations.',
        'goal: Citations back on 5 of 7 prompts',
        'kpis: AI Visibility (target 40)',
        'Prompt: Which tools track AI search?',
        'Platforms at send time:',
        '- Gemini · No runs',
        '- ChatGPT · Not cited',
        'link: https://app.example/dashboard/action-center/actions?action=a1',
        '',
        '## affectedHeading(1)',
        '- Which tools track AI search? · estimatedVolume(18–32k,Medium) · ChatGPT, Gemini · lostPage: https://acme.example/blog/best-tools · citedInstead: https://profound.com/features',
        '',
        '## tasksHeading(2)',
        '1. Add a 2026 comparison table to /blog/best-tools (Completed)',
        '   Lead with the table. Then the FAQ. · ChatGPT · https://acme.example/blog/best-tools · AI answer',
        '2. =HYPERLINK("x") (Skipped)',
        '   Skipped: Done by hand',
        '',
        '## signalsHeading(1)',
        '- Citation · Lost · ChatGPT, Gemini · United States · 2026-10-09 · Which tools track AI search? · New',
        '',
        '## historyHeading(1)',
        '- 2026-10-08 · Action created',
      ].join('\n'),
    );
  });

  it('names an assignee with no name by e-mail, as the assignee picker does', () => {
    const named = buildActionExport(
      {
        ...action,
        assignee: { id: 'u2', fullName: null, avatarUrl: null, email: 'cg@acme.example' },
      },
      detail,
      texts,
      { origin: 'https://app.example', timeZone: 'Europe/Istanbul' },
    );
    expect(named.assignee).toBe('cg@acme.example');
  });

  it('leaves out what an action has none of', () => {
    const bare = {
      ...exported,
      priority: null,
      assignee: '',
      dueDate: '',
      tags: [],
      kpis: [],
      context: [],
      affected: [],
      tasks: [],
      signals: [],
      events: [],
    };
    const md = actionMarkdown(bare, label);
    expect(md).not.toMatch(/priority|assignee|tags|kpis|affectedHeading|historyHeading/);
    expect(md).toContain('## tasksHeading(0)');
  });
});

describe('actionCsv', () => {
  it('gives each affected item, task and signal a row, marked by section and the action', () => {
    const [head, ...rows] = actionCsv(exported).split('\n');
    expect(head).toBe(ACTION_CSV_HEADERS.join(','));
    expect(rows.map((row) => row.split(',').slice(0, 2).join(','))).toEqual([
      'affected,AC-52',
      'task,AC-52',
      'task,AC-52',
      'signal,AC-52',
    ]);
    expect(rows[0]).toContain(
      '18–32k,estimate,medium,https://acme.example/blog/best-tools,https://profound.com/features,ChatGPT; Gemini',
    );
    // A cell a spreadsheet would run as a formula is kept as text.
    expect(rows[2]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(rows[3]).toContain('Citation · Lost,Which tools track AI search?');
    expect(rows[3]).toContain('ChatGPT; Gemini,United States,2026-10-09');
  });
});

describe('actionListCsv', () => {
  const listRow = {
    number: 52,
    priorityScore: 84,
    priorityLevel: 'High',
    title: 'Recover lost citations on 3 prompts',
    category: 'Recover',
    status: 'New',
    assignee: '',
    dueDate: '',
    tasksDone: 1,
    tasksTotal: 6,
    signalCount: 3,
    created: '2026-10-15T00:00:00Z',
  };

  it("adds each action's affected count and names to the list's columns (AC-005)", () => {
    const [header, row] = actionListCsv([
      {
        ...listRow,
        affected: { count: 7, items: ['Best coffee subscription?', 'Coffee, delivered'] },
      },
    ]).split('\n');
    expect(header).toBe(ACTION_LIST_CSV_HEADERS.join(','));
    expect(header).toContain('priority_score,priority_level,');
    expect(header).toContain(',signal_count,affected_count,affected_items,created');
    expect(row).toBe(
      '52,84,High,Recover lost citations on 3 prompts,Recover,New,,,1 / 6,3,7,"Best coffee subscription?; Coffee, delivered",2026-10-15T00:00:00Z',
    );
  });

  it('writes none for an action whose affected items were not read, and no score before one', () => {
    const [, row] = actionListCsv([{ ...listRow, priorityScore: null, priorityLevel: '' }]).split(
      '\n',
    );
    expect(row).toBe(
      '52,,,Recover lost citations on 3 prompts,Recover,New,,,1 / 6,3,0,,2026-10-15T00:00:00Z',
    );
  });
});

describe('actionWorkbook', () => {
  it('gives the action, its affected items, tasks, signals and history a sheet each', () => {
    const sheets = actionWorkbook(exported, label);
    expect(sheets.map((s) => s.sheet)).toEqual([
      'sheets.action',
      'sheets.affected',
      'sheets.tasks',
      'sheets.signals',
      'sheets.history',
    ]);
    expect(sheets[0].data).toContainEqual([
      { value: 'priority', fontWeight: 'bold' },
      '94 (Critical)',
    ]);
    expect(sheets[0].data.map((row) => (row[0] as { value: string }).value)).not.toContain(
      'impact',
    );
    expect(sheets[0].data).toContainEqual([
      { value: 'Platforms at send time', fontWeight: 'bold' },
      'Gemini · No runs; ChatGPT · Not cited',
    ]);
    expect(sheets[1].data[1].slice(0, 6)).toEqual([
      'Prompt',
      'Which tools track AI search?',
      '18–32k',
      'estimate',
      'Medium',
      'ChatGPT, Gemini',
    ]);
    expect(sheets[2].data[0][1]).toEqual({ value: 'task', fontWeight: 'bold' });
    expect(sheets[3].data[1].slice(0, 2)).toEqual([
      'Citation · Lost',
      'Which tools track AI search?',
    ]);
    expect(sheets[4].data[1]).toEqual(['2026-10-08', 'Action created']);
  });
});

describe('actionExportFileName', () => {
  it('names the file after the action, as the spec does', () => {
    expect(actionExportFileName(exported, 'csv')).toBe('action-AC-52.csv');
  });
});

describe('the Excel file', () => {
  it('is a workbook a spreadsheet reader opens, with every sheet and cell', async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const blob = await writeXlsxFile(actionWorkbook(exported, label)).toBlob();
    const sheets = await readXlsxFile(blob);
    expect(sheets.map((s) => s.sheet)).toEqual([
      'sheets.action',
      'sheets.affected',
      'sheets.tasks',
      'sheets.signals',
      'sheets.history',
    ]);
    expect(sheets[2].data[2]).toEqual([
      2,
      '=HYPERLINK("x")',
      null,
      'Skipped',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      'Skipped: Done by hand',
    ]);
    expect(sheets[3].data[1][6]).toBe('ChatGPT, Gemini');
  });
});

describe('a library task’s Done when (AC-010)', () => {
  it('is its template’s until someone writes one', () => {
    const library = (details: (typeof detail.tasks)[number]['details']) =>
      buildActionExport(
        action,
        {
          ...detail,
          tasks: [{ ...detail.tasks[1], taskKey: 'refresh_content', title: null, details }],
        },
        texts,
        { origin: 'https://app.example', timeZone: 'Europe/Istanbul' },
      ).tasks[0].doneWhen;
    expect(library(null)).toBe('The page has its new facts and date');
    // A template's check alone (AC-010 part 3) still takes its Done when.
    expect(library(parseTaskDetails({ check: 'auto' }))).toBe(
      'The page has its new facts and date',
    );
    expect(library(parseTaskDetails({ doneWhen: 'Our own check' }))).toBe('Our own check');
  });

  it('gives a task planned while its template was Automatic its Manual check', () => {
    const checkOf = (taskKey: string) =>
      buildActionExport(
        action,
        {
          ...detail,
          tasks: [
            {
              ...detail.tasks[1],
              taskKey,
              title: null,
              details: parseTaskDetails({ check: 'auto' }),
            },
          ],
        },
        texts,
        { origin: 'https://app.example', timeZone: 'Europe/Istanbul' },
      ).tasks[0].check;
    expect(checkOf('improve_cta_path')).toBe('check.manual');
    expect(checkOf('refresh_content')).toBe('check.auto');
  });
});

describe('a task with AC-004 fields', () => {
  const concrete = buildActionExport(
    action,
    {
      ...detail,
      tasks: [
        {
          ...detail.tasks[0],
          status: 'todo',
          details: {
            body: null,
            platform: null,
            platformLabel: null,
            sources: [],
            where: 'acme.example/blog/best-tools · 3 prompts on ChatGPT',
            url: '/blog/best-tools',
            why: 'Cited #2 until Oct 8.\nThe pages cited now have a dated table.',
            change: { before: null, after: 'A 2026 feature table.' },
            how: ['Add a feature table.', 'Put "2026" in the title.'],
            doneWhen: 'Cited again on 2 of 3 platforms within 14 days.',
            check: 'rerun',
            type: 'content',
            effort: '~2h',
            role: 'Content writer',
            sent: { content: null, webhook: null },
            lastCheck: null,
          },
        },
      ],
    },
    texts,
    { origin: 'https://app.example', timeZone: 'Europe/Istanbul' },
  );

  it('writes each field on its own line in Copy Data', () => {
    expect(actionMarkdown(concrete, label)).toContain(
      [
        '1. Add a 2026 comparison table to /blog/best-tools (todo) · Content',
        '   taskUrl: /blog/best-tools',
        '   taskWhere: acme.example/blog/best-tools · 3 prompts on ChatGPT',
        '   taskWhy: Cited #2 until Oct 8. The pages cited now have a dated table.',
        '   taskChange: Add: A 2026 feature table.',
        '   taskHow: 1) Add a feature table. 2) Put "2026" in the title.',
        '   taskDoneWhen: Cited again on 2 of 3 platforms within 14 days.',
        '   taskCheck: check.rerun',
        '   taskEffort: ~2h · Content writer',
      ].join('\n'),
    );
  });

  it('gives each field its own column in the CSV and the workbook', () => {
    const [head, , task] = actionCsv(concrete).split('\n');
    const cells = Object.fromEntries(
      head.split(',').map((name, i) => [name, task.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.[i]]),
    );
    expect(cells.type).toBe('Content,');
    expect(cells.how).toBe('"1) Add a feature table. 2) Put ""2026"" in the title.",');
    expect(cells.done_when).toBe('Cited again on 2 of 3 platforms within 14 days.,');
    expect(cells.url).toBe('/blog/best-tools,');
    expect(cells.change).toBe('Add: A 2026 feature table.,');
    expect(cells.check).toBe('check.rerun,');

    const sheet = actionWorkbook(concrete, label)[2];
    expect(sheet.data[1]).toEqual([
      1,
      'Add a 2026 comparison table to /blog/best-tools',
      'Content',
      'todo',
      '/blog/best-tools',
      'acme.example/blog/best-tools · 3 prompts on ChatGPT',
      'Cited #2 until Oct 8. The pages cited now have a dated table.',
      'Add: A 2026 feature table.',
      '1) Add a feature table. 2) Put "2026" in the title.',
      'Cited again on 2 of 3 platforms within 14 days.',
      'check.rerun',
      '~2h · Content writer',
      '',
    ]);
  });
});
