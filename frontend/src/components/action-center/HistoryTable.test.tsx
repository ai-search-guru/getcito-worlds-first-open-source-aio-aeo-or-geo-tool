import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionHistoryItem, AffectedEntity } from '@/lib/action-center/history';
import messages from '../../../messages/en.json';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// The drawer reads the action's signals for its goal (AC-003); none here.
vi.mock('@/lib/actions/actionCenter', () => ({
  getActionSignals: vi.fn(async () => []),
  getPromptDemand: vi.fn(async () => ({})),
}));

import { HistoryTable } from './HistoryTable';
import { HistoryDrawer } from './HistoryDrawer';

const item = (overrides: Partial<ActionHistoryItem> = {}): ActionHistoryItem => ({
  id: 'action-id',
  actionNo: 1,
  kind: 'recover_visibility',
  type: 'recover',
  priorityScore: 72,
  priorityLevel: 'high',
  status: 'completed',
  outcome: 'pending_measurement',
  payload: {},
  kpiKeys: [],
  sources: [],
  triggerSignals: [],
  affected: [],
  results: [],
  positionOutcome: null,
  tasks: [],
  assignee: null,
  dueDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-05T00:00:00.000Z',
  timeToCloseDays: 4,
  ...overrides,
});

const counted = (type: AffectedEntity['type'], count: number): AffectedEntity => ({
  id: `${type}-count`,
  type,
  name: type,
  count,
});

async function render(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
  return root;
}

/** The value printed under a drawer label, e.g. the badges under "Affected". */
function textAfterLabel(label: string) {
  const heading = Array.from(document.body.querySelectorAll('p')).find(
    (p) => p.textContent === label,
  );
  return heading?.nextElementSibling?.textContent;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('HistoryTable', () => {
  it.each([
    ['prompt', 1, '1 prompt'],
    ['prompt', 3, '3 prompts'],
    ['url', 1, '1 page'],
    ['url', 3, '3 pages'],
    ['citation', 1, '1 signal'],
    ['citation', 3, '3 signals'],
    ['keyword', 1, '1 keyword'],
    ['keyword', 3, '3 keywords'],
    ['topic', 1, '1 topic'],
    ['topic', 3, '3 topics'],
    ['platform', 1, '1 platform'],
    ['platform', 3, '3 platforms'],
  ] as const)('shows %s × %i as "%s" in the Affected column', async (type, count, text) => {
    const root = await render(
      <HistoryTable
        items={[item({ affected: [counted(type, count)] })]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    const headers = Array.from(document.body.querySelectorAll('th')).map((th) => th.textContent);
    const cells = document.body.querySelectorAll('tbody td');
    expect(cells[headers.indexOf('Affected')]?.textContent).toBe(text);
    await act(async () => root.unmount());
  });

  it('says a result is so far until its final reading, a month on (learning B1)', async () => {
    const result = async (over: Partial<ActionHistoryItem>) => {
      const root = await render(
        <HistoryTable items={[item(over)]} selectedId={null} onSelect={() => {}} />,
      );
      const text = document.body.querySelector('tbody')!.textContent;
      await act(async () => root.unmount());
      return text;
    };
    const readings = [
      { day: 7, outcome: 'improved' as const },
      { day: 14, outcome: 'mixed' as const },
    ];
    expect(await result({ outcome: 'mixed', readings, outcomeFinal: false })).toContain(
      'so far: day 14 of 30',
    );
    expect(
      await result({
        outcome: 'improved',
        readings: [...readings, { day: 30, outcome: 'improved' }],
        outcomeFinal: true,
      }),
    ).not.toContain('so far');
  });

  // Only a completed action is measured; one dismissed before 00084 reads
  // not measurable, one since pending: neither is what happened.
  it.each(['not_measurable', 'pending_measurement'] as const)(
    'says a dismissed action (%s) was not measured because it was dismissed',
    async (outcome) => {
      const root = await render(
        <HistoryTable
          items={[item({ status: 'dismissed', outcome })]}
          selectedId={null}
          onSelect={() => {}}
        />,
      );
      const headers = Array.from(document.body.querySelectorAll('th')).map((th) => th.textContent);
      const cells = document.body.querySelectorAll('tbody td');
      expect(cells[headers.indexOf('Result')]?.textContent).toBe('Not measureddismissed');
      await act(async () => root.unmount());
    },
  );
});

describe('HistoryDrawer', () => {
  it.each([
    [1, '1 signal'],
    [3, '3 signals'],
  ])('shows %i affected signal(s) as "%s"', async (count, text) => {
    const root = await render(
      <HistoryDrawer
        brandId="b1"
        item={item({ affected: [counted('citation', count)] })}
        onOpenChange={() => {}}
      />,
    );
    expect(textAfterLabel('Affected')).toBe(text);
    await act(async () => root.unmount());
  });

  it.each([
    [1, '1 day'],
    [4, '4 days'],
  ])('shows a time to close of %i as "%s"', async (days, text) => {
    const root = await render(
      <HistoryDrawer brandId="b1" item={item({ timeToCloseDays: days })} onOpenChange={() => {}} />,
    );
    expect(textAfterLabel('Time to Close')).toBe(text);
    await act(async () => root.unmount());
  });
});
