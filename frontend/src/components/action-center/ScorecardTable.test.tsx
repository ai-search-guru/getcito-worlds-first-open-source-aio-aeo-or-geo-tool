import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScorecardRow } from '@/lib/action-center/scorecard';
import messages from '../../../messages/en.json';
import { ScorecardTable } from './ScorecardTable';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function render(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const row = (overrides: Partial<ScorecardRow> = {}): ScorecardRow => ({
  kind: 'recover_lost_citations',
  completed: 0,
  improved: 0,
  mixed: 0,
  noChange: 0,
  declined: 0,
  notMeasurable: 0,
  pending: 0,
  final: 0,
  medianChange: null,
  dismissed: 0,
  dismissReasons: {},
  ...overrides,
});

const cells = (index: number) =>
  Array.from(document.body.querySelectorAll('tbody tr')[index].querySelectorAll('td')).map(
    (td) => td.textContent,
  );

describe('ScorecardTable', () => {
  it('shows what each kind did: results, rate, median change and why it was dismissed', async () => {
    await render(
      <ScorecardTable
        rows={[
          row({
            completed: 4,
            improved: 2,
            mixed: 1,
            declined: 1,
            medianChange: 0.15,
            dismissed: 2,
            dismissReasons: { not_now: 1, none: 1 },
          }),
        ]}
      />,
    );

    expect(cells(0)).toEqual([
      'Recover lost citations',
      '4',
      '2Improved1Mixed1Declined',
      '50%',
      '+15%',
      '2Mostly: Not now',
    ]);
  });

  /** A kind with a couple of results says so, rather than a rate of 0 or 100%. */
  it('says a kind has too few results for a rate', async () => {
    await render(
      <ScorecardTable
        rows={[
          row({
            kind: 'fix_low_scores',
            completed: 2,
            declined: 1,
            pending: 1,
            medianChange: -0.2,
          }),
        ]}
      />,
    );

    expect(cells(0)).toEqual([
      'Fix low-scoring pages',
      '2',
      '1Declined1Not measured',
      'Too few results',
      '−20%',
      '0',
    ]);
  });

  it('names a kind this build has no copy for from its id', async () => {
    await render(<ScorecardTable rows={[row({ kind: 'brand_new_kind', dismissed: 1 })]} />);

    expect(cells(0)[0]).toBe('Brand new kind');
    expect(cells(0)[2]).toBe('—');
  });

  it('says when there is nothing to score', async () => {
    await render(<ScorecardTable rows={[]} />);

    expect(document.body.textContent).toContain('Nothing to score in this range');
  });
});
