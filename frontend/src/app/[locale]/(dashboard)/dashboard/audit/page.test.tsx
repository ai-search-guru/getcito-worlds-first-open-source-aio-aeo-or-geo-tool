import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Site Audit on a read-only workspace (plan not active): Run audit, by its
 * button or Enter in the address, opens the upgrade dialog instead of
 * starting an audit. On an active plan it starts one and opens it. Pin,
 * Exclude and Restore in the Opportunities inbox are for admins and managers.
 */

const audits = vi.hoisted(() => ({
  runAudit: vi.fn(),
  runAuditsBulk: vi.fn(),
  getAuditPages: vi.fn(),
  getAuditHub: vi.fn(),
  getAuditHubExtras: vi.fn(),
  setOpportunityPrefs: vi.fn(),
  getAuditSettings: vi.fn(),
  getAuditTemplates: vi.fn(),
  saveAuditSettings: vi.fn(),
  deleteAudit: vi.fn(),
}));
vi.mock('@/lib/actions/audits', () => audits);
const brandState = vi.hoisted(() => ({
  activeBrandId: 'b1',
  brands: [{ id: 'b1', name: 'Acme', domains: [{ domain: 'acme.com', isPrimary: true }] }],
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: Object.assign((select: (state: unknown) => unknown) => select(brandState), {
    getState: () => brandState,
  }),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canManage: role.canManage }) }));
