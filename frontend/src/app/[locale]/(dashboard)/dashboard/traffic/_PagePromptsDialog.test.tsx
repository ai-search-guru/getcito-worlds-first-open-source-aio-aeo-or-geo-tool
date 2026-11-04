import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PagePromptSuggestion, TrafficDateWindow } from '@/lib/actions/traffic';

/**
 * "Add prompts" for one page (AT-006 part B2): the page's suggested prompts,
 * as many ticked as the plan's prompt slots allow (PROMPT-012), tracked so
 * they point at the page; never more than the slots left.
 */

const suggestPagePrompts = vi.fn();
const getLocationQuota = vi.fn();
const trackPagePrompts = vi.fn();
const push = vi.fn();
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/actions/traffic', () => ({
  suggestPagePrompts: (...args: unknown[]) => suggestPagePrompts(...args),
}));
vi.mock('@/lib/actions/prompt', () => ({
  getLocationQuota: (...args: unknown[]) => getLocationQuota(...args),
}));
vi.mock('@/lib/actions/promptSuggestions', () => ({
  trackPagePrompts: (...args: unknown[]) => trackPagePrompts(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
  useRouter: () => ({ push }),
}));
vi.mock('sonner', () => ({ toast }));
// Adding a topic is for admins and managers.
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canManage: true }) }));

const { PagePromptsDialog } = await import('./_PagePromptsDialog');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '33333333-3333-3333-3333-333333333333';
const WEEK: TrafficDateWindow = { dateFrom: '2026-10-11T09:00:00.000Z' };

const suggestion = (text: string, over: Partial<PagePromptSuggestion> = {}) => ({
  text,
  topic: 'Gift Ideas',
  reason: 'The gifts page lists coffee gift boxes by budget.',
  sourceQuery: null,
  impressions: null,
  ...over,
});

const SUGGESTIONS = [
  suggestion('What coffee gift box should I buy for a coffee lover?', {
    sourceQuery: 'coffee gift box ideas',
    impressions: 1400,
  }),
  suggestion('Good coffee gifts under 50 dollars?'),
  suggestion('Which coffee gift set suits a beginner?'),
];

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onTracked = vi.fn();

beforeEach(() => {
  suggestPagePrompts.mockReset().mockResolvedValue({
    page: { path: '/gifts', title: 'Coffee gifts' },
    queries: 1,
    suggestions: SUGGESTIONS,
  });
  getLocationQuota.mockReset().mockResolvedValue({ maxPrompts: 50, used: 48 });
  trackPagePrompts.mockReset();
  for (const fn of [push, onClose, onTracked, ...Object.values(toast)]) fn.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render({
  domain = 'acme-coffee.example.com',
  page = '/gifts',
}: { domain?: string; page?: string | null } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PagePromptsDialog
          brandId={BRAND}
          dateWindow={WEEK}
          domain={domain}
          page={page}
          onClose={onClose}
          onTracked={onTracked}
        />
      </NextIntlClientProvider>,
    );
  });
}

const text = () => document.body.textContent ?? '';
const boxes = () => [...document.body.querySelectorAll<HTMLElement>('[role="checkbox"]')];
const ticked = () => boxes().map((b) => b.getAttribute('aria-checked') === 'true');
const trackButton = () =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.startsWith('Track'),
  )!;

