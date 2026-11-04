import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { PromptDemand } from '@/lib/promptDemand';
import type { GoogleSourceStatus } from '@/lib/trafficSources';

/**
 * The prompt's Demand card (PROMPT-014, mockup screen 2): four measured
 * signals with their sources and dates, a clear state for each one that
 * isn't there, the level (never an Estimate), and People Also Ask
 * questions tracked in one click.
 */

const hook = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('@/hooks/useIntegrationConnect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect: hook.connect }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));
const trackDemandQuestion = vi.fn();
vi.mock('@/lib/actions/promptDemandSignals', () => ({
  trackDemandQuestion: (...args: unknown[]) => trackDemandQuestion(...args),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// Adding a topic is for admins and managers.
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canManage: true }) }));

const { DemandLevelValue, DemandSection } = await import('./DemandCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const READ = '2026-10-27T12:00:00.000Z';

const full = (over: Partial<PromptDemand> = {}): PromptDemand => ({
  level: 'high',
  signals: 4,
  updatedAt: READ,
  keyword: 'ai search monitoring',
  locationCode: 2840,
  languageCode: 'en',
  gsc: {
    impressions: 4120,
    clicks: 96,
    queries: 7,
    top: { query: 'ai search monitoring tool', impressions: 2400, clicks: 60 },
    at: READ,
  },
  trends: {
    points: [25, 26, 30, 28, 33, 35, 41],
    trend: 'rising',
    change: 64,
    from: '2025-10-26',
    to: '2026-10-24',
    at: READ,
  },
  paa: {
    questions: [
      { question: 'How do I track my brand in ChatGPT?', url: null, domain: null },
      { question: 'What is AI search monitoring?', url: null, domain: null },
    ],
    at: READ,
  },
  youtube: {
    videos: 20,
    views: 1_800_000,
    results: 214,
    top: {
      title: 'How to track your brand in ChatGPT',
      url: 'https://www.youtube.com/watch?v=abc123',
      channel: 'Search Lab',
      views: 310_000,
      published: null,
    },
    at: READ,
  },
  pending: { trends: false, paa: false, youtube: false },
  hasVolume: true,
  hasKeyword: true,
  paidSignals: true,
  ...over,
});

const empty = (over: Partial<PromptDemand> = {}): PromptDemand =>
  full({
    level: null,
    signals: 0,
    gsc: null,
    trends: null,
    paa: null,
    youtube: null,
    ...over,
  });

let container: HTMLDivElement;
let root: Root;
const onGscConnected = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  trackDemandQuestion.mockResolvedValue({ promptIds: ['n1'] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(
  demand: PromptDemand | null,
  {
    gscStatus = 'connected',
    canManage = true,
    failed = false,
  }: { gscStatus?: GoogleSourceStatus | null; canManage?: boolean; failed?: boolean } = {},
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DemandSection
          demand={demand}
          failed={failed}
          gscStatus={gscStatus}
          brandId="b1"
          topic="Monitoring"
          canManage={canManage}
          onGscConnected={onGscConnected}
        />
      </NextIntlClientProvider>,
    );
  });
}

const text = () => (container.textContent ?? '').replace(/\s+/g, ' ');
const buttons = (label: string) =>
  [...container.querySelectorAll('button')].filter((b) => b.textContent === label);

