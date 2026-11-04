import { describe, expect, it } from 'vitest';
import type { ChatRunStepMemberRow } from './steps';
import {
  chatTrayRun,
  chatTrayState,
  contentTrayRun,
  TRAY_LIMIT,
  trayResponse,
  type TrayRun,
} from './runsTray';

/**
 * The runs tray's rows (Chat agentic plan §2, CHAT-23 G4): where each run
 * stands, the step it is on in words, its Open, newest first — and nothing a
 * browser may not see.
 */

const NOW = Date.parse('2026-10-29T12:00:00Z');
const CHAT = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';

const stepRow = (
  position: number,
  status: string,
  label: string,
  extra: Partial<ChatRunStepMemberRow> = {},
): ChatRunStepMemberRow => ({
  id: `step-${position}`,
  run_id: 'run-1',
  position,
  kind: 'read',
  status,
  label,
  detail: null,
  scope_json: null,
  row_count: null,
  data_as_of: null,
  started_at: null,
  finished_at: null,
  ...extra,
});

const chatRun = (
  status: string,
  extra: Partial<{ created_at: string; finished_at: string | null }> = {},
) => ({
  conversation_id: CHAT,
  status,
  created_at: '2026-10-29T11:00:00Z',
  finished_at: null,
  ...extra,
});

describe('chatTrayState', () => {
  it('shows each chat_runs status as the tray does', () => {
    expect(
      [
        'queued',
        'running',
        'waiting',
        'paused',
        'paused_cap',
        'done',
        'error',
        'stopped',
        'new',
      ].map(chatTrayState),
    ).toEqual([
      'running',
      'running',
      'needsYou',
      'paused',
      'paused',
      'done',
      'failed',
      'failed',
      null,
    ]);
  });
});

describe('chatTrayRun', () => {
  it('names the step waiting on the person, by its label, and opens the chat', () => {
    const run = chatTrayRun(
      chatRun('waiting'),
      'Action Center tasks',
      [
        stepRow(3, 'pending', 'Publish'),
        stepRow(1, 'done', 'Read Action Center'),
        stepRow(2, 'waiting', 'Change one cited passage'),
      ],
      NOW,
    );
    expect(run).toEqual({
      source: 'chat',
      state: 'needsYou',
      title: 'Action Center tasks',
      step: 2,
      steps: 3,
      stepLabel: 'Change one cited passage',
      startedAt: '2026-10-29T11:00:00Z',
      finishedAt: null,
      href: `/dashboard/chat/${CHAT}`,
    });
  });

  it('else the step running, else the last; none yet is step 0', () => {
    const running = chatTrayRun(
      chatRun('running'),
      null,
      [
        stepRow(1, 'done', 'Read'),
        stepRow(2, 'running', 'Opened /pricing'),
        stepRow(3, 'pending', 'Write'),
      ],
      NOW,
    )!;
    expect([running.step, running.stepLabel, running.title]).toEqual([2, 'Opened /pricing', null]);
    const done = chatTrayRun(
      chatRun('done', { finished_at: '2026-10-29T11:05:00Z' }),
      'Report',
      [stepRow(1, 'done', 'Read'), stepRow(2, 'done', 'Saved report')],
      NOW,
    )!;
    expect([done.state, done.step, done.stepLabel, done.finishedAt]).toEqual([
      'done',
      2,
      'Saved report',
      '2026-10-29T11:05:00Z',
    ]);
    const queued = chatTrayRun(chatRun('queued'), 'New', [], NOW)!;
    expect([queued.state, queued.step, queued.steps, queued.stepLabel]).toEqual([
      'running',
      0,
      0,
      null,
    ]);
  });

  it('keeps runs under way of any age, and drops ended runs after a day', () => {
    const old = '2026-10-20T11:00:00Z';
    expect(chatTrayRun(chatRun('waiting', { created_at: old }), 'Old', [], NOW)).not.toBeNull();
    expect(
      chatTrayRun(
        chatRun('done', { created_at: old, finished_at: '2026-10-28T11:59:00Z' }),
        'Done',
        [],
        NOW,
      ),
    ).toBeNull();
    expect(
      chatTrayRun(chatRun('error', { finished_at: '2026-10-28T12:30:00Z' }), 'Err', [], NOW)!.state,
    ).toBe('failed');
    expect(chatTrayRun(chatRun('archived'), 'Unknown', [], NOW)).toBeNull();
  });

  it('gives the browser no tool, no debug record and no id but in its link', () => {
    const uuid = '33333333-3333-4333-8333-333333333333';
    const run = chatTrayRun(
      chatRun('running'),
      `Chat about ${uuid}`,
      [
        {
          ...stepRow(1, 'running', `Read draft ${uuid}`),
          tool: 'get_draft',
          debug_json: { tokens: 12 },
        } as ChatRunStepMemberRow,
      ],
      NOW,
    )!;
    expect(run.title).toBe('Chat about …');
    expect(run.stepLabel).toBe('Read draft …');
    const wire = JSON.stringify(run);
    expect(wire).not.toMatch(/get_draft|debug|tokens|"tool"/);
    expect(wire.replace(run.href, '')).not.toContain(CHAT);
    expect(Object.keys(run).filter((k) => /id$/i.test(k))).toEqual([]);
  });
});

