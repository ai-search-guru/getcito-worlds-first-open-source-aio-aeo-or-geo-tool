import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { PlanOpportunity, PlanPage } from '@/lib/content/plan';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import ContentPlanPage from './page';

const getContentPlan = vi.fn();
const getContentPlanInsights = vi.fn();
const setPlanRowPriority = vi.fn();
const hidePlanRow = vi.fn();
const showPlanRow = vi.fn();
vi.mock('@/lib/actions/contentPlan', () => ({
  getContentPlan: (...args: unknown[]) => getContentPlan(...args),
  getContentPlanInsights: (...args: unknown[]) => getContentPlanInsights(...args),
  setPlanRowPriority: (...args: unknown[]) => setPlanRowPriority(...args),
  hidePlanRow: (...args: unknown[]) => hidePlanRow(...args),
  showPlanRow: (...args: unknown[]) => showPlanRow(...args),
}));
const listBrandMembers = vi.fn();
vi.mock('@/lib/actions/team', () => ({
  listBrandMembers: (...args: unknown[]) => listBrandMembers(...args),
}));
// Assigning a draft's task is _assign-dialog's; here, which rows open it.
vi.mock('./_AssignDialog', () => ({
  AssignDialog: ({ row }: { row: { title: string } | null }) =>
    row ? <div data-testid="assign-dialog">{row.title}</div> : null,
}));
// Shopping opportunities are _ShoppingOpportunities.test.tsx's; here, for
// which brands, and that a new period's read keeps them (each mount reads).
const shopping = vi.hoisted(() => ({ mounts: 0 }));
vi.mock('./_ShoppingOpportunities', async () => {
  const { useEffect } = await import('react');
  return {
    ShoppingOpportunities: ({ brandId, hidden }: { brandId: string; hidden?: boolean }) => {
      useEffect(() => {
        shopping.mounts += 1;
      }, []);
      return hidden ? null : <div data-testid="shopping-opportunities">{brandId}</div>;
    },
  };
});
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// New content is NewContentDialog.test.tsx's; here, what the Plan opens it on.
const dialog = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('@/components/content/NewContentDialog', () => ({
  NewContentDialog: (props: Record<string, unknown>) => {
    dialog.props = props;
    return null;
  },
}));
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push }),
}));
const brandState = vi.hoisted(() => ({
  activeBrandId: 'brand-1' as string | null,
  brands: [
    { id: 'brand-1', siteType: 'b2b' },
    { id: 'shop-1', siteType: 'ecommerce' },
  ],
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: typeof brandState) => unknown) => selector(brandState),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const page = (path: string, over: Partial<PlanPage> = {}): PlanPage => ({
  page: `https://acme.example${path}`,
  title: null,
  citations: { cur: 2, prev: 2 },
  platformsDown: [],
  aiVisits: 0,
  conversions: null,
  ...over,
});
const opportunity: PlanOpportunity = {
  id: 'o1',
  title: 'Create an office coffee page',
  pageTitle: 'Office coffee subscriptions',
  decision: 'create',
  score: 74,
  targetPage: null,
  targetTitle: null,
  competitorsCited: ['Daily Grind Co.', 'Origin Box'],
  visibility: 6,
  prompts: 2,
  assetType: null,
};
const PLAN = {
  pages: [
    page('/guides/coffee-subscriptions', {
      title: 'Coffee subscriptions',
      citations: { cur: 3, prev: 10 },
      platformsDown: ['chatgpt-web', 'perplexity-web'],
    }),
    page('/guides/espresso', {
      title: 'Espresso guide',
      citations: { cur: 12, prev: 10 },
      aiVisits: 42,
    }),
  ],
  answers: { cur: 100, prev: 100 },
  tracking: { prevFrom: '2026-08-23', trackedSince: '2026-06-01' },
  opportunities: [opportunity],
  drafts: [],
};

const INSIGHTS = {
  // The listed addresses hold 80; the tail beyond them 40 more.
  totalCitations: 120,
  citations: [
    {
      url: 'https://rival.example/guides/espresso-machines',
      title: null,
      own: false,
      citations: 30,
    },
    { url: 'https://acme.example/guides/espresso', title: null, own: true, citations: 10 },
    { url: 'https://acme.example/blog/latte-art', title: null, own: true, citations: 20 },
    { url: 'https://www.reddit.com/r/espresso/x', title: null, own: false, citations: 20 },
  ],
  results: {
    visits: 1240,
    keyEvents: 48,
    transactions: 12,
    revenue: 3210.4,
    analytics: true,
    purchases: true,
  },
};

let container: HTMLDivElement;
let root: Root;

async function renderPage() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ContentPlanPage />
      </NextIntlClientProvider>,
    );
  });
}

