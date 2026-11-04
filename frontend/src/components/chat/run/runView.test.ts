import { describe, expect, it } from 'vitest';
import type { ChatStep } from '@/lib/chat/events';
import { dataUsed, doneSteps, statusLine } from './runView';

/** What an answer shows of its steps: the status line, ✓ chips and Data used (W1-14). */

const step = (over: Partial<ChatStep> & Pick<ChatStep, 'n' | 'kind' | 'label'>): ChatStep => ({
  status: 'done',
  ...over,
});

describe('statusLine', () => {
  it('says what the running step does, in its own words', () => {
    expect(
      statusLine([step({ n: 1, kind: 'read', label: 'Read Citations', status: 'running' })], false),
    ).toEqual({
      key: 'read',
      values: { source: 'Citations' },
    });
    expect(
      statusLine(
        [
          step({
            n: 1,
            kind: 'open_page',
            label: 'Opened getcito.com/pricing',
            status: 'running',
          }),
        ],
        false,
      ),
    ).toEqual({ key: 'openPage', values: { page: 'getcito.com/pricing' } });
    expect(
      statusLine([step({ n: 1, kind: 'check', label: 'Checked facts', status: 'running' })], true),
    ).toEqual({
      key: 'check',
    });
    expect(
      statusLine(
        [step({ n: 1, kind: 'write', label: 'Drafted FAQ block', status: 'running' })],
        false,
      ),
    ).toEqual({
      key: 'other',
      values: { label: 'Drafted FAQ block' },
    });
  });

  it('thinks without a running step, and writes while text streams', () => {
    expect(statusLine([], false)).toEqual({ key: 'thinking' });
    expect(statusLine([step({ n: 1, kind: 'read', label: 'Read Citations' })], true)).toEqual({
      key: 'writing',
    });
    expect(
      statusLine([step({ n: 1, kind: 'thinking', label: 'Thinking', status: 'running' })], false),
    ).toEqual({
      key: 'thinking',
    });
  });
});

describe('doneSteps and dataUsed', () => {
  const steps: ChatStep[] = [
    step({ n: 1, kind: 'thinking', label: 'Thinking' }),
    step({ n: 2, kind: 'read', label: 'Read Citations', rowCount: 18 }),
    step({ n: 3, kind: 'open_page', label: 'Opened getcito.com/pricing' }),
    step({ n: 4, kind: 'read', label: 'Read Citations', rowCount: 42 }),
    step({ n: 5, kind: 'skill', label: 'Used skill: FAQ + schema writer' }),
    step({ n: 6, kind: 'check', label: 'Checked facts', detail: 'Every figure matches the data' }),
    step({ n: 7, kind: 'read', label: 'Read Prompts', status: 'error', detail: 'Timed out' }),
    step({ n: 8, kind: 'read', label: 'Read Action Center', status: 'running' }),
  ];

  it('chips every step done but thinking, in order', () => {
    expect(doneSteps(steps).map((s) => s.n)).toEqual([2, 3, 4, 5, 6]);
  });

  it('takes a read without "Read …" words (going to a page of the app) as no source', () => {
    const goTo = step({ n: 1, kind: 'read', label: 'Opened a page' });
    expect(statusLine([{ ...goTo, status: 'running' }], false)).toEqual({
      key: 'other',
      values: { label: 'Opened a page' },
    });
    expect(dataUsed([goTo, step({ n: 2, kind: 'read', label: 'Worked on a step' })])).toEqual([]);
  });

  it('names memory by its subject, counted in items (CHAT-14 item 17)', () => {
    const memory = step({
      n: 1,
      kind: 'read',
      label: 'Used memory',
      rowCount: 3,
      scope: { subject: 'Memory', unit: 'items' },
    });
    expect(dataUsed([memory, ...steps])).toEqual([
      { label: 'Memory', rows: 3, unit: 'items' },
      { label: 'Citations', rows: 42 },
      { label: 'getcito.com/pricing' },
    ]);
  });

  it('names each source once with its largest count, and each page opened; skills, checks and failed reads aren’t sources', () => {
    expect(dataUsed(steps)).toEqual([
      { label: 'Citations', rows: 42 },
      { label: 'getcito.com/pricing' },
    ]);
  });
});
