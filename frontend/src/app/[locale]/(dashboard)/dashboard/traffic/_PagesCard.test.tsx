import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type {
  TrafficBrokenLink,
  TrafficDateWindow,
  TrafficPageRow,
  TrafficPages,
} from '@/lib/actions/traffic';

/**
 * The Pages section (AT-006): three work lists and the full list, each with
 * its count, read for the page's range; a row's next step is an audit or
 * prompts that point to the page, and its menu sends it to the Action
 * Center. Under the two lists Action Center works from, the pages shown go
 * as one action and their cited pages are audited at once, within the
 * month's audits (part B).
 */

const getTrafficPages = vi.fn();
const sendTrafficPagesToActionCenter = vi.fn();
const runAudit = vi.fn();
const runAuditsBulk = vi.fn();
const getAuditQuota = vi.fn();
const push = vi.fn();
// Callable too: a page audited minutes ago asks with a plain toast.
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    error: vi.fn(),
    loading: vi.fn(() => 'toast-1'),
    success: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
);
vi.mock('@/lib/actions/traffic', () => ({
  sendTrafficPagesToActionCenter: (...args: unknown[]) => sendTrafficPagesToActionCenter(...args),
}));
vi.mock('@/lib/trafficReads', () => ({
  getTrafficPages: (...args: unknown[]) => getTrafficPages(...args),
}));
vi.mock('@/lib/actions/audits', () => ({
  runAudit: (...args: unknown[]) => runAudit(...args),
  runAuditsBulk: (...args: unknown[]) => runAuditsBulk(...args),
  getAuditQuota: (...args: unknown[]) => getAuditQuota(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
  useRouter: () => ({ push }),
}));
vi.mock('sonner', () => ({ toast }));
// The viewer: a manager unless a test says otherwise.
const viewer = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ canManage: viewer.canManage }),
}));
const suggestForPage = vi.fn();
vi.mock('@/lib/actions/content', () => ({
  generateOpportunitiesOnDemand: vi.fn(),
  getGenerationJobStatus: vi.fn(),
}));
vi.mock('@/lib/contentJob', () => ({
  suggestForPage: (...args: unknown[]) => suggestForPage(...args),
}));
// The suggested-prompts dialog (part B2) is tested on its own: here, which
// page it opens for, and that tracking reads the list again.
vi.mock('./_PagePromptsDialog', () => ({
  PagePromptsDialog: ({ page, onTracked }: { page: string | null; onTracked: () => void }) =>
    page ? (
      <div data-testid="prompts-dialog">
        {`prompts for ${page}`}
        <button type="button" onClick={onTracked}>
          tracked
        </button>
      </div>
    ) : null,
}));

