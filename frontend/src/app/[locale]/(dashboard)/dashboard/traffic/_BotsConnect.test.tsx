import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { PlanProvider } from '@/components/context/PlanProvider';
import type { PlanId } from '@/config/plans';
import type { BotConnections, NewBotConnection } from '@/lib/actions/aiBots';

/**
 * The AI bots card and its dialog (AT-010, spec §6.1, §6.4): Upgrade on a
 * plan without the report, Connect, then Manage; the customer's own cost
 * said before connecting, and the settings with the secret shown once.
 */

const getBotConnections = vi.fn();
const createBotConnection = vi.fn();
const revokeBotConnection = vi.fn();
vi.mock('@/lib/actions/aiBots', () => ({
  createBotConnection: (...a: unknown[]) => createBotConnection(...a),
  revokeBotConnection: (...a: unknown[]) => revokeBotConnection(...a),
}));
vi.mock('@/lib/trafficReads', () => ({
  getBotConnections: (...a: unknown[]) => getBotConnections(...a),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { BotsSource } = await import('./_BotsConnect');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const info = (over: Partial<BotConnections> = {}): BotConnections => ({
  connections: [],
  usage: {
    month: '2026-10-01',
    stored: 0,
    counted: 0,
    cappedAt: null,
    cap: 2_000_000,
    raw: 0,
    rawCappedAt: null,
    rawCap: 20_000_000,
  },
  ...over,
});
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getBotConnections.mockReset().mockResolvedValue(info());
  createBotConnection.mockReset();
  revokeBotConnection.mockReset().mockResolvedValue({ ok: true });
  toast.success.mockReset();
  toast.error.mockReset();
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

const openUpgrade = vi.fn();
/** `planId`: on GetCito Cloud, the plan the workspace is (or was) on. */
async function render(canConnect = true, isLocked = false, planId?: PlanId) {
  const source = <BotsSource brandId="b1" canConnect={canConnect} />;
  if (planId) vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          {planId ? (
            <PlanProvider planId={planId} subscriptionActive={!isLocked}>
              {source}
            </PlanProvider>
          ) : (
            source
          )}
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const card = () => container.textContent ?? '';
const page = () => document.body.textContent ?? '';
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

describe('BotsSource', () => {
  it('offers Upgrade on a plan without the bot report', async () => {
    getBotConnections.mockResolvedValue(info({ usage: { ...info().usage, cap: 0 } }));
    await render();
    expect(card()).toContain('Cloudflare / Vercel · Growth+');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/settings?tab=billing',
    );
  });

  it("says what each way costs on the customer's bill, then shows the settings once", async () => {
    await render();
    expect(card()).toContain('see which AI bots read your pages');
    await act(async () => button('Connect')!.click());
    expect(page()).toContain('free up to 100,000 requests a day');
    expect(page()).toContain('$0.50 per GB of drained data');
    expect(page()).toContain('avoids the per-request Worker cost');

    const created: NewBotConnection = {
      connection: { id: 'c1', kind: 'vercel_drain', createdAt: 't', lastEventAt: null },
      secret: 'getcito_bot_s3cret',
      endpoint: 'https://api.example/bots/ingest',
      workerScript: null,
      workerSecretName: null,
      logpushJob: null,
      vercelDrain: {
        endpoint: 'https://api.example/bots/ingest',
        format: 'json',
        headers: ['Authorization: Bearer getcito_bot_s3cret'],
        sources: ['static', 'lambda'],
      },
    };
    createBotConnection.mockResolvedValue(created);
    const vercel = [...document.querySelectorAll('[role="radio"]')].find((r) =>
      r.textContent?.includes('Vercel Drain'),
    ) as HTMLElement;
    await act(async () => vercel.click());
    await act(async () => button('Create connection')!.click());
    expect(createBotConnection).toHaveBeenCalledWith('b1', 'vercel_drain');
    expect(page()).toContain("the secret in them isn't shown again");
    expect(page()).toContain('Authorization: Bearer getcito_bot_s3cret');
    // Left out of session replays (SEC-10a).
    const secret = [...document.querySelectorAll('pre')].find((pre) =>
      pre.textContent?.includes('getcito_bot_s3cret'),
    );
    expect(secret?.closest('.ph-no-capture')).not.toBeNull();
    expect(page()).toContain('Format: JSON. Log sources: static, lambda.');
    expect(getBotConnections).toHaveBeenCalledTimes(2);
  });

  // The server reads caps of 0 without an active plan (noPlan): the plan it was on decides.
  it('shows a workspace whose Growth plan ended its own connections and use, not Upgrade', async () => {
    openUpgrade.mockReset();
    getBotConnections.mockResolvedValue(
      info({
        connections: [
          { id: 'c1', kind: 'cloudflare_worker', createdAt: 't', lastEventAt: hoursAgo(1) },
        ],
        usage: { ...info().usage, stored: 1_200, cap: 0, rawCap: 0, noPlan: true },
      }),
    );
    await render(true, true, 'growth');
    expect(card()).toContain('Cloudflare / Vercel · last event 1h ago');
    expect(card()).not.toContain('Growth+');
    expect(container.querySelector('a[href="/dashboard/settings?tab=billing"]')).toBeNull();
    await act(async () => button('Manage')!.click());
    expect(page()).toContain('This month: 1,200 detailed rows. · No active plan');
    expect(page()).not.toContain('of 0');
    await act(async () => button('Create connection')!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Connecting bot logs needs a plan');
    expect(createBotConnection).not.toHaveBeenCalled();
  });

  it('keeps Upgrade for a workspace whose Starter plan ended', async () => {
    getBotConnections.mockResolvedValue(
      info({ usage: { ...info().usage, cap: 0, rawCap: 0, noPlan: true } }),
    );
    await render(true, true, 'starter');
    expect(card()).toContain('Cloudflare / Vercel · Growth+');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/settings?tab=billing',
    );
  });

  it('makes no connection on a read-only workspace: Create connection opens the upgrade dialog', async () => {
    openUpgrade.mockReset();
    await render(true, true);
    await act(async () => button('Connect')!.click());
    await act(async () => button('Create connection')!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Connecting bot logs needs a plan');
    expect(createBotConnection).not.toHaveBeenCalled();
  });

  // gkhngyk on #1225: a failed read after the create took the dialog down.
  it('keeps the settings with the secret when the read after a create fails', async () => {
    await render();
    await act(async () => button('Connect')!.click());
    createBotConnection.mockResolvedValue({
      connection: { id: 'c1', kind: 'cloudflare_worker', createdAt: 't', lastEventAt: null },
      secret: 'getcito_bot_s3cret',
      endpoint: 'https://api.example/bots/ingest',
      workerScript: 'const ENDPOINT = "https://api.example/bots/ingest"; // env.GETCITO_BOT_SECRET',
      workerSecretName: 'GETCITO_BOT_SECRET',
      logpushJob: null,
      vercelDrain: null,
    } satisfies NewBotConnection);
    getBotConnections.mockResolvedValue({ error: 'Server error: 502' });
    await act(async () => button('Create connection')!.click());

    expect(getBotConnections).toHaveBeenCalledTimes(2);
    expect(card()).toContain("Cloudflare / Vercel · couldn't be read");
    expect(page()).toContain("the secret in them isn't shown again");
    expect(page()).toContain('getcito_bot_s3cret');
  });

  // gkhngyk on #1179: the secret sat in the Worker's code.
  it('gives a Worker its code without the secret, and the secret to add as a Worker Secret', async () => {
    await render();
    await act(async () => button('Connect')!.click());
    createBotConnection.mockResolvedValue({
      connection: { id: 'c1', kind: 'cloudflare_worker', createdAt: 't', lastEventAt: null },
      secret: 'getcito_bot_s3cret',
      endpoint: 'https://api.example/bots/ingest',
      workerScript: 'const ENDPOINT = "https://api.example/bots/ingest"; // env.GETCITO_BOT_SECRET',
      workerSecretName: 'GETCITO_BOT_SECRET',
      logpushJob: null,
      vercelDrain: null,
    } satisfies NewBotConnection);
    await act(async () => button('Create connection')!.click());
    expect(createBotConnection).toHaveBeenCalledWith('b1', 'cloudflare_worker');
    expect(page()).toContain('add a variable of type Secret with the name and value below');
    expect(page()).toContain('Secret value (name: GETCITO_BOT_SECRET)');
    expect(page()).toContain('getcito_bot_s3cret');
  });

  it('shows a Logpush job to copy: the destination and the settings', async () => {
    await render();
    await act(async () => button('Connect')!.click());
    createBotConnection.mockResolvedValue({
      connection: { id: 'c3', kind: 'cloudflare_logpush', createdAt: 't', lastEventAt: null },
      secret: 'getcito_bot_s3cret',
      endpoint: 'https://api.example/bots/ingest',
      workerScript: null,
      workerSecretName: null,
      logpushJob: {
        dataset: 'http_requests',
        destination_conf:
          'https://api.example/bots/ingest?header_Authorization=Bearer%20getcito_bot_s3cret',
      },
      vercelDrain: null,
    } satisfies NewBotConnection);
    const logpush = [...document.querySelectorAll('[role="radio"]')].find((r) =>
      r.textContent?.includes('Cloudflare Logpush'),
    ) as HTMLElement;
    await act(async () => logpush.click());
    await act(async () => button('Create connection')!.click());
    expect(page()).toContain('Job settings (Cloudflare API: POST /zones/ZONE_ID/logpush/jobs)');
    expect(page()).toContain('header_Authorization=Bearer%20getcito_bot_s3cret');
    expect(page()).toContain('"dataset": "http_requests"');
    expect(page()).not.toContain('traffic.bots.');
  });

  it('manages connected senders: last request, use this month, revoke', async () => {
    getBotConnections.mockResolvedValue(
      info({
        connections: [
          { id: 'c1', kind: 'cloudflare_worker', createdAt: 't', lastEventAt: hoursAgo(1) },
        ],
        usage: {
          month: '2026-10-01',
          stored: 2_000_000,
          counted: 2_400_000,
          cappedAt: '2026-10-25T00:00:00Z',
          cap: 2_000_000,
          raw: 0,
          rawCappedAt: null,
          rawCap: 20_000_000,
        },
      }),
    );
    await render();
    expect(card()).toContain('Cloudflare / Vercel · last event 1h ago');
    await act(async () => button('Manage')!.click());
    expect(page()).toContain('This month: 2,000,000 of 2,000,000 detailed rows.');
    expect(page()).toContain('Detailed rows paused until Nov 1, totals still counted.');
    // A Worker's batches don't count against the log records cap.
    expect(page()).not.toContain('Log records this month');

    await act(async () => button('Revoke')!.click());
    await act(async () => button('Revoke: stop reading it')!.click());
    expect(revokeBotConnection).toHaveBeenCalledWith('b1', 'c1');
    expect(toast.success).toHaveBeenCalled();
  });

  it("shows a log sender's records against the raw cap, and when its files are read again", async () => {
    getBotConnections.mockResolvedValue(
      info({
        connections: [
          { id: 'c1', kind: 'vercel_drain', createdAt: 't', lastEventAt: hoursAgo(30) },
        ],
        usage: {
          month: '2026-10-01',
          stored: 1_000,
          counted: 1_000,
          cappedAt: null,
          cap: 2_000_000,
          raw: 20_000_400,
          rawCappedAt: '2026-10-18T09:00:00Z',
          rawCap: 20_000_000,
        },
      }),
    );
    await render();
    await act(async () => button('Manage')!.click());
    expect(page()).toContain('Log records this month: 20,000,400 of 20,000,000.');
    expect(page()).toContain(
      "Log files paused until Nov 1: this month's log records are used up, so requests from Logpush or the Vercel drain aren't read until then.",
    );
  });

  it('waits for the first request, and keeps members from connecting', async () => {
    getBotConnections.mockResolvedValue(
      info({
        connections: [{ id: 'c1', kind: 'cloudflare_logpush', createdAt: 't', lastEventAt: null }],
      }),
    );
    await render();
    expect(card()).toContain('Connected · waiting for the first AI-bot request');

    act(() => root.unmount());
    root = createRoot(container);
    getBotConnections.mockResolvedValue(info());
    await render(false);
    expect(button('Connect')!.disabled).toBe(true);
  });
});
