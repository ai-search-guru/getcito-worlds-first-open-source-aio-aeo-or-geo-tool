import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { WixConnection, WixError } from '@/lib/wixClient';

const client = vi.hoisted(() => ({
  readWix: vi.fn(),
  connectWix: vi.fn(),
  disconnectWix: vi.fn(),
}));
vi.mock('@/lib/wixClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wixClient')>()),
  ...client,
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
const store = vi.hoisted(() => ({ activeBrandId: 'b1' }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: () => ({
    activeBrandId: store.activeBrandId,
    brands: [
      { id: 'b1', name: 'Acme' },
      { id: 'b2', name: 'Beta' },
    ],
  }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// The read-only workspace's upgrade dialog.
const openUpgrade = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ isLocked: false }));
vi.mock('@/components/context/upgradeGate', () => ({
  useUpgradeGate: () => ({
    isLocked: gate.isLocked,
    openUpgrade,
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options: { action?: string } = {}) =>
      (...args: Args) =>
        gate.isLocked ? openUpgrade(options.action) : fn(...args),
  }),
}));

const { WixCard } = await import('./WixCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Wix (Send to CMS #1331, phase 2; 00372): a brand's site and API key. */

// Every reason the client names has its words: a missing one fails typecheck. A read-only
// workspace's refusal opens the upgrade dialog instead.
const ERROR_TEXTS: Record<Exclude<WixError, 'subscription'>, string> = messages.settings.wix.errors;

let container: HTMLDivElement;
let root: Root;

const SITE = '2f8a1c3e-1111-4222-8333-944455556666';
const KEY = 'IST.eyJraWQiOiJQb3pIX2FDMiJ9.fake-key';
const CONNECTED: WixConnection = {
  status: 'connected',
  siteId: SITE,
  siteName: 'Acme Coffee',
  connectedAt: '2026-10-27T10:00:00Z',
  updatedAt: '2026-10-27T10:00:00Z',
};

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WixCard />
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (el: Element | undefined) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
};
/** The input a label names. */
const field = (label: string) => {
  const name = [...container.querySelectorAll('label')].find((l) => l.textContent === label);
  return container.querySelector<HTMLInputElement>(`[id="${name!.htmlFor}"]`)!;
};
async function type(label: string, value: string) {
  const input = field(label);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const submit = async () => {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  role.canManage = true;
  store.activeBrandId = 'b1';
  gate.isLocked = false;
  openUpgrade.mockReset();
  for (const fn of Object.values(client)) fn.mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
  client.readWix.mockResolvedValue({ ok: true, configured: true, connection: null });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WixCard', () => {
  it('connects the site with its id and an API key, never keeping the key', async () => {
    client.connectWix.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    expect(field('API key').type).toBe('password');
    expect(field('API key').autocomplete).toBe('new-password');
    expect(button('Connect')!.disabled).toBe(true);
    await type('Site id', `https://manage.wix.com/dashboard/${SITE}/home `);
    await type('API key', KEY);
    await submit();
    expect(client.connectWix).toHaveBeenCalledWith('b1', {
      siteId: `https://manage.wix.com/dashboard/${SITE}/home`,
      apiKey: KEY,
    });
    expect(toast.success).toHaveBeenCalledWith('Wix connected');
    expect(container.textContent).toContain('Site: Acme Coffee');
    expect(container.textContent).toContain("Pages go to Acme Coffee's Blog as draft posts.");
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('says what Wix answered, in our words', async () => {
    client.connectWix.mockResolvedValue({ ok: false, code: 'no_blog' });
    await render();
    await type('Site id', SITE);
    await type('API key', KEY);
    await submit();
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.no_blog);
    expect(field('API key').value).toBe(KEY);
  });

  it('says the key needs the Ricos permission when Wix’s converter refuses it', async () => {
    client.connectWix.mockResolvedValue({ ok: false, code: 'no_ricos_permission' });
    await render();
    await type('Site id', SITE);
    await type('API key', KEY);
    await submit();
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.no_ricos_permission);
    expect(ERROR_TEXTS.no_ricos_permission).toContain('Manage Ricos Document');
  });

  it('asks to connect again after a refused key, with the site filled in', async () => {
    client.readWix.mockResolvedValue({
      ok: true,
      configured: true,
      connection: { ...CONNECTED, status: 'auth_failed' },
    });
    await render();
    expect(container.textContent).toContain('API key refused');
    expect(field('Site id').value).toBe(SITE);
  });

  it('disconnects, and says to delete the key in Wix too', async () => {
    client.readWix.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.disconnectWix.mockResolvedValue({ ok: true, success: true });
    await render();
    await click(button('Disconnect'));
    const dialog = document.body.querySelector('[role="dialog"]')!;
    await click(button('Disconnect', dialog));
    expect(client.disconnectWix).toHaveBeenCalledWith('b1');
    expect(toast.success).toHaveBeenCalledWith(
      "Wix disconnected. Delete the API key in Wix's API Keys Manager too.",
    );
  });

  it('shows members where pages go, with no form or buttons', async () => {
    role.canManage = false;
    client.readWix.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    expect(container.textContent).toContain("Pages go to Acme Coffee's Blog as draft posts.");
    expect(container.querySelector('form')).toBeNull();
    expect(button('Disconnect')).toBeUndefined();
  });

  it('opens the upgrade dialog, not an error, when a read-only workspace’s connect or disconnect is refused', async () => {
    client.connectWix.mockResolvedValue({ ok: false, code: 'subscription' });
    await render();
    await type('Site id', SITE);
    await type('API key', KEY);
    await submit();
    expect(client.connectWix).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();

    client.readWix.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.disconnectWix.mockResolvedValue({ ok: false, code: 'subscription' });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    await click(button('Disconnect'));
    await click(button('Disconnect', document.body.querySelector('[role="dialog"]')!));
    expect(client.disconnectWix).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('on a read-only workspace, connects and changes no key, and still disconnects', async () => {
    gate.isLocked = true;
    await render();
    await type('Site id', SITE);
    await type('API key', KEY);
    await submit();
    expect(openUpgrade).toHaveBeenLastCalledWith('Connecting your CMS needs a plan');
    expect(client.connectWix).not.toHaveBeenCalled();

    client.readWix.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.disconnectWix.mockResolvedValue({ ok: true, success: true });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    await click(button('Change API key'));
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await click(button('Disconnect'));
    await click(button('Disconnect', document.body.querySelector('[role="dialog"]')!));
    expect(client.disconnectWix).toHaveBeenCalledWith('b1');
  });
});