const { PagesCard } = await import('./_PagesCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '33333333-3333-3333-3333-333333333333';
const WEEK: TrafficDateWindow = { dateFrom: '2026-10-11T09:00:00.000Z' };

const page = (over: Partial<TrafficPageRow> = {}): TrafficPageRow => ({
  page: '/gifts',
  aiVisits: 0,
  aiKeyEvents: 0,
  aiPlatforms: [],
  citations: 0,
  targetingPrompts: 0,
  sessions: 320,
  engagedSessions: 200,
  keyEvents: 12,
  transactions: 0,
  revenue: 0,
  engagementSeconds: 0,
  inSitemap: true,
  broken: false,
  valueRank: 1,
  ...over,
});

const pages = (
  rows: TrafficPageRow[],
  counts: Partial<TrafficPages['counts']> = {},
  brokenLinks: TrafficBrokenLink[] = [],
): TrafficPages => ({
  counts: {
    noAiTraffic: 3,
    citedNotClicked: 1,
    trafficNoPrompt: 2,
    brokenAiLinks: 2,
    all: 14,
    ...counts,
  },
  rows,
  brokenLinks,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  viewer.canManage = true;
  getTrafficPages.mockReset();
  sendTrafficPagesToActionCenter.mockReset();
  runAudit.mockReset();
  runAuditsBulk.mockReset();
  // Unlimited unless a test says otherwise.
  getAuditQuota.mockReset().mockResolvedValue({ used: 3, limit: -1, remaining: -1 });
  push.mockReset();
  toast.mockClear();
  for (const fn of [toast.error, toast.loading, toast.success, toast.info, toast.dismiss]) {
    fn.mockClear();
  }
  suggestForPage.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const openUpgrade = vi.fn();
async function render({
  domain = 'acme-coffee.example.com',
  analyticsMissing = false,
  isLocked = false,
}: { domain?: string; analyticsMissing?: boolean; isLocked?: boolean } = {}) {
  // Each list's own Excel / CSV, told apart by name.
  const exportButton = (name: string) => <span data-testid="export">{name}</span>;
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <PagesCard
            brandId={BRAND}
            dateWindow={WEEK}
            rangeLabel="Last 7 days"
            domain={domain}
            analyticsMissing={analyticsMissing}
            actions={exportButton('pages by status')}
            brokenActions={exportButton('redirect list')}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const text = () => container.textContent ?? '';
const tab = (label: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) =>
    el.textContent?.startsWith(label),
  )!;
const dialog = () =>
  container.querySelector('[data-testid="prompts-dialog"]')?.firstChild?.textContent ?? null;
const button = (label: string) =>
  [...container.querySelectorAll<HTMLElement>('button, a')].find((el) => el.textContent === label)!;

describe('PagesCard', () => {
  it('opens on No AI traffic for the page range, with every list counted', async () => {
    getTrafficPages.mockResolvedValue(
      pages([
        page({ citations: 6 }),
        page({ page: '/menu', targetingPrompts: 2, keyEvents: 4, valueRank: 2 }),
        page({ page: '/about', keyEvents: 0, valueRank: 3 }),
      ]),
    );
    await render();

    expect(getTrafficPages).toHaveBeenCalledWith(BRAND, WEEK, { tab: 'noAiTraffic', limit: 10 });
    expect(tab('No AI traffic').textContent).toBe('No AI traffic3');
    expect(tab('Cited, not clicked').textContent).toBe('Cited, not clicked1');
    expect(tab('Traffic, no prompt').textContent).toBe('Traffic, no prompt2');
    expect(tab('All pages').textContent).toBe('All pages14');

    // Why AI engines skip each page, ranked by key events.
    expect(text()).toContain('6 citations in answers');
    expect(text()).toContain('2 prompts target this page');
    expect(text()).toContain('nothing you track points here');
    expect(text()).toContain('ConversionsRank by conversions');
    expect(text()).toContain('32012#1');
    expect(text()).toContain('3 of 3 pages · same range as the rest of the page');
    expect(text()).not.toContain('Show more');
  });

  it('audits a cited page and offers prompts for one nothing points at', async () => {
    getTrafficPages.mockResolvedValue(
      pages([page({ citations: 6 }), page({ page: '/about', valueRank: 2 })]),
    );
    runAudit.mockResolvedValue({ audit: { id: 'audit-1' } });
    await render();

    // Nothing points at /about: its next step is prompts suggested for it.
    await act(async () => button('Add prompts').click());
    expect(dialog()).toBe('prompts for /about');

    await act(async () => button('Audit page').click());
    expect(runAudit).toHaveBeenCalledWith(BRAND, 'https://acme-coffee.example.com/gifts');
    expect(push).toHaveBeenCalledWith('/dashboard/audit/audit-1');
  });

  it('leaves an analyst Audit and Send, not Add prompts or Suggest content', async () => {
    viewer.canManage = false;
    getTrafficPages.mockResolvedValue(
      pages([page({ citations: 6 }), page({ page: '/about', valueRank: 2 })]),
    );
    await render();
    const labels = () =>
      [...document.body.querySelectorAll('button, [role="menuitem"]')].map((el) =>
        el.textContent?.trim(),
      );
    expect(labels()).not.toContain('Add prompts');
    expect(container.textContent).toContain('Ask an admin or a manager to add prompts.');
    expect(labels()).toContain('Audit page');
    const menu = container.querySelector<HTMLElement>('[aria-label^="More actions for"]')!;
    await act(async () => menu.click());
    expect(labels()).toContain('Send to Action Center');
    expect(labels()).not.toContain('Suggest content');
  });

  it('audits, suggests and sends nothing on a read-only workspace: the upgrade dialog instead', async () => {
    openUpgrade.mockReset();
    getTrafficPages.mockResolvedValue(
      pages([page({ citations: 6 }), page({ page: '/about', valueRank: 2 })]),
    );
    await render({ isLocked: true });
    await act(async () => button('Add prompts').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Suggesting prompts needs a plan');
    expect(dialog()).toBeNull();
    await act(async () => button('Audit page').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Running an audit needs a plan');
    await act(async () => button('Send to Action Center').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Sending actions needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(3);
    expect(runAudit).not.toHaveBeenCalled();
    expect(sendTrafficPagesToActionCenter).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("can't audit without the brand's domain", async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 6 })]));
    await render({ domain: '' });
    expect(button('Audit page').hasAttribute('disabled')).toBe(true);
  });

  it('reads another list from the first ten, with its own columns', async () => {
    getTrafficPages.mockResolvedValue(pages([]));
    await render();
    getTrafficPages.mockResolvedValue(
      pages([
        page({
          page: '/subscriptions',
          aiVisits: 7,
          aiKeyEvents: 2,
          aiPlatforms: ['chatgpt.com', 'perplexity.ai'],
        }),
      ]),
    );
    await act(async () => tab('Traffic, no prompt').click());

    expect(getTrafficPages).toHaveBeenLastCalledWith(BRAND, WEEK, {
      tab: 'trafficNoPrompt',
      limit: 10,
    });
    expect(text()).toContain('/subscriptions');
    expect(text()).toContain('ChatGPT, Perplexity');
    await act(async () => button('Add prompts').click());
    expect(dialog()).toBe('prompts for /subscriptions');
  });

  it("never shows one list's rows under another's columns while it loads", async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 25 })]));
    await render();
    expect(text()).toContain('/gifts');

    getTrafficPages.mockReturnValue(new Promise(() => {}));
    await act(async () => tab('Traffic, no prompt').click());
    expect(text()).not.toContain('/gifts');
    expect(text()).not.toContain('Show more');
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows ten more pages at a time', async () => {
    getTrafficPages.mockResolvedValue(
      pages(
        Array.from({ length: 10 }, (_, i) => page({ page: `/p${i}` })),
        { noAiTraffic: 12 },
      ),
    );
    await render();
    expect(text()).toContain('10 of 12 pages');

    await act(async () => button('Show more').click());
    expect(getTrafficPages).toHaveBeenLastCalledWith(BRAND, WEEK, {
      tab: 'noAiTraffic',
      limit: 20,
    });
  });

  it('labels every list a page is on in All pages', async () => {
    getTrafficPages.mockResolvedValue(pages([]));
    await render();
    getTrafficPages.mockResolvedValue(
      pages([
        page({ citations: 25, sessions: 40 }),
        page({ page: '/subscriptions', aiVisits: 8, citations: 4 }),
        // A missing page AI visitors land on is a broken link, not Traffic, no prompt (AT-012).
        page({ page: '/old-menu', aiVisits: 2, sessions: 0, inSitemap: false, broken: true }),
      ]),
    );
    await act(async () => tab('All pages').click());

    const badges = [...container.querySelectorAll('tbody [data-slot="badge"]')].map(
      (b) => b.textContent,
    );
    expect(badges).toEqual(['No AI traffic', 'Cited, not clicked', 'Broken AI links']);
    // A page on no list is doing fine.
    const status = [...container.querySelectorAll('tbody tr')][1].lastElementChild;
    expect(status?.textContent).toBe('—');
  });

  it("says when a list is empty, when it couldn't load, and what needs Analytics", async () => {
    getTrafficPages.mockResolvedValue(pages([], { noAiTraffic: 0 }));
    await render({ analyticsMissing: true });
    expect(text()).toContain('Every page with traffic or in your sitemap got AI visits');
    expect(text()).toContain('the No AI traffic list need Google Analytics');

    getTrafficPages.mockRejectedValue(new Error('Server error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => tab('Cited, not clicked').click());
    expect(text()).toContain("The pages couldn't be loaded.");
  });

  it('lists the broken AI links with where to redirect each, and exports the redirect list (AT-012)', async () => {
    getTrafficPages.mockResolvedValue(pages([]));
    await render();
    expect(tab('Broken AI links').textContent).toBe('Broken AI links2');
    const exported = () => container.querySelector('[data-testid="export"]')?.textContent;
    expect(exported()).toBe('pages by status');

    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    getTrafficPages.mockResolvedValue(
      pages([], { brokenAiLinks: 3 }, [
        {
          page: '/guides/espresso-machine-for-beginner',
          visits: 3,
          platforms: ['chatgpt.com', 'perplexity.ai'],
          citations: 14,
          lastVisit: hoursAgo(5),
          status: '404',
          target: '/guides/espresso-machines-for-beginners',
          targetReason: 'similar',
        },
        {
          page: '/subscriptions/old-plan',
          visits: 1,
          platforms: [],
          citations: 0,
          lastVisit: hoursAgo(30),
          status: 'title',
          target: '/subscriptions',
          targetReason: 'parent',
        },
        {
          page: '/index.php',
          visits: 1,
          platforms: [],
          citations: 0,
          lastVisit: hoursAgo(30),
          status: '404',
          target: null,
          targetReason: 'query',
        },
      ]),
    );
    await act(async () => tab('Broken AI links').click());

    expect(getTrafficPages).toHaveBeenLastCalledWith(BRAND, WEEK, {
      tab: 'brokenAiLinks',
      limit: 10,
    });
    const rows = [...container.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      [
        '/guides/espresso-machine-for-beginnerNot found (404)',
        '3',
        'ChatGPT, Perplexity',
        '14',
        '5h ago',
        '→ /guides/espresso-machines-for-beginnersSimilar page',
      ],
      [
        '/subscriptions/old-planPage title says not found',
        '1',
        '—',
        '0',
        '1d ago',
        '→ /subscriptionsThe page above it',
      ],
      [
        '/index.phpNot found (404)',
        '1',
        '—',
        '0',
        '1d ago',
        '—Missing addresses have a query: no redirect suggested',
      ],
    ]);
    expect(text()).toContain('3 of 3 pages');
    // Its Excel / CSV is the redirect list; no Action Center footer.
    expect(exported()).toBe('redirect list');
    expect(text()).not.toContain('Send to Action Center');
  });

  it('says how broken links show up when there are none', async () => {
    getTrafficPages.mockResolvedValue(pages([], { brokenAiLinks: 0 }));
    await render();
    await act(async () => tab('Broken AI links').click());
    expect(text()).toContain('when your 404 page carries the tracking snippet too');
    expect(text()).not.toContain('{');
  });

  it('audits a page on a domain stored with its scheme', async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 6 })]));
    runAudit.mockResolvedValue({ audit: { id: 'audit-2' } });
    await render({ domain: 'https://acme-coffee.example.com/' });
    await act(async () => button('Audit page').click());
    expect(runAudit).toHaveBeenCalledWith(BRAND, 'https://acme-coffee.example.com/gifts');
  });
});

