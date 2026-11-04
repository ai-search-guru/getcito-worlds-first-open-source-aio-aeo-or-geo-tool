import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { BotConnections } from '@/lib/actions/aiBots';
import type { TrafficBots, TrafficDateWindow } from '@/lib/actions/traffic';
import { PlanProvider } from '@/components/context/PlanProvider';
import type { PlanId } from '@/config/plans';

/**
 * AI bots reading your site (AT-011, spec §3.7, §7): Starter locked with
 * sample data and Upgrade; sample data under Connect with a preview; waiting
 * for the first request; then bot types, pages and the search-bot alert.
 */

const getBotConnections = vi.fn();
const createBotConnection = vi.fn();
vi.mock('@/lib/actions/aiBots', () => ({
  createBotConnection: (...a: unknown[]) => createBotConnection(...a),
  revokeBotConnection: vi.fn(),
}));
const getTrafficBots = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({}));
vi.mock('@/lib/trafficReads', () => ({
  getBotConnections: (...a: unknown[]) => getBotConnections(...a),
  getTrafficBots: (...a: unknown[]) => getTrafficBots(...a),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { BotsReportSection } = await import('./_BotsReport');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const WEEK: TrafficDateWindow = { dateFrom: '2026-10-12T09:00:00.000Z' };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const info = (over: Partial<BotConnections> = {}): BotConnections => ({
  connections: [{ id: 'c1', kind: 'cloudflare_worker', createdAt: 't', lastEventAt: hoursAgo(1) }],
  usage: {
    month: '2026-10-01',
    stored: 10,
    counted: 10,
    cappedAt: null,
    cap: 2_000_000,
    raw: 0,
    rawCappedAt: null,
    rawCap: 20_000_000,
  },
  ...over,
});
const report = (over: Partial<TrafficBots> = {}): TrafficBots => ({
  firstDay: '2026-09-01',
  lastSeen: hoursAgo(1),
  types: [
    {
      type: 'training',
      hits: 1200,
      pages: 300,
      lastSeen: hoursAgo(2),
      bots: ['gptbot', 'claudebot'],
    },
    { type: 'search', hits: 400, pages: 120, lastSeen: hoursAgo(1), bots: ['oai-searchbot'] },
  ],
  bots: [],
  pageCount: 14,
  pages: [
    { page: '/menu', hits: 90, trainingLast: hoursAgo(2), searchLast: null, userLast: hoursAgo(1) },
  ],
  uncrawledCount: 3,
  uncrawled: [{ page: '/gifts', citations: 14 }],
  alertState: 'on',
  alertFrom: '2026-09-30',
  since: '2026-10-12',
  ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getBotConnections.mockReset().mockResolvedValue(info());
  getTrafficBots.mockReset().mockResolvedValue(report());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
});

async function render(canConnect = true, revision = 0, onChanged?: () => void) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <BotsReportSection
          brandId="b1"
          dateWindow={WEEK}
          rangeLabel="last 7 days"
          canConnect={canConnect}
          revision={revision}
          onChanged={onChanged}
        />
      </NextIntlClientProvider>,
    );
  });
}

/** On GetCito Cloud, on `planId`, whose subscription has ended. */
async function renderOnEndedPlan(planId: PlanId) {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PlanProvider planId={planId} subscriptionActive={false}>
          <BotsReportSection brandId="b1" dateWindow={WEEK} rangeLabel="last 7 days" canConnect />
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
}

/** A fresh section: it reads again. */
async function remount(canConnect = true) {
  act(() => root.unmount());
  root = createRoot(container);
  await render(canConnect);
}

const text = () => container.textContent ?? '';
const rows = () =>
  [...container.querySelectorAll('tbody tr')].map((r) =>
    [...r.querySelectorAll('td')].map((td) => td.textContent),
  );

