import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { RunSteps } from '@/components/agentic/RunSteps';
import { chatEvent, type ChatEvent, type ChatStep } from './events';
import { applyChatEvent, emptyRun, runFromEvents } from './runState';

/** A run as the browser builds it from its events (CHAT-00, CHAT-03 items 19 and 21). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const read: ChatStep = { n: 1, kind: 'read', status: 'running', label: 'Read Citations' };
const summary = { workingMs: 41_000, stepCount: 2, sources: [] };

const events: ChatEvent[] = [
  chatEvent('step.started', 1, { step: read }),
  chatEvent('step.finished', 2, { step: { ...read, status: 'done', rowCount: 42 } }),
  chatEvent('text.delta', 3, { text: 'Citations fell ' }),
  chatEvent('step.started', 4, {
    step: { n: 2, kind: 'write', status: 'waiting', label: 'Save drafts in Content' },
  }),
  chatEvent('confirm.required', 5, {
    n: 2,
    action: 'Save drafts in Content',
    target: 'Pricing FAQ',
    digest: 'a'.repeat(32),
    canDontAskAgain: false,
  }),
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the run in the browser', () => {
  it('waits on its card, and goes on once the step runs again', () => {
    const waiting = runFromEvents(events);
    expect(waiting).toMatchObject({ status: 'waiting', text: 'Citations fell ', lastSeq: 5 });
    expect(waiting.confirm?.n).toBe(2);
    const approved = applyChatEvent(
      waiting,
      chatEvent('step.updated', 6, {
        step: { n: 2, kind: 'write', status: 'running', label: 'Save drafts in Content' },
      }),
    );
    expect(approved).toMatchObject({ status: 'running', confirm: null });
  });

  it('waits on a question card, folds it once answered, and clears it on Stop (CHAT-07)', () => {
    const ask: ChatStep = {
      n: 2,
      kind: 'ask',
      status: 'waiting',
      label: 'Waiting for your answer',
    };
    const asking = runFromEvents([
      ...events.slice(0, 3),
      chatEvent('step.started', 4, { step: ask }),
      chatEvent('ask.created', 5, {
        n: 2,
        question: 'Which page?',
        options: [{ label: '/pricing', recommended: true }, { label: '/features' }],
        allowOther: false,
        multi: false,
      }),
    ]);
    expect(asking).toMatchObject({ status: 'waiting', confirm: null, question: { n: 2 } });
    // Another step's news leaves it waiting.
    const still = applyChatEvent(
      asking,
      chatEvent('step.updated', 6, { step: { ...read, status: 'done' } }),
    );
    expect(still).toMatchObject({ status: 'waiting', question: { n: 2 } });
    const answered = applyChatEvent(
      asking,
      chatEvent('step.finished', 6, {
        step: { ...ask, status: 'done', label: 'Which page?', detail: '/features' },
      }),
    );
    expect(answered).toMatchObject({ status: 'running', question: null });
    expect(
      applyChatEvent(asking, chatEvent('run.stopped', 6, { ...summary, reason: 'person' })),
    ).toMatchObject({ status: 'stopped', question: null });
  });

  it('keeps the next moves sent before its end (CHAT-07 §C)', () => {
    const moves = [
      { label: 'Do the same for /features', prompt: 'Do the same for /features', ghost: true },
    ];
    const done = runFromEvents([
      chatEvent('text.delta', 1, { text: 'Done.' }),
      chatEvent('next_moves', 2, { moves }),
      chatEvent('run.finished', 3, {
        ...summary,
        generatedAt: '2026-10-30T09:00:00.000Z',
        dataAsOf: null,
      }),
    ]);
    expect(done).toMatchObject({ status: 'done', nextMoves: moves });
    expect(emptyRun().nextMoves).toEqual([]);
  });

  it('keeps what the run made, in order: each one its card (CHAT-06 item 1)', () => {
    const made = {
      title: 'Pricing FAQ',
      type: 'document' as const,
      formats: ['html', 'md'],
      status: 'draft' as const,
      href: '/dashboard/content/editor/x' as const,
      filed: 'in_files' as const,
    };
    const run = applyChatEvent(
      applyChatEvent(emptyRun(), chatEvent('deliverable.created', 1, made)),
      chatEvent('deliverable.created', 2, {
        ...made,
        title: 'Pricing table',
        filed: 'storage_full',
      }),
    );
    expect(run.deliverables.map((d) => [d.title, d.filed])).toEqual([
      ['Pricing FAQ', 'in_files'],
      ['Pricing table', 'storage_full'],
    ]);
  });

  it('keeps what it sent to the Action Center, and the tasks a card carries (CHAT-09 items 18–19)', () => {
    const sent = {
      kind: 'action_created' as const,
      actionNo: 1271,
      title: 'Win back pricing citations',
      href: '/dashboard/action-center/actions/x' as const,
    };
    const run = applyChatEvent(
      applyChatEvent(emptyRun(), chatEvent('action.sent', 1, sent)),
      chatEvent('action.sent', 2, { ...sent, kind: 'action_added', actionNo: 1258 }),
    );
    expect(run.sent.map((s) => [s.kind, s.actionNo])).toEqual([
      ['action_created', 1271],
      ['action_added', 1258],
    ]);
    const carded = applyChatEvent(
      emptyRun(),
      chatEvent('confirm.required', 1, {
        n: 1,
        action: 'Send findings to Action Center',
        target: '“Win back pricing citations” · Recover · 1 task',
        digest: 'b'.repeat(32),
        canDontAskAgain: false,
        items: [{ title: 'Add a FAQ to /pricing', detail: 'On-page · /pricing' }],
      }),
    );
    expect(carded.confirm?.items).toEqual([
      { title: 'Add a FAQ to /pricing', detail: 'On-page · /pricing' },
    ]);
  });

  it('keeps the task strip as the last tasks.updated says it (CHAT-09 §B)', () => {
    const row = {
      at: 1,
      title: 'Add FAQ block + schema to /pricing',
      priority: 86,
      category: 'fix' as const,
      status: 'writing' as const,
    };
    const writing = applyChatEvent(
      emptyRun(),
      chatEvent('tasks.updated', 1, { tasks: [row], ready: 0, total: 1, due: 1 }),
    );
    expect(writing.tasks?.tasks.map((t) => t.status)).toEqual(['writing']);
    const ready = applyChatEvent(
      writing,
      chatEvent('tasks.updated', 2, {
        tasks: [{ ...row, status: 'ready_for_review' }],
        ready: 1,
        total: 1,
        due: 1,
      }),
    );
    expect(ready.tasks).toMatchObject({ ready: 1, total: 1 });
    expect(ready.tasks?.tasks[0].status).toBe('ready_for_review');
    expect(emptyRun().tasks).toBeNull();
  });

  it('keeps each Why analysis once, by its number (CHAT-22 §1 item 4)', () => {
    const why = {
      n: 1,
      metric: 'citations' as const,
      unit: 'pts' as const,
      periodA: { from: '2026-10-12', to: '2026-10-18' },
      periodB: { from: '2026-10-19', to: '2026-10-25' },
      valueA: 58,
      valueB: 52,
      delta: -6,
      se: 0.8,
      noise: 'beyond_normal_swing' as const,
      direction: 'declined' as const,
      changeDay: null,
      causes: [],
      remainder: { kind: 'unexplained' as const, points: -6, share: 100 },
      excludedCells: 0,
      stableCells: 40,
      partial: false,
      engines: [],
      runs: { a: 10, b: 10, cells: 40 },
    };
    const run = [
      chatEvent('why.ready', 1, why),
      chatEvent('why.ready', 2, { ...why, n: 2, metric: 'visibility' as const }),
      chatEvent('why.ready', 3, { ...why, valueB: 50 }),
    ].reduce(applyChatEvent, emptyRun());
    expect(run.why.map((w) => [w.n, w.metric, w.valueB])).toEqual([
      [2, 'visibility', 52],
      [1, 'citations', 50],
    ]);
    expect(emptyRun().why).toEqual([]);
  });

  it('skips an event it already has, or a type it doesn’t know', () => {
    const run = runFromEvents(events);
    expect(applyChatEvent(run, events[2])).toBe(run);
    expect(
      applyChatEvent(run, { type: 'future.thing', seq: 9, data: {} } as unknown as ChatEvent),
    ).toBe(run);
  });

  it('says "Stopped after …" once stopped', async () => {
    const stopped = runFromEvents([
      ...events,
      chatEvent('step.finished', 6, {
        step: {
          n: 2,
          kind: 'write',
          status: 'skipped',
          label: 'Save drafts in Content',
          detail: 'Stopped',
        },
      }),
      chatEvent('run.stopped', 7, { ...summary, reason: 'person' }),
    ]);
    expect(stopped).toMatchObject({ status: 'stopped', confirm: null, text: 'Citations fell ' });
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <RunSteps status="stopped" steps={stopped.steps} workingMs={stopped.summary!.workingMs} />
        </NextIntlClientProvider>,
      ),
    );
    expect(container.textContent).toContain('Stopped after 41s');
  });

  it('keeps the end’s timestamps and an error’s words', () => {
    const done = applyChatEvent(
      emptyRun(),
      chatEvent('run.finished', 1, {
        ...summary,
        generatedAt: '2026-10-29T09:14:00.000Z',
        dataAsOf: '2026-10-29T06:00:00.000Z',
      }),
    );
    expect(done).toMatchObject({
      status: 'done',
      generatedAt: '2026-10-29T09:14:00.000Z',
      dataAsOf: '2026-10-29T06:00:00.000Z',
    });
    const failed = applyChatEvent(
      emptyRun(),
      chatEvent('run.error', 1, { ...summary, code: 'failed', reason: 'Chat stopped here.' }),
    );
    expect(failed).toMatchObject({ status: 'error', errorReason: 'Chat stopped here.' });
  });
});