describe('contentTrayRun', () => {
  const contentRow = (extra: Record<string, unknown> = {}) => ({
    id: 'run-c',
    kind: 'fix',
    steps: [
      { key: 'read_rules', count: 4 },
      { key: 'gather_sources', count: 52 },
      { key: 'write_changes', count: null },
      { key: 'check_sources', count: null },
    ],
    step: 1,
    started_at: '2026-10-29T11:58:00Z',
    finished_at: null,
    stopped_at: null,
    outcome: null,
    ...extra,
  });

  it('names the step under way in the editor’s words, and opens the draft', () => {
    expect(contentTrayRun(contentRow(), { id: DRAFT, title: 'Pricing FAQ' }, NOW)).toEqual({
      source: 'content',
      state: 'running',
      title: 'Pricing FAQ',
      step: 2,
      steps: 4,
      stepLabel: 'Gathering 52 sources',
      startedAt: '2026-10-29T11:58:00Z',
      finishedAt: null,
      href: `/dashboard/content/editor/${DRAFT}`,
    });
  });

  it('says done, stopped and a run a stopped server left as they ended', () => {
    const done = contentTrayRun(
      contentRow({ step: 4, finished_at: '2026-10-29T11:59:00Z', outcome: 'done' }),
      { id: DRAFT, title: 'Pricing FAQ' },
      NOW,
    )!;
    expect([done.state, done.step, done.stepLabel]).toEqual(['done', 4, 'Checking sources']);
    const stopped = contentTrayRun(
      contentRow({
        finished_at: '2026-10-29T11:59:00Z',
        stopped_at: '2026-10-29T11:59:00Z',
        outcome: 'stopped',
      }),
      { id: DRAFT, title: 'Pricing FAQ' },
      NOW,
    )!;
    expect(stopped.state).toBe('failed');
    // Unfinished and older than a run can take: a stopped server's.
    const left = contentTrayRun(
      contentRow({ started_at: '2026-10-29T11:00:00Z' }),
      { id: DRAFT, title: 'Pricing FAQ' },
      NOW,
    )!;
    expect([left.state, left.finishedAt]).toEqual(['failed', '2026-10-29T11:00:00Z']);
    // Ended more than a day ago: not in the tray.
    expect(
      contentTrayRun(
        contentRow({
          started_at: '2026-10-27T11:00:00Z',
          finished_at: '2026-10-27T11:02:00Z',
          outcome: 'done',
        }),
        { id: DRAFT, title: 'Pricing FAQ' },
        NOW,
      ),
    ).toBeNull();
    // A row the editor couldn't show.
    expect(contentTrayRun(contentRow({ steps: [] }), { id: DRAFT, title: 'x' }, NOW)).toBeNull();
  });
});

describe('trayResponse', () => {
  const row = (href: string, startedAt: string, state: TrayRun['state'] = 'running'): TrayRun => ({
    source: 'chat',
    state,
    title: href,
    step: 1,
    steps: 2,
    stepLabel: null,
    startedAt,
    finishedAt: null,
    href: href as TrayRun['href'],
  });

  it('puts the newest first, one row per chat or draft, with the counts', () => {
    const res = trayResponse([
      row('/dashboard/chat/a', '2026-10-29T09:00:00Z', 'done'),
      row('/dashboard/chat/b', '2026-10-29T11:00:00Z', 'needsYou'),
      row('/dashboard/chat/a', '2026-10-29T10:00:00Z', 'running'),
      row('/dashboard/content/editor/c', '2026-10-29T10:30:00Z', 'paused'),
    ]);
    expect(res.runs.map((r) => [r.href, r.state])).toEqual([
      ['/dashboard/chat/b', 'needsYou'],
      ['/dashboard/content/editor/c', 'paused'],
      ['/dashboard/chat/a', 'running'],
    ]);
    expect([res.running, res.needsYou]).toEqual([2, 1]);
  });

  it(`keeps at most ${TRAY_LIMIT}`, () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      row(`/dashboard/chat/${i}`, `2026-10-29T${String(i).padStart(2, '0')}:00:00Z`),
    );
    const res = trayResponse(many);
    expect(res.runs).toHaveLength(TRAY_LIMIT);
    expect(res.runs[0].href).toBe('/dashboard/chat/13');
    // The count is of every run, not only the ones shown.
    expect(res.running).toBe(14);
  });
});
