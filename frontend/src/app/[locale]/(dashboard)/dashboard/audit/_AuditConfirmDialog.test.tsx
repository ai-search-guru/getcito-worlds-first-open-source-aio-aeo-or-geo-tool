import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditQuota } from '@/lib/actions/audits';
import { AuditConfirmDialog, auditPlan, type PageToAudit } from './_AuditConfirmDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = Date.parse('2026-11-01T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const page = (path: string, lastAuditAt: string | null = null): PageToAudit => ({
  url: `https://acme.com${path}`,
  path,
  lastAuditAt,
});
const PAGES = [
  page('/espresso-roast', ago(3)),
  page('/colombia-huila', ago(2)),
  page('/house-blend'),
  page('/old-guide', ago(120)),
  page('/decaf'),
  page('/kenya'),
];

describe('auditPlan (customer priorities item 11)', () => {
  it('leaves out pages audited in the last 7 days, unless included', () => {
    const plan = auditPlan(PAGES, { leaveOutRecent: true, remaining: null, now: NOW });
    expect(plan.recent.map((p) => p.path)).toEqual(['/espresso-roast', '/colombia-huila']);
    expect(plan.run.map((p) => p.path)).toEqual(['/house-blend', '/old-guide', '/decaf', '/kenya']);
    expect(auditPlan(PAGES, { leaveOutRecent: false, remaining: null, now: NOW }).run).toHaveLength(
      6,
    );
  });

  it('starts the first that fit what is left, in the order given, and the rest wait', () => {
    const plan = auditPlan(PAGES, { leaveOutRecent: true, remaining: 3, now: NOW });
    expect(plan.run.map((p) => p.path)).toEqual(['/house-blend', '/old-guide', '/decaf']);
    expect(plan.waiting).toBe(1);
    expect(auditPlan(PAGES, { leaveOutRecent: true, remaining: 0, now: NOW }).run).toEqual([]);
  });
});

describe('AuditConfirmDialog', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onConfirm.mockReset();
    onOpenChange.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  const render = (
    pages: PageToAudit[],
    quota: AuditQuota | null,
    over: Partial<{ mode: 'notAudited' | 'picked'; ordered: 'value' | 'shown' }> = {},
  ) =>
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <AuditConfirmDialog
            pages={pages}
            mode={over.mode ?? 'picked'}
            ordered={over.ordered ?? 'value'}
            staleDays={90}
            quota={quota}
            starting={false}
            now={NOW}
            onConfirm={onConfirm}
            onOpenChange={onOpenChange}
          />
        </NextIntlClientProvider>,
      ),
    );
  const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')!;
  const button = (name: RegExp) =>
    [...dialog().querySelectorAll('button')].find((b) => name.test(b.textContent ?? ''))!;
  const quota = (remaining: number): AuditQuota => ({
    used: 100 - remaining,
    limit: 100,
    remaining,
  });

  it('says which pages, what they use of the month, and starts them', () => {
    const pages = PAGES.slice(2);
    render(pages, quota(78), { mode: 'notAudited' });
    const text = dialog().textContent;
    expect(text).toContain('Audit 4 pages');
    expect(text).toContain(
      'The pages of your site never audited, or not in 90 days, most valuable first.',
    );
    expect(text).toContain('/house-blend, /old-guide, /decaf and 1 more');
    expect(text).toContain('Uses 4 of the 78 audits left this month.');
    act(() => button(/^Audit 4 pages$/).click());
    expect(onConfirm).toHaveBeenCalledWith(pages.map((p) => p.url));
  });

  it('leaves the pages audited this week out unless they are ticked back in', () => {
    render(PAGES, quota(78));
    const text = dialog().textContent;
    expect(text).toContain('Leave out the 2 pages audited in the last 7 days');
    expect(text).toContain('/espresso-roast on Oct 29 · /colombia-huila on Oct 30.');
    act(() => button(/^Audit 4 pages$/).click());
    expect(onConfirm).toHaveBeenLastCalledWith(PAGES.slice(2).map((p) => p.url));
    act(() => (dialog().querySelector('[role=checkbox]') as HTMLElement).click());
    act(() => button(/^Audit 6 pages$/).click());
    expect(onConfirm).toHaveBeenLastCalledWith(PAGES.map((p) => p.url));
  });

  it('starts the most valuable that fit past what is left, or the first shown, and none with none left', () => {
    render(PAGES.slice(2), quota(3));
    expect(dialog().textContent).toContain(
      'Only 3 left this month: the 3 most valuable go now, the other 1 stay in this list.',
    );
    expect(button(/^Audit 3 pages$/).disabled).toBe(false);
    render(PAGES.slice(2), quota(3), { ordered: 'shown' });
    expect(dialog().textContent).toContain(
      'Only 3 left this month: the first 3 go now, the other 1 stay selected.',
    );
    render(PAGES.slice(2), quota(0));
    expect(dialog().textContent).toContain('No audits left this month.');
    expect(button(/^Audit 0 pages$/).disabled).toBe(true);
  });

  it('says there is no limit on a plan without one', () => {
    render(PAGES.slice(2), { used: 3, limit: -1, remaining: -1 });
    expect(dialog().textContent).toContain('Your plan has no monthly limit.');
    expect(button(/^Audit 4 pages$/).disabled).toBe(false);
  });
});
