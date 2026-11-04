import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditQuota } from '@/lib/actions/audits';
import { AuditBulkBar } from './_BulkBar';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onReaudit = vi.fn();
const onExport = vi.fn();
const onClear = vi.fn();

function render(count: number, quota: AuditQuota | null, starting = false, audits?: number) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditBulkBar
          count={count}
          audits={audits}
          quota={quota}
          starting={starting}
          onAudit={onReaudit}
          onExport={onExport}
          onClear={onClear}
        />
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const usage = () =>
  container.querySelectorAll('[role=toolbar] > span')[1] as HTMLElement | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AuditBulkBar', () => {
  it("says how many of the month's audits a re-audit uses, and starts it", () => {
    render(3, { used: 270, limit: 500, remaining: 225, running: 5 });

    expect(container.textContent).toContain('3 selected');
    expect(usage()?.textContent).toBe('Uses 3 of your 225 audits');
    expect(usage()?.className).not.toContain('text-destructive');
    act(() => button('Re-audit').click());
    expect(onReaudit).toHaveBeenCalledOnce();

    act(() => (container.querySelector('[aria-label="Clear selection"]') as HTMLElement).click());
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('lets a selection over what is left start, the first that fit going now (item 11), and none with none left', () => {
    render(12, { used: 92, limit: 100, remaining: 8 });
    expect(usage()?.textContent).toBe('Uses 12 of your 8 audits · 8 go now, the rest wait');
    expect(usage()?.className).toContain('text-amber-700');
    expect(button('Re-audit').disabled).toBe(false);

    render(1, { used: 100, limit: 100, remaining: 0 });
    expect(usage()?.textContent).toBe('No audits left this month');
    expect(button('Re-audit').disabled).toBe(true);
  });

  it('keeps Re-audit clickable without an active plan, with no "none left" (0 of 0 is no plan)', () => {
    render(2, { used: 40, limit: 0, remaining: 0, noPlan: true });
    expect(container.textContent).not.toContain('No audits left this month');
    expect(container.querySelector('.text-destructive')).toBeNull();
    expect(button('Re-audit').disabled).toBe(false);
    act(() => button('Re-audit').click());
    expect(onReaudit).toHaveBeenCalledOnce();
  });

  it("says the runs' share is still scheduled when the user's is used up (SA-019)", () => {
    // The spec's example: 100 auto and 375 of the user's used, day 28's 25 to come.
    render(1, {
      used: 475,
      running: 0,
      limit: 500,
      remaining: 0,
      auto: {
        enabled: true,
        setting: null,
        emailAfterRun: false,
        perRun: 25,
        reserved: 25,
        used: 100,
        running: 0,
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
        runs: [],
        nextRun: { day: 28, at: '2026-10-28T00:00:00.000Z' },
      },
    });
    expect(container.querySelector('[role=toolbar] p')?.textContent).toBe(
      "You've used your 375 audits. 25 auto audits are still scheduled. Turn off auto-audit to use them now, or upgrade.",
    );
    expect(button('Re-audit').disabled).toBe(true);
  });

  it("counts a template's pages, not the rows, against what's left (SA-007)", () => {
    render(1, { used: 0, limit: 100, remaining: 20 }, false, 26);
    expect(usage()?.textContent).toBe('Uses 26 of your 20 audits · 20 go now, the rest wait');
    expect(button('Re-audit').disabled).toBe(false);
    // Nothing to audit (a template audited in full): the button stays off.
    render(1, { used: 0, limit: 100, remaining: 20 }, false, 0);
    expect(button('Re-audit').disabled).toBe(true);
  });

  it('counts nothing against an unlimited plan', () => {
    render(40, { used: 0, limit: -1, remaining: -1 });
    expect(usage()).toBeUndefined();
    expect(button('Re-audit').disabled).toBe(false);
  });

  it("takes the table's own audit label and actions, and leaves Export out without one", () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <AuditBulkBar
            count={2}
            quota={{ used: 0, limit: 500, remaining: 500 }}
            starting={false}
            auditLabel="Audit selected"
            onAudit={onReaudit}
            onClear={onClear}
          >
            <button type="button">Pin</button>
          </AuditBulkBar>
        </NextIntlClientProvider>,
      );
    });
    expect(button('Audit selected')).toBeDefined();
    expect(button('Pin')).toBeDefined();
    expect(button('Export')).toBeUndefined();
  });

  it('waits while a bulk start is on its way', () => {
    render(3, { used: 0, limit: 500, remaining: 500 }, true);
    expect(button('Re-audit').disabled).toBe(true);
  });
});