describe('PagePromptsDialog', () => {
  it("shows the page's suggestions, ticking as many as the plan has slots for", async () => {
    await render();
    expect(suggestPagePrompts).toHaveBeenCalledWith(BRAND, WEEK, '/gifts');
    expect(text()).toContain('The page: Coffee gifts');
    expect(text()).toContain('What coffee gift box should I buy for a coffee lover?');
    expect(text()).toContain('From Search Console: “coffee gift box ideas” · 1,400 impressions');
    expect(ticked()).toEqual([true, true, false]);
    expect(text()).toContain('2 prompts left to add on your plan');
    expect(trackButton().textContent).toBe('Track 2 prompts');
  });

  it('never tracks more than the slots left', async () => {
    await render();
    await act(async () => boxes()[2].click());
    expect(ticked()).toEqual([true, true, true]);
    expect(text()).toContain("Select up to 2 prompts: that's what your plan has left");
    expect(trackButton().disabled).toBe(true);
  });

  it('ticks every suggestion on a plan without a prompt limit', async () => {
    getLocationQuota.mockResolvedValue({ maxPrompts: -1, used: 900 });
    await render();
    expect(ticked()).toEqual([true, true, true]);
    expect(text()).toContain('No prompt limit on your plan');
  });

  it('tracks the ticked prompts pointing at the page, then refreshes the list', async () => {
    trackPagePrompts.mockResolvedValue({ promptIds: ['p1', 'p2'] });
    await render({ domain: 'https://acme-coffee.example.com/' });
    await act(async () => trackButton().click());

    expect(trackPagePrompts).toHaveBeenCalledWith(BRAND, 'https://acme-coffee.example.com/gifts', [
      { text: SUGGESTIONS[0].text, topic: 'Gift Ideas' },
      { text: SUGGESTIONS[1].text, topic: 'Gift Ideas' },
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      'Now tracking 2 prompts',
      expect.objectContaining({
        description: 'They point to /gifts; their first answers come with the next tracking run.',
      }),
    );
    expect(onTracked).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('says how far it got when the plan ran out, and when nothing could be added', async () => {
    trackPagePrompts.mockResolvedValue({
      promptIds: ['p1'],
      error: 'full',
      code: 'plan_limit',
    });
    await render();
    await act(async () => trackButton().click());
    expect(toast.warning).toHaveBeenCalledWith(
      "Tracked 1 of 2: your plan's prompt locations are full.",
      expect.anything(),
    );
    expect(onTracked).toHaveBeenCalled();

    trackPagePrompts.mockResolvedValue({ promptIds: [], error: 'full', code: 'plan_limit' });
    await act(async () => trackButton().click());
    expect(toast.error).toHaveBeenCalledWith("Your plan's prompt locations are full");
  });

  it("says when the page's prompts couldn't be written", async () => {
    suggestPagePrompts.mockResolvedValue({
      error: "Couldn't write suggestions for this page. Try again.",
    });
    await render();
    expect(text()).toContain("Couldn't suggest prompts for this page.");
    expect(text()).toContain('Try again.');
    expect(trackButton().disabled).toBe(true);
  });

  it('asks for a topic first on a brand without one, before any prompt is suggested', async () => {
    suggestPagePrompts.mockResolvedValue({
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    await render();
    expect(text()).toContain('Add a topic first');
    expect(text()).not.toContain("Couldn't suggest prompts for this page.");
    const link = [...document.body.querySelectorAll('a')].find(
      (a) => a.textContent === 'Add a topic',
    );
    expect(link?.getAttribute('href')).toBe('/dashboard/prompts/topics?new=1');
    expect(trackButton()).toBeUndefined();
  });

  it('asks for a topic first when Track finds the brand has none left', async () => {
    trackPagePrompts.mockResolvedValue({
      promptIds: [],
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    await render();
    await act(async () => trackButton().click());
    expect(text()).toContain('Add a topic first');
    expect(toast.error).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks again on the next open: a topic may have been added since', async () => {
    trackPagePrompts.mockResolvedValue({
      promptIds: [],
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    await render();
    await act(async () => trackButton().click());
    expect(text()).toContain('Add a topic first');

    await render({ page: null });
    await render();
    expect(text()).not.toContain('Add a topic first');
    expect(trackButton().textContent).toBe('Track 2 prompts');
  });

  it('says when every prompt the page answers is tracked already', async () => {
    suggestPagePrompts.mockResolvedValue({
      page: { path: '/gifts', title: null },
      queries: 0,
      suggestions: [],
    });
    await render();
    expect(text()).toContain('No new prompts to suggest for this page');
  });
});