describe('BotsReportSection', () => {
  it("keeps the new connection's settings up while the page reads the section again", async () => {
    // Not connected yet: the sample with Connect.
    getBotConnections.mockResolvedValue(info({ connections: [] }));
    getTrafficBots.mockResolvedValue(report({ lastSeen: null }));
    createBotConnection.mockResolvedValue({
      connection: { id: 'c9', kind: 'cloudflare_worker', createdAt: 't', lastEventAt: null },
      secret: 'getcito_bot_new_secret',
      endpoint: 'https://api.example/bots/ingest',
      workerScript: 'const SECRET = "getcito_bot_new_secret";',
      logpushJob: null,
      vercelDrain: null,
    });
    const onChanged = vi.fn();
    await render(true, 0, onChanged);
    const button = (label: string) =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === label)!;
    await act(async () => button('Connect').click());
    await act(async () => button('Create connection').click());
    expect(onChanged).toHaveBeenCalled();
    // The page bumps the section's revision: it reads again, and the dialog
    // still shows the secret, once.
    await render(true, 1, onChanged);
    expect(getBotConnections).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("the secret in them isn't shown again");
    expect(document.body.textContent).toContain('getcito_bot_new_secret');

    // A read that fails after that keeps it up too.
    getBotConnections.mockResolvedValue({ error: 'failed' });
    await render(true, 2, onChanged);
    expect(getBotConnections).toHaveBeenCalledTimes(3);
    expect(document.body.textContent).toContain('getcito_bot_new_secret');
  });

  it('shows the bot types, the pages each type last read, and the search-bot alert', async () => {
    await render();
    expect(getTrafficBots).toHaveBeenCalledWith('b1', WEEK);
    expect(text()).toContain('Growth and above · needs Cloudflare or Vercel');
    expect(rows()).toEqual([
      ['Training (GPTBot, ClaudeBot)', '1,200', '300', '2h ago'],
      ['Search index (OAI-SearchBot)', '400', '120', '1h ago'],
      ['/menu', '90', '2h ago', '—', '1h ago'],
    ]);
    expect(text()).toContain(
      "3 pages AI answers cited weren't read by any search bot in the last 30 days",
    );
    expect(text()).toContain('/giftscited 14 times');
    expect(text()).toContain('and 2 more');
    expect(text()).toContain('1 of 14 pages');
  });

  it('says when the alert starts, or that every cited page was read', async () => {
    getTrafficBots.mockResolvedValue(report({ uncrawledCount: null, uncrawled: null }));
    await render();
    expect(text()).toContain('The search-bot alert starts on Sep 30');

    getTrafficBots.mockResolvedValue(report({ uncrawledCount: 0, uncrawled: [] }));
    await remount();
    expect(text()).toContain('Every page AI answers cited in the last 30 days was read');
  });

  it("pauses the alert while the bot data isn't whole, rather than listing every cited page", async () => {
    getTrafficBots.mockResolvedValue(
      report({ alertState: 'stale', uncrawledCount: null, uncrawled: null }),
    );
    await render();
    expect(text()).toContain('The search-bot alert is paused');
    expect(text()).not.toContain('The search-bot alert starts on');
  });

  it("says why the report stops mid-month once a log sender's raw cap is reached", async () => {
    getBotConnections.mockResolvedValue(
      info({
        connections: [
          { id: 'c1', kind: 'cloudflare_logpush', createdAt: 't', lastEventAt: hoursAgo(30) },
        ],
        usage: {
          month: '2026-10-01',
          stored: 10,
          counted: 10,
          cappedAt: null,
          cap: 2_000_000,
          raw: 20_000_400,
          rawCappedAt: '2026-10-18T09:00:00Z',
          rawCap: 20_000_000,
        },
      }),
    );
    await render();
    expect(text()).toContain('Log files paused until');
    expect(text()).toContain("this month's log records are used up");
  });

  it('says "last 90 days" for All time, which is what it covers', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <BotsReportSection brandId="b1" dateWindow={{}} rangeLabel="all time" canConnect />
        </NextIntlClientProvider>,
      );
    });
    expect(text()).toContain('last 90 days');
    expect(text()).not.toContain('all time');
  });

  it('locks the report with sample data and Upgrade on Starter', async () => {
    getBotConnections.mockResolvedValue(info({ usage: { ...info().usage, cap: 0 } }));
    await render();
    expect(text()).toContain('The AI bot report comes with the Growth plan.');
    expect(text()).toContain('8,420');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/settings?tab=billing',
    );
  });

  // A plan that ended reads caps of 0 with noPlan: the plan it was on decides the lock.
  it('shows a workspace whose Growth plan ended its own data, not the locked sample', async () => {
    getBotConnections.mockResolvedValue(
      info({ usage: { ...info().usage, cap: 0, rawCap: 0, noPlan: true } }),
    );
    await renderOnEndedPlan('growth');
    expect(text()).not.toContain('The AI bot report comes with the Growth plan.');
    expect(text()).not.toContain('8,420');
    expect(container.querySelector('a[href="/dashboard/settings?tab=billing"]')).toBeNull();
    expect(rows()).toEqual([
      ['Training (GPTBot, ClaudeBot)', '1,200', '300', '2h ago'],
      ['Search index (OAI-SearchBot)', '400', '120', '1h ago'],
      ['/menu', '90', '2h ago', '—', '1h ago'],
    ]);
  });

  it('keeps the locked sample and Upgrade for a workspace whose Starter plan ended', async () => {
    getBotConnections.mockResolvedValue(
      info({ usage: { ...info().usage, cap: 0, rawCap: 0, noPlan: true } }),
    );
    await renderOnEndedPlan('starter');
    expect(text()).toContain('The AI bot report comes with the Growth plan.');
    expect(text()).toContain('8,420');
    expect(container.querySelector('a[href="/dashboard/settings?tab=billing"]')).not.toBeNull();
  });

  it('offers Connect over sample data, and a preview of it', async () => {
    getBotConnections.mockResolvedValue(info({ connections: [] }));
    getTrafficBots.mockResolvedValue(report({ lastSeen: null, types: [], pages: [] }));
    await render();
    expect(text()).toContain('Connect Cloudflare or Vercel in 2 minutes.');
    const preview = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Preview with sample data',
    )!;
    await act(async () => preview.click());
    expect(text()).not.toContain('Connect Cloudflare or Vercel in 2 minutes.');
    expect(text()).toContain('Sample data: connect Cloudflare or Vercel to see yours.');

    await remount(false);
    const connect = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Connect',
    )!;
    expect(connect.disabled).toBe(true);
  });

  it('waits for the first request once connected', async () => {
    getBotConnections.mockResolvedValue(
      info({
        connections: [{ id: 'c1', kind: 'vercel_drain', createdAt: 't', lastEventAt: null }],
      }),
    );
    getTrafficBots.mockResolvedValue(report({ lastSeen: null, types: [], pages: [] }));
    await render();
    expect(text()).toContain('Waiting for the first AI-bot request');
  });

  it('says when the range had no bot, and when the report failed', async () => {
    getTrafficBots.mockResolvedValue(report({ types: [], pages: [] }));
    await render();
    expect(text()).toContain('No AI bot read your site in this range.');

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    getTrafficBots.mockRejectedValue(new Error('boom'));
    await remount();
    expect(text()).toContain("Couldn't load the AI bot report.");
    quiet.mockRestore();
  });
});