const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.startsWith(name),
  )!;
/** A row's Start button: past the Priority Score, which is a button too. */
const START = 'td:nth-child(n+3) button';
// The page, the action and why: after the rank and the Priority Score.
const rowTexts = () =>
  [...container.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].slice(2, 5).map((td) => td.textContent),
  );

beforeEach(() => {
  brandState.activeBrandId = 'brand-1';
  window.history.replaceState(null, '', '/dashboard/content/plan');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getContentPlan.mockReset().mockResolvedValue(PLAN);
  getContentPlanInsights.mockReset().mockResolvedValue(INSIGHTS);
  setPlanRowPriority.mockReset().mockResolvedValue(undefined);
  hidePlanRow.mockReset().mockResolvedValue(undefined);
  showPlanRow.mockReset().mockResolvedValue(undefined);
  listBrandMembers.mockReset().mockResolvedValue([]);
  toast.mockReset();
  toast.error.mockReset();
  role.canManage = true;
  push.mockReset();
  dialog.props = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Content plan', () => {
  it('counts the work and ranks it, with why for the period', async () => {
    await renderPage();
    expect(getContentPlan).toHaveBeenCalledWith('brand-1', 30);
    expect(button('Create').textContent).toBe('Create1New pages AI needs');
    expect(button('Optimize').textContent).toBe('Optimize1Pages losing ground');
    expect(button('Protect').textContent).toBe('Protect1Top pages · edit with care');
    expect(button('Priority').textContent).toBe('Priority0Marked by your team');
    // Pages cited for the same prompts are no warning: no Overlaps card.
    expect(button('Overlaps')).toBeUndefined();

    expect(rowTexts()).toEqual([
      [
        'Office coffee subscriptionsNew page',
        'Create',
        'Daily Grind Co. and Origin Box cited · you 6%Opportunity',
      ],
      [
        'Coffee subscriptionsHow-to guide/guides/coffee-subscriptions',
        'Optimize',
        'Citation rate −70% on ChatGPT and PerplexityCitations',
      ],
      [
        'Espresso guideHow-to guide/guides/espresso',
        'Protect',
        'Top page · 12 citations · 42 AI visitsProtect',
      ],
    ]);
    expect(container.querySelector('thead')!.textContent).toContain('Why · last 30 days');
  });

  it("shows each row's Priority Score, and on focus how it is worked out", async () => {
    await renderPage();
    const scores = [...container.querySelectorAll('tbody tr')].map((tr) => tr.children[1]);
    // 40 severity, 30 opportunity, 20 page value, 10 citations: the new page
    // (74) 52.2; the page losing ground, with no AI visits, 48.2; the top page 34.9.
    // The Plan's own levels: Medium from 40, High from 60.
    expect(scores.map((td) => td.textContent)).toEqual(['52Medium', '48Medium', '35Low']);
    expect(container.querySelector('thead')!.textContent).toContain('Priority Score');

    const trigger = scores[1].querySelector('button')!;
    expect(trigger.getAttribute('aria-label')).toBe('Priority Score 48: how it is worked out');
    act(() => trigger.focus());
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(
      'How this score is worked out' +
        'Losing citations: 70% fewer, 7 citations lost: 35.2 of 40' +
        'No content opportunity behind it (neutral): 12 of 30' +
        '0 AI visits this period: 0 of 20' +
        '3 citations this period: 1 of 10' +
        'Together: 48 of 100' +
        'This score ranks the Plan. The Action Center scores its tasks on its own.',
    );
  });

  it('says the conversions a page took part in, with conversions on (00291)', async () => {
    getContentPlan.mockResolvedValue({
      ...PLAN,
      pages: PLAN.pages.map((p) => ({ ...p, conversions: p.aiVisits ? 3 : 0 })),
    });
    await renderPage();
    const scores = [...container.querySelectorAll('tbody tr')].map((tr) => tr.children[1]);
    // The top page, with its 42 AI visits: the third row.
    act(() => scores[2].querySelector('button')!.focus());
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain(
      '42 AI visits and 3 conversions this period',
    );
  });

  it('filters the list by a card, and clears it on a second click', async () => {
    await renderPage();
    await act(async () => button('Protect').click());
    expect(button('Protect').getAttribute('aria-pressed')).toBe('true');
    expect(rowTexts().map((r) => r[1])).toEqual(['Protect']);
    expect(container.textContent).toContain('Filtered · click it again to clear');

    await act(async () => button('Protect').click());
    expect(rowTexts()).toHaveLength(3);
  });

  it('reads the other periods, a quarter too, and keeps the period in the URL', async () => {
    await renderPage();
    await act(async () => button('Last 7 days').click());
    expect(getContentPlan).toHaveBeenLastCalledWith('brand-1', 7);
    expect(window.location.search).toBe('?days=7');
    expect(container.querySelector('thead')!.textContent).toContain('Why · last 7 days');

    await act(async () => button('Last 90 days').click());
    expect(getContentPlan).toHaveBeenLastCalledWith('brand-1', 90);
    expect(getContentPlanInsights).toHaveBeenLastCalledWith('brand-1', 90);
    expect(window.location.search).toBe('?days=90');
    expect(container.textContent).toContain('From AI visits · 90 full days to yesterday (UTC):');
  });

  it('opens on the period in the URL, read once', async () => {
    window.history.replaceState(null, '', '/dashboard/content/plan?days=7');
    await renderPage();
    expect(getContentPlan.mock.calls).toEqual([['brand-1', 7]]);
  });

  it('starts an opportunity for an existing page on that page', async () => {
    getContentPlan.mockResolvedValue({
      ...PLAN,
      pages: [],
      opportunities: [
        {
          ...opportunity,
          decision: 'optimize',
          targetPage: 'https://acme.example/pricing',
          targetTitle: 'Pricing',
        },
      ],
    });
    await renderPage();
    await act(async () => container.querySelector<HTMLButtonElement>(`tbody tr ${START}`)!.click());
    expect(dialog.props).toMatchObject({
      preset: {
        kind: 'opportunity',
        id: 'o1',
        page: { url: 'https://acme.example/pricing', title: 'Pricing' },
      },
    });
  });

  it('starts a row in New content, or opens the draft already being written', async () => {
    getContentPlan.mockResolvedValue({
      ...PLAN,
      drafts: [
        {
          id: 'd1',
          author: 'agent',
          isMine: false,
          method: 'optimize',
          opportunityId: null,
          sourceUrl: 'https://acme.example/guides/espresso',
        },
      ],
    });
    await renderPage();
    const rows = container.querySelectorAll('tbody tr');

    await act(async () => rows[1].querySelector<HTMLButtonElement>(START)!.click());
    expect(dialog.props).toMatchObject({
      open: true,
      preset: { kind: 'page', url: 'https://acme.example/guides/coffee-subscriptions' },
    });
    await act(async () => (dialog.props!.onOpenChange as (open: boolean) => void)(false));
    expect(dialog.props).toMatchObject({ open: false, preset: null });

    await act(async () => rows[0].querySelector<HTMLButtonElement>(START)!.click());
    expect(dialog.props).toMatchObject({ preset: { kind: 'opportunity', id: 'o1', page: null } });

    expect(rows[2].textContent).toContain('Agent');
    expect(rows[2].querySelector('a')!.getAttribute('href')).toBe('/dashboard/content/editor/d1');
  });

  it('shows what AI visits brought in, and what AI cites by page type', async () => {
    await renderPage();
    expect(getContentPlanInsights).toHaveBeenCalledWith('brand-1', 30);
    expect(container.textContent).toContain(
      'From AI visits · 30 full days to yesterday (UTC):1,240 visits · 48 key events · 12 orders · 3,210 revenue',
    );
    const mix = container.querySelector('section[aria-labelledby="plan-mix-title"]')!;
    // AI's mix (guides 40 of 60 typed) against the brand's own pages' (guides 10 of 30).
    // The gap shows twice: under the shares on a phone, in its column on wider screens.
    expect([...mix.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'How-to guide67% · 33%Gap · 1 pageGap · 1 page',
      'Blog post33% · 67%1 page',
    ]);
    expect(mix.querySelector('p')!.textContent).toBe(
      "The shares cover 50% of the period's AI citations: the most cited addresses whose type shows. Forums, encyclopedias, news and the long tail of less cited pages aren't in them.",
    );
  });

  it('opens the mix closed, with its count, and opens it on a click', async () => {
    await renderPage();
    const mix = container.querySelector('section[aria-labelledby="plan-mix-title"]')!;
    const toggle = mix.querySelector<HTMLButtonElement>('h2 button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The whole bar is the button, and says it opens.
    expect(toggle.textContent).toBe('What AI cites in your topics2 page types · 1 gapShow');
    expect(mix.textContent).toContain('2 page types · 1 gap');
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(body.className).toContain('hidden');

    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('What AI cites in your topicsHide');
    expect(body.className).not.toContain('hidden');
    expect(mix.textContent).not.toContain('2 page types · 1 gap');
  });

  it('draws both shares to the larger one’s scale, never past the track', async () => {
    await renderPage();
    const widths = (bar: 'ai' | 'yours') =>
      [
        ...container.querySelectorAll<HTMLElement>(
          `section[aria-labelledby="plan-mix-title"] [data-bar="${bar}"]`,
        ),
      ].map((el) => Math.round(parseFloat(el.style.width)));
    // Guides 67% · 33%, blog posts 33% · 67%: the brand's 67% fills the track as AI's does.
    expect(widths('ai')).toEqual([100, 49]);
    expect(widths('yours')).toEqual([49, 100]);
  });

  it('opens in its final layout: one spinner until the list and the sections are both in', async () => {
    let insightsIn: (value: typeof INSIGHTS) => void = () => {};
    getContentPlanInsights.mockReturnValue(
      new Promise<typeof INSIGHTS>((resolve) => (insightsIn = resolve)),
    );
    await renderPage();
    // The list is read, but it waits for the sections above it.
    expect(rowTexts()).toEqual([]);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('section[aria-labelledby="plan-mix-title"]')).toBeNull();

    await act(async () => insightsIn(INSIGHTS));
    expect(rowTexts()).toHaveLength(3);
    expect(container.querySelector('section[aria-labelledby="plan-mix-title"]')).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('filters the list by a page type, and clears it on a second click', async () => {
    await renderPage();
    const guide = () =>
      container.querySelector<HTMLButtonElement>(
        'section[aria-labelledby="plan-mix-title"] li button',
      )!;
    await act(async () => guide().click());
    expect(guide().getAttribute('aria-pressed')).toBe('true');
    expect(rowTexts().map((r) => r[0])).toEqual([
      'Coffee subscriptionsHow-to guide/guides/coffee-subscriptions',
      'Espresso guideHow-to guide/guides/espresso',
    ]);
    await act(async () => guide().click());
    expect(rowTexts()).toHaveLength(3);
  });

  it('names the type filtering the list while the section is closed, and clears it', async () => {
    await renderPage();
    const section = () =>
      container.querySelector<HTMLElement>('section[aria-labelledby="plan-mix-title"]')!;
    const bar = () => section().querySelector<HTMLButtonElement>('h2 button')!;
    await act(async () => bar().click());
    await act(async () => section().querySelector<HTMLButtonElement>('li button')!.click());
    // Open, the pressed row says it; no line under the bar.
    expect(section().textContent).not.toContain('Priority list filtered to');
    await act(async () => bar().click());
    expect(bar().getAttribute('aria-expanded')).toBe('false');
    expect(section().textContent).toContain('Priority list filtered to How-to guide');
    expect(rowTexts()).toHaveLength(2);
    const clear = [...section().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Clear',
    )!;
    await act(async () => clear.click());
    expect(rowTexts()).toHaveLength(3);
    expect(section().textContent).not.toContain('Priority list filtered to');
  });

  it('adds the four goals the snippet followed AI visitors to most, and the top journey (CE-017)', async () => {
    getContentPlanInsights.mockResolvedValue({
      ...INSIGHTS,
      conversions: {
        enabled: true,
        goals: [
          { goal: 'signup', count: 48 },
          { goal: 'demo', count: 20 },
          { goal: 'order', count: 10 },
          { goal: 'newsletter', count: 3 },
          { goal: 'custom', count: 1 },
        ],
        // A long journey: the first page, a gap and the last three.
        journey: {
          source: 'chatgpt.com',
          pages: ['/blog/crm-data-hygiene', '/a', '/b', '/c', '/d', '/pricing'],
          goal: 'demo',
          count: 4,
        },
      },
    });
    await renderPage();
    expect(container.textContent).toContain(
      '1,240 visits · 48 key events · 12 orders · 3,210 revenue · 48 signups · 20 demo forms · 10 orders from journeys · 3 newsletter signups',
    );
    expect(container.textContent).not.toContain('other conversion');
    expect(container.textContent).toContain(
      'Top journey:ChatGPT/blog/crm-data-hygiene…/c/d/pricingDemo form· 4 conversions',
    );
  });

  it('asks for Google Analytics beside the goals, without a journey line when there’s none', async () => {
    getContentPlanInsights.mockResolvedValue({
      ...INSIGHTS,
      results: { ...INSIGHTS.results, analytics: false, purchases: false },
      conversions: { enabled: true, goals: [{ goal: 'signup', count: 1 }], journey: null },
    });
    await renderPage();
    expect(container.textContent).toContain(
      '1,240 visits · 1 signupConnect Google Analytics for key events and revenue.',
    );
    expect(container.textContent).not.toContain('Top journey');
  });

  it('asks for Google Analytics to show what AI visitors did', async () => {
    getContentPlanInsights.mockResolvedValue({
      ...INSIGHTS,
      results: { ...INSIGHTS.results, analytics: false, purchases: false },
    });
    await renderPage();
    expect(container.textContent).toContain(
      'From AI visits · 30 full days to yesterday (UTC):1,240 visitsConnect Google Analytics to see what they did next.',
    );
    expect(
      [...container.querySelectorAll('a')]
        .find((a) => a.textContent === 'Connect Google Analytics')!
        .getAttribute('href'),
    ).toBe('/dashboard/traffic');
  });

  it('drops a page-type filter the period’s mix no longer lists, and a brand’s filters on switching', async () => {
    await renderPage();
    const guide = () =>
      container.querySelector<HTMLButtonElement>(
        'section[aria-labelledby="plan-mix-title"] li button',
      )!;
    await act(async () => guide().click());
    await act(async () => button('Protect').click());
    expect(rowTexts()).toHaveLength(1);

    // The 7 days' mix has no guide: the list isn't filtered by it.
    getContentPlanInsights.mockResolvedValue({
      ...INSIGHTS,
      citations: [
        { url: 'https://acme.example/blog/latte-art', title: null, own: true, citations: 5 },
      ],
    });
    await act(async () => button('Last 7 days').click());
    await act(async () => button('Protect').click());
    expect(container.textContent).not.toContain('Filtered');
    expect(rowTexts()).toHaveLength(3);

    await act(async () => button('Protect').click());
    brandState.activeBrandId = 'brand-2';
    brandState.brands.push({ id: 'brand-2', siteType: 'b2b' });
    await renderPage();
    expect(button('Protect').getAttribute('aria-pressed')).toBe('false');
    brandState.brands.pop();
  });

  it('says when the earlier period is tracked only in part, or not at all', async () => {
    getContentPlan.mockResolvedValue({
      ...PLAN,
      tracking: { prevFrom: '2026-08-23', trackedSince: '2026-09-09' },
    });
    await renderPage();
    expect(container.textContent).toContain(
      'The 30 days before are tracked only since Sep 9: pages are compared per tracked answer.',
    );

    getContentPlan.mockResolvedValue({
      ...PLAN,
      answers: { cur: 100, prev: 0 },
      tracking: { prevFrom: '2026-04-24', trackedSince: '2026-09-09' },
    });
    await act(async () => button('Last 90 days').click());
    expect(container.textContent).toContain(
      "No page reads as losing ground yet: tracking began Sep 9, so the 90 days before aren't tracked to compare with.",
    );
  });

  it('reads the mix again with the period, not after a draft is sent', async () => {
    await renderPage();
    expect(getContentPlanInsights).toHaveBeenCalledTimes(1);
    await act(async () => (dialog.props!.onSent as () => void)());
    expect(getContentPlan).toHaveBeenCalledTimes(2);
    expect(getContentPlanInsights).toHaveBeenCalledTimes(1);
  });

  it('shows a shop its Shopping opportunities above the list, and no other brand (shopping path, part 7)', async () => {
    await renderPage();
    expect(container.querySelector('[data-testid="shopping-opportunities"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    brandState.activeBrandId = 'shop-1';
    await renderPage();
    const section = container.querySelector('[data-testid="shopping-opportunities"]');
    expect(section?.textContent).toBe('shop-1');
    // Above the ranked list.
    const list = [...container.querySelectorAll('h2')].find(
      (h) => h.textContent === 'Priority list',
    );
    expect(section!.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the Shopping opportunities through another period’s read, hidden while it loads', async () => {
    brandState.activeBrandId = 'shop-1';
    await renderPage();
    const section = () => container.querySelector('[data-testid="shopping-opportunities"]');
    expect(section()).not.toBeNull();
    const mounts = shopping.mounts;
    let resolve: (plan: typeof PLAN) => void = () => {};
    getContentPlan.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await act(async () => button('Last 7 days').click());
    // The list loads: one spinner, the section kept but not shown.
    expect(section()).toBeNull();
    await act(async () => resolve(PLAN));
    expect(section()?.textContent).toBe('shop-1');
    // Not read again: the same section, never mounted anew.
    expect(shopping.mounts).toBe(mounts);
  });

  it('says so when the plan can’t be read, and tries again', async () => {
    getContentPlan.mockRejectedValueOnce(new Error('boom'));
    await renderPage();
    expect(container.textContent).toContain("Couldn't load the content plan.");
    await act(async () => button('Try again').click());
    expect(getContentPlan).toHaveBeenCalledTimes(2);
    expect(rowTexts()).toHaveLength(3);
  });
});

describe('a Plan row’s menu', () => {
  const ESPRESSO = 'page:acme.example/guides/espresso';
  const menuItems = async (title: string) => {
    const trigger = container.querySelector<HTMLElement>(`[aria-label="Actions for ${title}"]`)!;
    await act(async () => trigger.click());
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };
  const hiddenList = (toggle: string) => button(toggle).parentElement!.querySelector('ul')!;
  const clickItem = async (title: string, item: string) => {
    const found = (await menuItems(title)).find((el) => el.textContent === item)!;
    await act(async () => found.click());
  };

  it('puts the rows marked as a priority on top, tagged, with a card to filter them', async () => {
    getContentPlan.mockResolvedValue({
      ...PLAN,
      marks: [{ rowKey: ESPRESSO, priority: true, hidden: false }],
    });
    await renderPage();
    expect(rowTexts().map((r) => r[0])).toEqual([
      'Espresso guidePriorityHow-to guide/guides/espresso',
      'Office coffee subscriptionsNew page',
      'Coffee subscriptionsHow-to guide/guides/coffee-subscriptions',
    ]);
    expect(button('Priority').textContent).toBe('Priority1Marked by your team');

    await act(async () => button('Priority').click());
    expect(rowTexts().map((r) => r[1])).toEqual(['Protect']);

    await clickItem('Espresso guide', 'Remove priority');
    expect(setPlanRowPriority).toHaveBeenCalledWith('brand-1', ESPRESSO, false);
  });

  it('marks a row as a priority, and reads the plan again', async () => {
    await renderPage();
    const items = await menuItems('Espresso guide');
    expect(items.map((el) => el.textContent)).toEqual([
      'Assign to…',
      'Mark as priority',
      'Hide from the plan',
    ]);
    await act(async () => items[1].click());
    expect(setPlanRowPriority).toHaveBeenCalledWith('brand-1', ESPRESSO, true);
    expect(getContentPlan).toHaveBeenCalledTimes(2);
  });

  it('hides a row, with an undo, and lists the hidden rows to show again', async () => {
    await renderPage();
    await clickItem('Office coffee subscriptions', 'Hide from the plan');
    expect(hidePlanRow).toHaveBeenCalledWith('brand-1', 'opportunity:o1');
    expect(getContentPlan).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith('Hidden: Office coffee subscriptions', {
      action: { label: 'Undo', onClick: expect.any(Function) },
    });
    await act(async () => toast.mock.calls[0][1].action.onClick());
    expect(showPlanRow).toHaveBeenCalledWith('brand-1', 'opportunity:o1');

    getContentPlan.mockResolvedValue({
      ...PLAN,
      marks: [{ rowKey: 'opportunity:o1', priority: false, hidden: true }],
    });
    await act(async () => button('Last 7 days').click());
    expect(rowTexts()).toHaveLength(2);
    expect(button('Create').textContent).toBe('Create0New pages AI needs');
    expect(container.textContent).not.toContain('Show again');

    await act(async () => button('1 hidden row · Show').click());
    const hidden = hiddenList('1 hidden row · Hide');
    expect(hidden.textContent).toBe('Office coffee subscriptionsShow again');
    showPlanRow.mockClear();
    await act(async () => hidden.querySelector('button')!.click());
    expect(showPlanRow).toHaveBeenCalledWith('brand-1', 'opportunity:o1');
    expect(button('1 hidden row · Hide').getAttribute('aria-expanded')).toBe('true');
  });

  it('says so when a mark can’t be saved', async () => {
    hidePlanRow.mockRejectedValue(new Error('denied'));
    await renderPage();
    await clickItem('Espresso guide', 'Hide from the plan');
    expect(toast.error).toHaveBeenCalledWith("Couldn't save that. Try again.");
    expect(getContentPlan).toHaveBeenCalledTimes(1);
  });

  it('lets members assign a row, but not mark, hide or show one', async () => {
    role.canManage = false;
    getContentPlan.mockResolvedValue({
      ...PLAN,
      marks: [{ rowKey: 'opportunity:o1', priority: false, hidden: true }],
    });
    await renderPage();
    expect((await menuItems('Espresso guide')).map((el) => el.textContent)).toEqual(['Assign to…']);
    await act(async () => button('1 hidden row · Show').click());
    expect(hiddenList('1 hidden row · Hide').textContent).toBe('Office coffee subscriptions');
  });

  it('assigns a row without a draft in Start, on Team; one with a draft, its task', async () => {
    getContentPlan.mockResolvedValue({
      ...PLAN,
      drafts: [
        {
          id: 'd1',
          author: 'user',
          isMine: false,
          method: 'optimize',
          opportunityId: null,
          sourceUrl: 'https://acme.example/guides/espresso',
          actionId: 'a1',
          assignee: { id: 'u2', name: 'Ada Lovelace' },
        },
      ],
    });
    await renderPage();
    // Who does it: the teammate the task is assigned to.
    expect(container.querySelectorAll('tbody tr')[2].textContent).toContain('Ada Lovelace');

    await clickItem('Coffee subscriptions', 'Assign to…');
    // The people who can see this brand (BRAND-ACCESS).
    expect(listBrandMembers).toHaveBeenCalledTimes(1);
    expect(listBrandMembers).toHaveBeenCalledWith('brand-1');
    expect(dialog.props).toMatchObject({
      open: true,
      preset: {
        kind: 'page',
        url: 'https://acme.example/guides/coffee-subscriptions',
        who: 'team',
      },
    });
    expect(container.querySelector('[data-testid="assign-dialog"]')).toBeNull();

    await clickItem('Espresso guide', 'Assign to…');
    expect(container.querySelector('[data-testid="assign-dialog"]')!.textContent).toBe(
      'Espresso guide',
    );
  });
});

describe('Getting started’s content steps (00234)', () => {
  it('opens Start on the top Create row, on the Create card, once', async () => {
    window.history.replaceState(null, '', '/dashboard/content/plan?start=create');
    await renderPage();
    expect(dialog.props).toMatchObject({
      open: true,
      preset: { kind: 'opportunity', id: 'o1', page: null },
    });
    expect(button('Create').getAttribute('aria-pressed')).toBe('true');
    // A reload opens the plan as it is.
    expect(window.location.search).toBe('');
  });

  it('opens the draft already written for the top Optimize row', async () => {
    window.history.replaceState(null, '', '/dashboard/content/plan?start=optimize');
    getContentPlan.mockResolvedValue({
      ...PLAN,
      drafts: [
        {
          id: 'd1',
          author: 'user',
          isMine: true,
          method: 'optimize',
          opportunityId: null,
          sourceUrl: 'https://acme.example/guides/coffee-subscriptions',
          actionId: null,
          assignee: null,
        },
      ],
    });
    await renderPage();
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d1');
    expect(dialog.props).toMatchObject({ open: false });
  });

  it('shows the empty card when the plan has no row of that action', async () => {
    window.history.replaceState(null, '', '/dashboard/content/plan?start=optimize');
    getContentPlan.mockResolvedValue({ ...PLAN, pages: [] });
    await renderPage();
    expect(button('Optimize').getAttribute('aria-pressed')).toBe('true');
    expect(dialog.props).toMatchObject({ open: false });
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the Content plan on a read-only workspace (plan not active)', () => {
  const openUpgrade = vi.fn();
  const render = async (isLocked: boolean) => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <ContentPlanPage />
          </UpgradeDialogContext.Provider>
        </NextIntlClientProvider>,
      );
    });
  };
  const clickItem = async (title: string, item: string) => {
    const trigger = container.querySelector<HTMLElement>(`[aria-label="Actions for ${title}"]`)!;
    await act(async () => trigger.click());
    const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === item,
    )!;
    await act(async () => found.click());
  };

  beforeEach(() => openUpgrade.mockReset());

  it('opens the upgrade dialog from New content, Start and the row menu, and runs nothing', async () => {
    await render(true);
    await act(async () => button('New content').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Creating content needs a plan');
    const rows = container.querySelectorAll('tbody tr');
    await act(async () => rows[1].querySelector<HTMLButtonElement>(START)!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Optimizing content needs a plan');
    expect(dialog.props).toMatchObject({ open: false, preset: null });

    await clickItem('Espresso guide', 'Mark as priority');
    expect(openUpgrade).toHaveBeenLastCalledWith('Marking priorities needs a plan');
    await clickItem('Espresso guide', 'Hide from the plan');
    expect(openUpgrade).toHaveBeenLastCalledWith('Hiding rows needs a plan');
    await clickItem('Espresso guide', 'Assign to…');
    expect(openUpgrade).toHaveBeenLastCalledWith('Assigning content needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(5);
    expect(setPlanRowPriority).not.toHaveBeenCalled();
    expect(hidePlanRow).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="assign-dialog"]')).toBeNull();
    // Browsing stays open: a card still filters the list.
    await act(async () => button('Protect').click());
    expect(rowTexts().map((r) => r[1])).toEqual(['Protect']);
  });

  it('opens on Getting started’s card and starts nothing by itself', async () => {
    window.history.replaceState(null, '', '/dashboard/content/plan?start=create');
    await render(true);
    expect(button('Create').getAttribute('aria-pressed')).toBe('true');
    expect(dialog.props).toMatchObject({ open: false });
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('starts a row on an active plan', async () => {
    await render(false);
    const rows = container.querySelectorAll('tbody tr');
    await act(async () => rows[0].querySelector<HTMLButtonElement>(START)!.click());
    expect(dialog.props).toMatchObject({ open: true, preset: { kind: 'opportunity', id: 'o1' } });
    await clickItem('Espresso guide', 'Mark as priority');
    expect(setPlanRowPriority).toHaveBeenCalledWith(
      'brand-1',
      'page:acme.example/guides/espresso',
      true,
    );
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
