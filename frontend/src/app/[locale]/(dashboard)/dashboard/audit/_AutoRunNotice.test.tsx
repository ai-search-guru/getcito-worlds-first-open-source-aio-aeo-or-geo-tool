import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AutoAuditRun } from '@/lib/actions/audits';
import type { NextAutoRun } from '@/lib/auditAutoRuns';
import { AutoRunNotice } from './_AutoRunNotice';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND = 'brand-1';

const run = (over: Partial<AutoAuditRun> = {}): AutoAuditRun => ({
  id: 'run-1',
  day: 7,
  status: 'completed',
  startedAt: '2026-10-07T12:00:00.000Z',
  finishedAt: '2026-10-07T12:20:00.000Z',
  pages: 3,
  completed: 2,
  running: 0,
  criticalIssues: 3,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

function render(
  value: AutoAuditRun | null,
  nextRun: NextAutoRun | null = { at: '2026-10-14T00:00:00.000Z', soon: false },
  onViewPages?: () => void,
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AutoRunNotice brandId={BRAND} run={value} nextRun={nextRun} onViewPages={onViewPages} />
      </NextIntlClientProvider>,
    );
  });
}

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AutoRunNotice', () => {
  it('sums up the run with the next run date', () => {
    render(run({ pages: 2 }));
    expect(container.textContent).toBe(
      'Auto-audit · Oct 7 · 2 pages audited · 3 critical issues · next run Oct 14',
    );
  });

  it("counts the audits that failed, so they don't go missing", () => {
    render(run());
    expect(container.textContent).toBe(
      "Auto-audit · Oct 7 · 2 pages audited · 3 critical issues · 1 page couldn't be audited · next run Oct 14",
    );
  });

  it("says within a day when the next run's turn has started without it", () => {
    render(run({ pages: 2 }), { at: '2026-10-14T00:00:00.000Z', soon: true });
    expect(container.textContent).toContain('next run within a day');
  });

  it('leads to the pages the run audited', () => {
    const onViewPages = vi.fn();
    render(run(), null, onViewPages);
    const view = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'View pages',
    )!;
    act(() => view.click());
    expect(onViewPages).toHaveBeenCalled();
  });

  it('shows a run still going, and no next run when there is none', () => {
    render(run({ status: 'running', pages: 3, completed: 1, running: 2, criticalIssues: 0 }), null);
    expect(container.textContent).toBe('Auto-audit · Oct 7 · Auditing 3 pages · 1 done');
  });

  it('stays dismissed for that run, and shows the next one', () => {
    render(run());
    act(() => container.querySelector('button')!.click());
    expect(container.textContent).toBe('');
    expect(window.localStorage.getItem(`audit-auto-run-dismissed:${BRAND}`)).toBe('run-1');

    render(run());
    expect(container.textContent).toBe('');
    render(run({ id: 'run-2', startedAt: '2026-10-14T12:00:00.000Z' }));
    expect(container.textContent).toContain('Oct 14');
  });

  it('shows nothing without a run', () => {
    render(null);
    expect(container.textContent).toBe('');
  });
});