describe('PagesCard actions (AT-006 part B)', () => {
  it('sends the No AI traffic pages shown as one action', async () => {
    getTrafficPages.mockResolvedValue(
      pages([page({ citations: 6 }), page({ page: '/about', valueRank: 2 })]),
    );
    sendTrafficPagesToActionCenter.mockResolvedValue({
      actionId: 'act-1',
      actionNo: 71,
      created: true,
    });
    await render();

    await act(async () => button('Send to Action Center').click());
    expect(sendTrafficPagesToActionCenter).toHaveBeenCalledWith(
      BRAND,
      WEEK,
      ['/gifts', '/about'],
      'no_ai_traffic',
    );
    expect(toast.success).toHaveBeenCalledWith(
      'Sent to the Action Center',
      expect.objectContaining({ description: 'AC-71 · 2 pages' }),
    );
    // Its Open goes to the action.
    const { action } = toast.success.mock.calls[0][1] as { action: { onClick: () => void } };
    action.onClick();
    expect(push).toHaveBeenCalledWith('/dashboard/action-center/actions?action=act-1');
  });

  it('says when the pages are already in the Action Center, or why they could not go', async () => {
    getTrafficPages.mockResolvedValue(pages([page()]));
    sendTrafficPagesToActionCenter.mockResolvedValue({
      actionId: 'act-1',
      actionNo: 71,
      created: false,
    });
    await render();
    await act(async () => button('Send to Action Center').click());
    expect(toast.info).toHaveBeenCalledWith(
      'Already in the Action Center',
      expect.objectContaining({ description: 'AC-71 is open with these pages.' }),
    );

    sendTrafficPagesToActionCenter.mockResolvedValue({
      error: 'None of these pages are on the list for this range',
    });
    await act(async () => button('Send to Action Center').click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't send to the Action Center", {
      id: 'toast-1',
      description: 'None of these pages are on the list for this range',
    });
  });

  it('sends one page from its row menu', async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 6 })]));
    sendTrafficPagesToActionCenter.mockResolvedValue({
      actionId: 'act-2',
      actionNo: 72,
      created: true,
    });
    await render();

    const trigger = container.querySelector<HTMLElement>('[aria-label="More actions for /gifts"]')!;
    await act(async () => trigger.click());
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Send to Action Center',
    )!;
    await act(async () => item.click());
    expect(sendTrafficPagesToActionCenter).toHaveBeenCalledWith(
      BRAND,
      WEEK,
      ['/gifts'],
      'no_ai_traffic',
    );
  });

  it('audits the cited pages of No AI traffic at once', async () => {
    getTrafficPages.mockResolvedValue(
      pages([
        page({ citations: 6 }),
        page({ page: '/menu', citations: 2, valueRank: 2 }),
        page({ page: '/about', valueRank: 3 }),
      ]),
    );
    runAuditsBulk.mockResolvedValue({ started: 2, recent: [] });
    await render();

    await act(async () => button('Audit 2 cited pages').click());
    expect(runAuditsBulk).toHaveBeenCalledWith(BRAND, [
      'https://acme-coffee.example.com/gifts',
      'https://acme-coffee.example.com/menu',
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      '2 audits started',
      expect.objectContaining({ description: expect.stringContaining('Site Audit') }),
    );
    // The month's audits are read again after.
    expect(getAuditQuota).toHaveBeenCalledTimes(2);
  });

  it('asks first about a page audited minutes ago: Open it, or Audit again', async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 6 })]));
    const finishedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    runAudit
      .mockResolvedValueOnce({ recent: { auditId: 'audit-0', finishedAt } })
      .mockResolvedValueOnce({ audit: { id: 'audit-3' } });
    await render();

    await act(async () => button('Audit page').click());
    expect(push).not.toHaveBeenCalled();
    const [question, options] = toast.mock.calls[0] as [
      string,
      { cancel: { onClick: () => void }; action: { onClick: () => void } },
    ];
    expect(question).toBe('Audited 3 min ago. Open it or audit again?');

    options.cancel.onClick();
    expect(push).toHaveBeenCalledWith('/dashboard/audit/audit-0');

    await act(async () => options.action.onClick());
    expect(runAudit).toHaveBeenLastCalledWith(BRAND, 'https://acme-coffee.example.com/gifts', {
      force: true,
    });
    expect(push).toHaveBeenLastCalledWith('/dashboard/audit/audit-3');
  });

  it('says which pages were audited minutes ago and not started, with Audit again', async () => {
    getTrafficPages.mockResolvedValue(
      pages([page({ citations: 6 }), page({ page: '/menu', citations: 2, valueRank: 2 })]),
    );
    const menu = 'https://acme-coffee.example.com/menu';
    runAuditsBulk
      .mockResolvedValueOnce({
        started: 1,
        recent: [{ url: menu, auditId: 'audit-0', finishedAt: new Date().toISOString() }],
      })
      .mockResolvedValueOnce({ started: 1, recent: [] });
    await render();

    await act(async () => button('Audit 2 cited pages').click());
    expect(toast.success).toHaveBeenCalledWith('1 audit started', expect.anything());
    const [notice, options] = toast.mock.calls[0] as [string, { action: { onClick: () => void } }];
    expect(notice).toBe("1 page was audited in the last 10 minutes, so it wasn't audited again.");

    await act(async () => options.action.onClick());
    expect(runAuditsBulk).toHaveBeenLastCalledWith(BRAND, [menu], { force: true });
  });

  it('sends and audits Cited, not clicked as its own list', async () => {
    getTrafficPages.mockResolvedValue(pages([]));
    await render();
    getTrafficPages.mockResolvedValue(
      pages([
        page({ page: '/guides/espresso', citations: 80, sessions: 0 }),
        page({ page: '/shop/beans', citations: 22 }),
      ]),
    );
    await act(async () => tab('Cited, not clicked').click());
    sendTrafficPagesToActionCenter.mockResolvedValue({
      actionId: 'act-3',
      actionNo: 73,
      created: true,
    });
    runAuditsBulk.mockResolvedValue({ started: 2, recent: [] });

    await act(async () => button('Send to Action Center').click());
    expect(sendTrafficPagesToActionCenter).toHaveBeenCalledWith(
      BRAND,
      WEEK,
      ['/guides/espresso', '/shop/beans'],
      'cited_not_clicked',
    );
    await act(async () => button('Audit 2 pages').click());
    expect(runAuditsBulk).toHaveBeenCalledWith(BRAND, [
      'https://acme-coffee.example.com/guides/espresso',
      'https://acme-coffee.example.com/shop/beans',
    ]);
  });

  it("won't start more audits than the month has left", async () => {
    getAuditQuota.mockResolvedValue({ used: 99, limit: 100, remaining: 1 });
    getTrafficPages.mockResolvedValue(
      pages([page({ citations: 6 }), page({ page: '/menu', citations: 2, valueRank: 2 })]),
    );
    await render();
    expect(text()).toContain('2 audits, 1 left this month');
    expect(button('Audit 2 cited pages').hasAttribute('disabled')).toBe(true);

    getAuditQuota.mockResolvedValue({ used: 100, limit: 100, remaining: 0 });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(text()).toContain('No audits left this month');
  });

  it('offers no footer actions on Traffic, no prompt or All pages', async () => {
    getTrafficPages.mockResolvedValue(pages([page({ aiVisits: 3, citations: 0 })]));
    await render();
    await act(async () => tab('Traffic, no prompt').click());
    expect(button('Send to Action Center')).toBeUndefined();
    await act(async () => tab('All pages').click());
    expect(button('Send to Action Center')).toBeUndefined();
    expect(container.querySelector('[aria-label^="More actions"]')).toBeNull();
  });

  it('suggests prompts from the row menu of a page whose next step is an audit', async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 6 })]));
    await render();
    const trigger = container.querySelector<HTMLElement>('[aria-label="More actions for /gifts"]')!;
    await act(async () => trigger.click());
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Add prompts',
    )!;
    await act(async () => item.click());
    expect(dialog()).toBe('prompts for /gifts');
  });

  it('reads the list again once prompts were tracked', async () => {
    getTrafficPages.mockResolvedValue(pages([page({ page: '/about', valueRank: 2 })]));
    await render();
    await act(async () => button('Add prompts').click());
    expect(getTrafficPages).toHaveBeenCalledTimes(1);
    await act(async () => button('tracked').click());
    expect(getTrafficPages).toHaveBeenCalledTimes(2);
  });

  const suggestFromMenu = async (pagePath: string) => {
    const trigger = container.querySelector<HTMLElement>(
      `[aria-label="More actions for ${pagePath}"]`,
    )!;
    await act(async () => trigger.click());
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Suggest content',
    )!;
    await act(async () => item.click());
  };

  it("suggests content for a row's page and opens it (part B3)", async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 6 })]));
    suggestForPage.mockResolvedValue({ kind: 'created', opportunityId: 'o1' });
    await render();
    await suggestFromMenu('/gifts');

    expect(suggestForPage).toHaveBeenCalledWith(BRAND, '/gifts', expect.anything());
    expect(toast.loading).toHaveBeenCalledWith('Writing a content suggestion for /gifts…');
    expect(toast.success).toHaveBeenCalledWith(
      'Content suggestion created',
      expect.objectContaining({ id: 'toast-1' }),
    );
    const { action } = toast.success.mock.calls[0][1] as { action: { onClick: () => void } };
    action.onClick();
    expect(push).toHaveBeenCalledWith('/dashboard/content?opportunity=o1');
  });

  it('offers to add prompts when no tracked prompt is about the page', async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 6 })]));
    suggestForPage.mockResolvedValue({ kind: 'noMatch' });
    await render();
    await suggestFromMenu('/gifts');

    expect(toast.info).toHaveBeenCalledWith(
      'No tracked prompts are about /gifts yet',
      expect.objectContaining({
        description: expect.stringContaining('Add prompts for this page'),
      }),
    );
    const { action } = toast.info.mock.calls[0][1] as { action: { onClick: () => void } };
    await act(async () => action.onClick());
    expect(dialog()).toBe('prompts for /gifts');
  });

  it("says when the month's content suggestions are used up, or one exists", async () => {
    getTrafficPages.mockResolvedValue(pages([page({ citations: 6 })]));
    suggestForPage.mockResolvedValue({ kind: 'limited' });
    await render();
    await suggestFromMenu('/gifts');
    expect(toast.error).toHaveBeenCalledWith('Monthly content limit reached.', { id: 'toast-1' });

    suggestForPage.mockResolvedValue({ kind: 'existing', opportunityId: 'o9' });
    await suggestFromMenu('/gifts');
    expect(toast.info).toHaveBeenCalledWith(
      'This page already has a content suggestion',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Open existing' }) }),
    );
  });
});