const push = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// The page's cards and lists have tests of their own; here they stay out of the way.
vi.mock('./_SiteTrustCard', () => ({ SiteTrustCard: () => null }));
vi.mock('./_charts', () => ({ ScoreTrendChart: () => null }));
vi.mock('./_PagesTable', () => ({ AuditPagesTable: () => null }));
// The bulk bar shows only the buttons the page puts in it.
vi.mock('./_BulkBar', () => ({
  AuditBulkBar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ExportMenu: () => null,
}));
// The cards: what the page hands Pages audited (customer priorities item 11).
const cards = vi.hoisted(() => ({
  props: null as null | { coverage?: unknown; onShowNotAudited?: () => void },
}));
vi.mock('./_OverviewCards', () => ({
  AuditOverviewCards: (props: { coverage?: unknown; onShowNotAudited?: () => void }) => {
    cards.props = props;
    return null;
  },
}));
// The inbox: what the page hands it, and its bulk bar.
const inbox = vi.hoisted(() => ({
  props: null as null | {
    opportunities: { path: string }[];
    onSelect: (keys: string[], on: boolean) => void;
    onRestore?: (urls: string[]) => void;
  },
}));
vi.mock('./_OpportunitiesTable', async (importOriginal) => ({
  // The real helpers: what an audit of the rows starts.
  opportunityPagesToAudit: (await importOriginal<typeof import('./_OpportunitiesTable')>())
    .opportunityPagesToAudit,
  OpportunitiesTable: (props: {
    opportunities: { path: string }[];
    onSelect: (keys: string[], on: boolean) => void;
    onRestore?: (urls: string[]) => void;
    filters?: ReactNode;
    toolbar?: ReactNode;
  }) => {
    inbox.props = props;
    return (
      <div>
        {props.filters}
        {props.toolbar}
      </div>
    );
  },
  opportunityAuditUrls: () => [],
}));
vi.mock('./_SettingsDialog', () => ({ AuditSettingsDialog: () => null }));
vi.mock('./_AutoRunNotice', () => ({ AutoRunNotice: () => null }));
vi.mock('./_SummaryStrip', () => ({ AuditSummaryStrip: () => null }));
vi.mock('./_QuotaMeter', () => ({ EmptyPoolMessage: () => null }));
vi.mock('./_usePagesExport', () => ({
  usePagesExport: () => ({ exporting: false, exportAll: vi.fn(), exportPages: vi.fn() }),
}));
// Callable too: a page audited minutes ago asks with a plain toast.
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { default: SiteAuditPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  role.canManage = true;
  inbox.props = null;
  audits.getAuditHub.mockResolvedValue({
    pages: { pages: [], total: 0, primaryHost: 'acme.com' },
    quota: { used: 0, limit: 10, remaining: 10 },
    trend: null,
    overview: null,
  });
  audits.getAuditHubExtras.mockResolvedValue({
    opportunities: { opportunities: [], excluded: [] },
    latestRun: null,
  });
  audits.runAudit.mockResolvedValue({ audit: { id: 'a1' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <SiteAuditPage />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const runButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Run Audit')!;
const pressEnter = () =>
  act(async () => {
    container
      .querySelector('input[aria-label="Website URL"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });

describe('SiteAuditPage Run audit', () => {
  it('starts no audit on a read-only workspace: the button and Enter open the upgrade dialog', async () => {
    await render(true);
    await act(async () => runButton().click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Running an audit needs a plan');
    await pressEnter();
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(openUpgrade).toHaveBeenLastCalledWith('Running an audit needs a plan');
    expect(audits.runAudit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  // The server reads 0 of 0 without an active plan (noPlan): not "used up".
  it('keeps Run Audit clickable without an active plan, with no red 0/0: it opens the upgrade dialog', async () => {
    audits.getAuditHub.mockResolvedValue({
      pages: { pages: [], total: 0, primaryHost: 'acme.com' },
      quota: { used: 12, limit: 0, remaining: 0, noPlan: true },
      trend: null,
      overview: null,
    });
    await render(true);
    expect(runButton().disabled).toBe(false);
    expect(container.textContent).not.toContain('0/0');
    expect(container.querySelector('.text-destructive')).toBeNull();
    await act(async () => runButton().click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Running an audit needs a plan');
    expect(audits.runAudit).not.toHaveBeenCalled();
  });

  it('still keeps Run Audit off with the red count once an active plan is used up', async () => {
    audits.getAuditHub.mockResolvedValue({
      pages: { pages: [], total: 0, primaryHost: 'acme.com' },
      quota: { used: 10, limit: 10, remaining: 0 },
      trend: null,
      overview: null,
    });
    await render(false);
    expect(runButton().disabled).toBe(true);
    expect(container.querySelector('.text-destructive')?.textContent).toContain('0/10');
  });

  it('starts an audit on the button on an active plan, and opens it', async () => {
    await render(false);
    await act(async () => runButton().click());
    expect(audits.runAudit).toHaveBeenCalledExactlyOnceWith('b1', 'https://acme.com');
    expect(push).toHaveBeenCalledWith('/dashboard/audit/a1');
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('starts an audit on Enter on an active plan', async () => {
    await render(false);
    await pressEnter();
    expect(audits.runAudit).toHaveBeenCalledExactlyOnceWith('b1', 'https://acme.com');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

describe('SiteAuditPage a page audited minutes ago', () => {
  it('asks first: Open it opens that audit, Audit again starts a new one', async () => {
    const finishedAt = new Date(Date.now() - 4 * 60_000).toISOString();
    audits.runAudit
      .mockReset()
      .mockResolvedValueOnce({ recent: { auditId: 'a0', finishedAt } })
      .mockResolvedValueOnce({ audit: { id: 'a2' } });
    await render(false);
    await act(async () => runButton().click());

    expect(push).not.toHaveBeenCalled();
    const [question, options] = toast.mock.calls[0] as [
      string,
      { cancel: { onClick: () => void }; action: { onClick: () => void } },
    ];
    expect(question).toBe('Audited 4 min ago. Open it or audit again?');
    options.cancel.onClick();
    expect(push).toHaveBeenCalledWith('/dashboard/audit/a0');

    await act(async () => options.action.onClick());
    expect(audits.runAudit).toHaveBeenLastCalledWith('b1', 'https://acme.com', { force: true });
    expect(push).toHaveBeenLastCalledWith('/dashboard/audit/a2');
  });
});

describe('SiteAuditPage Opportunities', () => {
  const page = {
    key: 'acme.com/pricing',
    url: 'https://acme.com/pricing',
    path: '/pricing',
    title: 'Pricing',
    reasons: [],
    pinned: false,
    running: false,
    aiVisits: null,
    lastAudit: null,
    priority: 50,
    priorityParts: { value: 50, opportunity: 50, ease: 50 },
  };
  const selectPage = async () => {
    audits.getAuditHubExtras.mockResolvedValue({
      opportunities: { opportunities: [page], excluded: [], staleDays: 90 },
      latestRun: null,
    });
    await render(false);
    await act(async () => inbox.props!.onSelect([page.key], true));
  };
  const named = (name: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === name);

  it('opens the pages without a current audit from Pages audited, filtered (customer priorities item 11)', async () => {
    const coverage = { pages: 2, audited: 1, never: 1, stale: 0 };
    const notAudited = {
      ...page,
      key: 'acme.com/new',
      url: 'https://acme.com/new',
      path: '/new',
      reasons: [{ type: 'never_audited' }],
    };
    audits.getAuditHub.mockResolvedValue({
      pages: { pages: [], total: 1, primaryHost: 'acme.com' },
      quota: { used: 0, limit: 10, remaining: 10 },
      trend: null,
      overview: {
        primaryHost: 'acme.com',
        pages: 1,
        otherPages: 0,
        siteScore: 0.6,
        siteScoreChange: null,
        authority: null,
        eeat: null,
        lowestCategory: null,
        gaps: [],
      },
    });
    audits.getAuditHubExtras.mockResolvedValue({
      opportunities: { opportunities: [page, notAudited], excluded: [], staleDays: 90, coverage },
      latestRun: null,
    });
    // jsdom scrolls nothing; the list is scrolled to.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    await render(false);
    expect(cards.props!.coverage).toEqual(coverage);
    expect(inbox.props!.opportunities.map((o) => o.path)).toEqual(['/pricing', '/new']);
    await act(async () => cards.props!.onShowNotAudited!());
    expect(inbox.props!.opportunities.map((o) => o.path)).toEqual(['/new']);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(container.querySelector('[role=radio][aria-checked=true]')!.textContent).toBe(
      'Not audited1',
    );
    // All again, from its chip.
    await act(async () => (container.querySelector('[role=radio]') as HTMLElement).click());
    expect(inbox.props!.opportunities).toHaveLength(2);

    // Not audited's Audit all asks first, then audits them (part 2).
    await act(async () => cards.props!.onShowNotAudited!());
    audits.runAuditsBulk.mockResolvedValue({ started: 1, recent: [] });
    const auditAll = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Audit all 1',
    )!;
    await act(async () => auditAll.click());
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog.textContent).toContain('Audit 1 page');
    expect(dialog.textContent).toContain('Uses 1 of the 10 audits left this month.');
    expect(audits.runAuditsBulk).not.toHaveBeenCalled();
    const go = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent === 'Audit 1 page',
    )!;
    await act(async () => go.click());
    expect(audits.runAuditsBulk).toHaveBeenCalledWith('b1', ['https://acme.com/new']);
  });

  it('lets admins and managers pin, exclude and restore pages', async () => {
    await selectPage();
    expect(named('Pin')).toBeDefined();
    expect(named('Exclude')).toBeDefined();
    expect(inbox.props!.onRestore).toBeTypeOf('function');
    expect(container.textContent).not.toContain(
      'Only admins and managers can pin, exclude or restore pages.',
    );
  });

  it('gives other members no Pin, Exclude or Restore: they hold for the whole brand', async () => {
    role.canManage = false;
    await selectPage();
    expect(named('Pin')).toBeUndefined();
    expect(named('Exclude')).toBeUndefined();
    expect(inbox.props!.onRestore).toBeUndefined();
    expect(container.textContent).toContain(
      'Only admins and managers can pin, exclude or restore pages.',
    );
  });
});