describe('DemandSection with every signal read', () => {
  it('shows the four signals, each with its source and the day it was read', () => {
    render(full());
    const t = text();
    expect(t).toContain('Demand · is this asked for real?');
    expect(t).toContain('Read for “ai search monitoring”');
    // Search Console.
    expect(t).toContain('4,120 impressions · 96 clicks');
    expect(t).toContain('7 matching queries, e.g. “ai search monitoring tool”');
    expect(t).toContain('Measured · last 28 days');
    expect(t).toContain('Your Search Console · read Oct 27, 2026');
    // Google Trends.
    expect(t).toContain('Rising · +64% vs a year ago');
    expect(t).toContain('Google Trends via DataForSEO · read Oct 27, 2026');
    expect(container.querySelector('svg')).not.toBeNull();
    // People Also Ask.
    expect(t).toContain('How do I track my brand in ChatGPT?');
    expect(buttons('+ Track')).toHaveLength(2);
    expect(t).toContain('Google results via DataForSEO · read Oct 27, 2026');
    // YouTube.
    expect(t).toContain('1.8M views across the top 20 videos');
    expect(t).toContain('Top: “How to track your brand in ChatGPT” · 310k views');
    expect(t).toContain('YouTube lists about 214 results.');
    // The level's effect.
    expect(t).toContain(
      'Demand level High raises the Priority Score of Action Center actions about this prompt.',
    );
  });

  it("links the top video only when it's a web page", () => {
    render(full());
    expect(container.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(
      'https://www.youtube.com/watch?v=abc123',
    );
    const top = full().youtube!.top!;
    render(full({ youtube: { ...full().youtube!, top: { ...top, url: 'javascript:alert(1)' } } }));
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(text()).toContain('Top: “How to track your brand in ChatGPT” · 310k views');
  });

  it('says so when a read found nothing', () => {
    render(
      full({
        gsc: { impressions: 0, clicks: 0, queries: 0, top: null, at: READ },
        trends: { points: [0, 0], trend: null, change: null, from: null, to: null, at: READ },
        paa: { questions: [], at: READ },
        youtube: { videos: 0, views: 0, results: null, top: null, at: READ },
        level: 'low',
      }),
    );
    const t = text();
    expect(t).toContain('None of your Search Console queries in the last 28 days matches');
    expect(t).toContain('Too little search interest to draw a line.');
    expect(t).toContain('Google shows no People Also Ask questions for this keyword.');
    expect(t).toContain('YouTube shows no videos for this keyword.');
    expect(t).toContain(
      'Demand level Low leaves the Priority Score of Action Center actions about this prompt as it is.',
    );
  });

  it('says "from no search interest" only for a rising line without a change to give', () => {
    const trends = (trend: 'rising' | 'steady', change: number | null) =>
      full({ trends: { ...full().trends!, trend, change } });

    render(trends('rising', null));
    expect(text()).toContain('Rising · from no search interest a year ago');

    // Interest in between, none at either end: steady, and no percent to give.
    render(trends('steady', null));
    expect(text()).toContain('Steady');
    expect(text()).not.toContain('from no search interest');
    expect(text()).not.toContain('vs a year ago');

    render(trends('steady', 4));
    expect(text()).toContain('Steady · +4% vs a year ago');
  });
});

describe('DemandSection without a source', () => {
  it('asks to connect Search Console, and connects it in place', () => {
    render(empty(), { gscStatus: 'not_connected' });
    expect(text()).toContain('Connect Search Console to see real clicks.');
    const [connect] = buttons('Connect Search Console');
    act(() => connect.click());
    expect(hook.connect).toHaveBeenCalled();
  });

  it("tells a person who can't connect to ask an admin", () => {
    render(empty(), { gscStatus: 'not_connected', canManage: false });
    expect(buttons('Connect Search Console')).toHaveLength(0);
    expect(text()).toContain('Ask an admin or a manager to connect Search Console.');
  });

  it('says what each Search Console state needs', () => {
    render(empty(), { gscStatus: 'unmapped' });
    expect(text()).toContain("Pick this brand's Search Console property to see real clicks.");
    expect(
      container.querySelector('a[href="/dashboard/settings?tab=integrations"]'),
    ).not.toBeNull();
    render(empty(), { gscStatus: 'syncing' });
    expect(text()).toContain('Search Console is syncing.');
    render(empty(), { gscStatus: 'connected' });
    expect(text()).toContain('Not read yet. Matching queries are read every night.');
  });

  it('asks for a volume analysis first, with the way there', () => {
    render(empty({ hasVolume: false, hasKeyword: false, keyword: null }));
    expect(text()).toContain('Analyze volume first.');
    expect(container.querySelectorAll('a[href="/dashboard/prompts/insights"]')).toHaveLength(3);
    expect(text()).not.toContain('Read for');
  });

  it('says when there is no keyword with searches, when reads are off, and when one is being read', () => {
    render(empty({ hasKeyword: false }));
    expect(text()).toContain(
      "Nothing to read: Google shows no searches for this prompt's keywords.",
    );
    render(empty({ paidSignals: false }));
    expect(text()).toContain("Not read yet. Weekly reads aren't turned on yet.");
    render(empty({ pending: { trends: true, paa: false, youtube: false } }));
    expect(text()).toContain('Being read. Ready within a day.');
    expect(text()).toContain("Not read yet. It's read about once a week.");
    expect(text()).toContain('Once a signal is read, the demand level feeds');
  });

  it("says it couldn't load", () => {
    render(null, { failed: true });
    expect(text()).toContain("Couldn't load this prompt's demand.");
  });
});

describe('+ Track on a People Also Ask question', () => {
  it('tracks the question in its topic in one click', async () => {
    render(full());
    const [first] = buttons('+ Track');
    await act(async () => first.click());
    expect(trackDemandQuestion).toHaveBeenCalledWith(
      'b1',
      'How do I track my brand in ChatGPT?',
      'Monitoring',
    );
    expect(toast.success).toHaveBeenCalledWith(
      '“How do I track my brand in ChatGPT?” is now a tracked prompt.',
    );
    expect(buttons('Tracked')).toHaveLength(1);
    expect(buttons('+ Track')).toHaveLength(1);
  });

  it('names the question it tracks for a screen reader', () => {
    render(full({ paa: { ...full().paa!, questions: [full().paa!.questions[0]] } }));
    const [button] = buttons('+ Track');
    expect(button.getAttribute('aria-label')).toBe('Track “How do I track my brand in ChatGPT?”');
  });

  it('shows a question the brand already tracks as tracked when the page loads again', () => {
    const [first, second] = full().paa!.questions;
    render(full({ paa: { questions: [{ ...first, tracked: true }, second], at: READ } }));
    const [done] = buttons('Tracked');
    expect(done.disabled).toBe(true);
    expect(done.getAttribute('aria-label')).toBe(
      '“How do I track my brand in ChatGPT?” is tracked',
    );
    expect(buttons('+ Track')).toHaveLength(1);
  });

  it('adds nothing for a question tracked meanwhile, and shows it as tracked', async () => {
    trackDemandQuestion.mockResolvedValue({ promptIds: [], alreadyTracked: true });
    render(full());
    await act(async () => buttons('+ Track')[0].click());
    expect(toast.success).toHaveBeenCalledWith(
      '“How do I track my brand in ChatGPT?” is already a tracked prompt.',
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(buttons('Tracked')).toHaveLength(1);
  });

  it("says the plan's limit is reached", async () => {
    trackDemandQuestion.mockResolvedValue({ promptIds: [], error: 'limit', code: 'plan_limit' });
    render(full());
    await act(async () => buttons('+ Track')[0].click());
    expect(toast.error).toHaveBeenCalledWith(
      "Your plan's prompt limit is reached. Upgrade to track more prompts.",
    );
    expect(buttons('+ Track')).toHaveLength(2);
  });

  it('asks for a topic first on a brand without one, with a way to the Topics tab', async () => {
    trackDemandQuestion.mockResolvedValue({
      promptIds: [],
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    render(full());
    await act(async () => buttons('+ Track')[0].click());
    expect(document.body.textContent).toContain('Add a topic first');
    const link = [...document.body.querySelectorAll('a')].find(
      (a) => a.textContent === 'Add a topic',
    );
    expect(link?.getAttribute('href')).toBe('/dashboard/prompts/topics?new=1');
    expect(toast.error).not.toHaveBeenCalled();
    expect(buttons('+ Track')).toHaveLength(2);
  });

  it("is off for a person who can't add prompts", () => {
    render(full(), { canManage: false });
    expect(buttons('+ Track').every((b) => b.disabled)).toBe(true);
  });
});

describe('DemandLevelValue', () => {
  it('reads the level, measured: never an Estimate', () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <DemandLevelValue demand={full({ level: 'medium', signals: 3 })} />
        </NextIntlClientProvider>,
      );
    });
    expect(text()).toBe('MediumMeasured');
    expect(text()).not.toContain('Estimate');
  });
});
