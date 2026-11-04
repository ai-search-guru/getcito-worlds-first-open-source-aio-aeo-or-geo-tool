import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * The OAuth popup flow shared by Settings › Integrations and AI Traffic's
 * sources strip: open the popup, poll until the account is connected, and
 * stop once the caller is gone. On a read-only workspace (plan not active)
 * it opens the upgrade dialog instead and starts nothing. Its calls go from
 * the browser (never a server action waiting behind the page's), and a
 * Connect that can't start says why.
 */

const actions = vi.hoisted(() => ({
  startIntegrationConnect: vi.fn(),
  readIntegrationStatus: vi.fn(),
}));
vi.mock('@/lib/integrationsClient', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { useIntegrationConnect } = await import('./useIntegrationConnect');
const { toast } = await import('sonner');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const harness: { connect?: () => Promise<void> | undefined } = {};
const connect = () => harness.connect!() as Promise<void>;
const onStatus = vi.fn();
const popup = { closed: false, close: vi.fn() };
const openUpgrade = vi.fn();

function Harness() {
  const { connect: start } = useIntegrationConnect('google-analytics', {
    label: 'Google Analytics',
    callbackUrl: () => 'https://app.example/dashboard/traffic',
    onStatus,
  });
  useEffect(() => {
    harness.connect = start;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  popup.closed = false;
  actions.startIntegrationConnect.mockResolvedValue({
    ok: true,
    value: 'https://oauth.example/start',
  });
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  container = document.createElement('div');
  root = createRoot(container);
  render(false);
});

function render(isLocked: boolean) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <Harness />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    ),
  );
}

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useIntegrationConnect', () => {
  it('opens the popup at the OAuth URL and reports the account once connected', async () => {
    actions.readIntegrationStatus
      .mockResolvedValueOnce({ ok: true, value: 'not_connected' })
      .mockResolvedValueOnce({ ok: true, value: 'connected' });
    let done!: Promise<void>;
    act(() => {
      done = connect();
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
    await done;

    expect(actions.startIntegrationConnect).toHaveBeenCalledWith(
      'google-analytics',
      'https://app.example/dashboard/traffic',
    );
    expect(window.open).toHaveBeenCalledWith(
      'https://oauth.example/start',
      'google-analytics-oauth',
      'width=560,height=720',
    );
    expect(onStatus).toHaveBeenCalledWith('connected');
    expect(popup.close).toHaveBeenCalled();
  });

  it('reports the final status when the user closes the popup', async () => {
    actions.readIntegrationStatus.mockResolvedValue({ ok: true, value: 'not_connected' });
    let done!: Promise<void>;
    act(() => {
      done = connect();
    });
    popup.closed = true;
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    await done;
    expect(onStatus).toHaveBeenCalledWith('not_connected');
  });

  it('stops polling once its caller is gone', async () => {
    actions.readIntegrationStatus.mockResolvedValue({ ok: true, value: 'not_connected' });
    act(() => {
      void connect();
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    act(() => root.unmount());
    actions.readIntegrationStatus.mockResolvedValue({ ok: true, value: 'connected' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onStatus).not.toHaveBeenCalled();
    // Re-mount for afterEach's unmount.
    root = createRoot(container);
  });

  it('opens the upgrade dialog, and no popup, on a read-only workspace', async () => {
    render(true);
    await act(async () => void harness.connect!());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Connecting an integration needs a plan');
    expect(actions.startIntegrationConnect).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('keeps polling through a status read that fails', async () => {
    actions.readIntegrationStatus
      .mockResolvedValueOnce({ ok: false, reason: 'timeout' })
      .mockResolvedValueOnce({ ok: true, value: 'connected' });
    let done!: Promise<void>;
    act(() => {
      done = connect();
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
    await done;
    expect(onStatus).toHaveBeenCalledExactlyOnceWith('connected');
  });

  it.each([
    ['failed', "Couldn't start connecting Google Analytics. Try again in a moment."],
    ['timeout', 'Connecting Google Analytics took too long to start. Try again in a moment.'],
    ['forbidden', 'Only admins and managers can connect integrations.'],
  ])('says why a Connect could not start (%s), and opens no popup', async (reason, message) => {
    actions.startIntegrationConnect.mockResolvedValue({ ok: false, reason });
    await act(async () => void (await connect()));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(message);
    expect(window.open).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("opens the upgrade dialog when the API says the workspace's plan isn't active", async () => {
    actions.startIntegrationConnect.mockResolvedValue({ ok: false, reason: 'subscription' });
    await act(async () => void (await connect()));
    expect(openUpgrade).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });
});
