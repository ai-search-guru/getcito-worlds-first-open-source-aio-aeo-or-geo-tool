import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditAutoStatus, AuditSettings, AutoAuditRun } from '@/lib/actions/audits';
import { AuditSettingsDialog, parsePatterns } from './_SettingsDialog';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  getAuditSettings: vi.fn(),
  saveAuditSettings: vi.fn(),
  setOpportunityPrefs: vi.fn(),
}));
vi.mock('@/lib/actions/audits', () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const BRAND = '33333333-3333-3333-3333-333333333333';

const settings = (over: Partial<AuditSettings> = {}): AuditSettings => ({
  autoAudit: { enabled: true, setting: null, perRun: 5, limit: 100 },
  emailAfterRun: false,
  excludePatterns: ['/careers/*'],
  pinned: [{ key: 'acme.com/about', url: 'https://acme.com/about' }],
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onSaved = vi.fn();
const onOpenChange = vi.fn();
const openUpgrade = vi.fn();

/** A billing month from Sep 22 to Oct 22 whose last run (day 28, Oct 19) is done. */
const schedule = (enabled = true): AuditAutoStatus => ({
  enabled,
  setting: null,
  emailAfterRun: false,
  perRun: 5,
  reserved: 0,
  used: 5,
  running: 0,
  periodStart: '2026-09-22T00:00:00.000Z',
  periodEnd: '2026-10-22T00:00:00.000Z',
  runs: [
    { day: 1, at: '2026-09-22T00:00:00.000Z', done: false },
    { day: 7, at: '2026-09-28T00:00:00.000Z', done: false },
    { day: 14, at: '2026-10-05T00:00:00.000Z', done: false },
    { day: 21, at: '2026-10-12T00:00:00.000Z', done: false },
    { day: 28, at: '2026-10-19T00:00:00.000Z', done: enabled },
  ],
  nextRun: null,
});
const latestRun: AutoAuditRun = {
  id: 'run-1',
  day: 28,
  status: 'completed',
  startedAt: '2026-10-19T06:00:00.000Z',
  finishedAt: '2026-10-19T06:40:00.000Z',
  pages: 5,
  completed: 5,
  running: 0,
  criticalIssues: 12,
};

async function render(
  canManage = true,
  timing?: { schedule: AuditAutoStatus; latestRun: AutoAuditRun | null },
  isLocked = false,
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <AuditSettingsDialog
            brandId={BRAND}
            open
            onOpenChange={onOpenChange}
            canManage={canManage}
            onSaved={onSaved}
            schedule={timing?.schedule}
            latestRun={timing?.latestRun}
            now={new Date('2026-10-19T12:00:00Z')}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
const button = (text: string) =>
  [...dialog().querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.getAuditSettings.mockResolvedValue(settings());
  actions.saveAuditSettings.mockImplementation(async () => settings());
  actions.setOpportunityPrefs.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('parsePatterns', () => {
  it('takes one pattern per line and drops blank ones', () => {
    expect(parsePatterns(' /careers/*\n\n/tag/* \n')).toEqual(['/careers/*', '/tag/*']);
  });
});

describe('AuditSettingsDialog', () => {
  it("shows the org's auto-audit share, the brand's patterns and its pinned pages", async () => {
    await render();
    expect(actions.getAuditSettings).toHaveBeenCalledWith(BRAND);
    const text = dialog().textContent;
    expect(text).toContain(
      '5 pages on days 1, 7, 14, 21 and 28 of your billing month: 25 of your 100 audits.',
    );
    expect(text).toContain('Applies to every brand in your organization.');
    expect(dialog().querySelector('textarea')!.value).toBe('/careers/*');
    expect(dialog().querySelector('li')!.textContent).toContain('/about');
    // Nothing changed yet.
    expect(button('Save').disabled).toBe(true);
  });

  it('saves only what changed, then reads the page again', async () => {
    await render();
    const [auto] = dialog().querySelectorAll('[role="checkbox"]');
    act(() => (auto as HTMLElement).click());
    expect(dialog().textContent).toContain('Off: all 100 audits a month are yours.');
    type(dialog().querySelector('textarea')!, '/careers/*\n/tag/*\n');

    await act(async () => button('Save').click());
    expect(actions.saveAuditSettings).toHaveBeenCalledWith(BRAND, {
      autoAudit: false,
      excludePatterns: ['/careers/*', '/tag/*'],
    });
    expect(toast.success).toHaveBeenCalledWith('Site Audit settings saved');
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens to read on a read-only workspace; Save and Unpin open the upgrade dialog', async () => {
    await render(true, undefined, true);
    const [auto] = dialog().querySelectorAll('[role="checkbox"]');
    act(() => (auto as HTMLElement).click());
    await act(async () => button('Save').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Saving the audit settings needs a plan');
    await act(async () => button('Unpin').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Unpinning pages needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(actions.saveAuditSettings).not.toHaveBeenCalled();
    expect(actions.setOpportunityPrefs).not.toHaveBeenCalled();
  });

  // The server reads the month's audits as 0 once the plan has ended.
  it('says "No active plan" on a read-only workspace, not "all 0 audits a month are yours"', async () => {
    actions.getAuditSettings.mockResolvedValue(
      settings({ autoAudit: { enabled: false, setting: null, perRun: 5, limit: 0 } }),
    );
    await render(true, undefined, true);
    expect(dialog().textContent).toContain('No active plan');
    expect(dialog().textContent).not.toContain('audits a month are yours');
  });

  it("shows the server's message when a pattern is refused", async () => {
    actions.saveAuditSettings.mockRejectedValue(
      new Error('"careers" isn\'t a page path. Start it with /, as in /legal/*.'),
    );
    await render();
    type(dialog().querySelector('textarea')!, 'careers');
    await act(async () => button('Save').click());
    expect(toast.error).toHaveBeenCalledWith(
      '"careers" isn\'t a page path. Start it with /, as in /legal/*.',
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("is read-only for members who can't manage it, pinned pages with no Unpin", async () => {
    await render(false);
    expect(dialog().textContent).toContain('Only admins and managers can change these settings.');
    expect(dialog().querySelector('textarea')!.disabled).toBe(true);
    expect(button('Save').disabled).toBe(true);
    expect(dialog().textContent).toContain('/about');
    expect(button('Unpin')).toBeUndefined();
    expect(actions.setOpportunityPrefs).not.toHaveBeenCalled();
  });

  it('lets admins and managers unpin a page', async () => {
    await render();
    await act(async () => button('Unpin').click());
    expect(actions.setOpportunityPrefs).toHaveBeenCalledWith(
      BRAND,
      ['https://acme.com/about'],
      null,
    );
    expect(dialog().textContent).toContain('No pinned pages. Pin them from Opportunities.');
  });

  it('says when the last run was and when the next one is', async () => {
    await render(true, { schedule: schedule(), latestRun });
    expect(dialog().textContent).toContain('Last run Oct 19 · Next run Oct 22');
  });

  it('says when the first run is once auto-audit is turned on, and nothing while off', async () => {
    actions.getAuditSettings.mockResolvedValue(
      settings({ autoAudit: { enabled: false, setting: false, perRun: 5, limit: 100 } }),
    );
    await render(true, { schedule: schedule(false), latestRun: null });
    expect(dialog().textContent).not.toContain('run Oct');
    act(() => (dialog().querySelector('#audit-auto') as HTMLElement).click());
    // Day 28's turn has started without it: the next daily sweep takes it.
    expect(dialog().textContent).toContain('First run within a day');
  });

  it('says what a plan without a monthly limit runs', async () => {
    actions.getAuditSettings.mockResolvedValue(
      settings({ autoAudit: { enabled: false, setting: null, perRun: 25, limit: -1 } }),
    );
    await render();
    expect(dialog().textContent).toContain('25 pages on days 1, 7, 14, 21 and 28 of the month.');
  });
});
