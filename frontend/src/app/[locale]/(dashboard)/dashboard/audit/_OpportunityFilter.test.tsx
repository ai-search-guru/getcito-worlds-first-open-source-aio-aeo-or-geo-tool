import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { OpportunityReason } from '@/lib/actions/audits';
import { OpportunityFilterChips, matchesFilter } from './_OpportunityFilter';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const row = (...reasons: OpportunityReason[]) => ({ reasons });
const never: OpportunityReason = { type: 'never_audited' };
const stale: OpportunityReason = { type: 'stale_audit', days: 120 };
const noAi: OpportunityReason = {
  type: 'no_ai_traffic',
  signal: 'revenue',
  percentile: 90,
  citationState: null,
};
const template: OpportunityReason = { type: 'template_gaps', gaps: [] };
const ROWS = [row(never), row(stale), row(noAi, never), row(noAi), row(template)];

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

describe('matchesFilter (customer priorities item 11)', () => {
  it('sorts rows by why they are listed, a template’s under All only', () => {
    expect(ROWS.filter((r) => matchesFilter(r, 'all'))).toHaveLength(5);
    expect(ROWS.filter((r) => matchesFilter(r, 'notAudited'))).toEqual([ROWS[0], ROWS[1], ROWS[2]]);
    expect(ROWS.filter((r) => matchesFilter(r, 'noAiTraffic'))).toEqual([ROWS[2], ROWS[3]]);
    expect(ROWS.filter((r) => matchesFilter(r, 'competitorCited'))).toEqual([]);
  });
});

describe('OpportunityFilterChips', () => {
  const render = (filter: Parameters<typeof matchesFilter>[1], rows = ROWS) => {
    const onFilter = vi.fn();
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <OpportunityFilterChips
            opportunities={rows}
            filter={filter}
            onFilter={onFilter}
            staleDays={90}
            action={<button type="button">Audit all</button>}
          />
        </NextIntlClientProvider>,
      ),
    );
    return onFilter;
  };
  const chips = () =>
    [...container.querySelectorAll('[role=radio]')].map((c) => [
      c.textContent,
      c.getAttribute('aria-checked'),
    ]);

  it('counts each filter with rows, picks one, and says what Not audited means', () => {
    const onFilter = render('notAudited');
    expect(chips()).toEqual([
      ['All5', 'false'],
      ['Not audited3', 'true'],
      ['No AI traffic2', 'false'],
    ]);
    expect(container.textContent).toContain('Never audited, or not in 90 days');
    expect(container.textContent).toContain('Audit all');
    act(() => (container.querySelectorAll('[role=radio]')[2] as HTMLElement).click());
    expect(onFilter).toHaveBeenCalledWith('noAiTraffic');
  });

  it('shows nothing when there is nothing to pick between', () => {
    render('all', [row(noAi), row(noAi)]);
    expect(container.textContent).toBe('');
    render('all');
    expect(container.textContent).not.toContain('Never audited, or not in');
  });
});
