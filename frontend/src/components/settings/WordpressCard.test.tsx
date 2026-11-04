import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { WordPressConnection, WordPressError } from '@/lib/wordpressClient';

const client = vi.hoisted(() => ({
  readWordPress: vi.fn(),
  connectWordPress: vi.fn(),
  disconnectWordPress: vi.fn(),
}));
vi.mock('@/lib/wordpressClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wordpressClient')>()),
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

const { WordPressCard } = await import('./WordpressCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › WordPress (Send to CMS #1331, phase 2; 00294): a brand's site and sign-in. */

// Every reason the client names has its words: a missing one fails typecheck. A read-only
// workspace's refusal opens the upgrade dialog instead.
const ERROR_TEXTS: Record<Exclude<WordPressError, 'subscription'>, string> = messages.settings
  .wordpress.errors;

let container: HTMLDivElement;
let root: Root;

const CONNECTED: WordPressConnection = {
  status: 'connected',
  siteUrl: 'https://blog.acme.example',
  siteName: 'Acme Coffee Blog',
  account: 'editor',
  connectedAt: '2026-10-27T10:00:00Z',
  updatedAt: '2026-10-27T10:00:00Z',
};

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WordPressCard />
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
  client.readWordPress.mockResolvedValue({ ok: true, configured: true, connection: null });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WordPressCard', () => {
  it('connects the site with a user and an Application Password, never keeping the password', async () => {
    client.connectWordPress.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    expect(field('Application Password').type).toBe('password');
    expect(button('Connect')!.disabled).toBe(true);
    await type('Site address', 'blog.acme.example ');
    await type('User', 'editor');
    await type('Application Password', 'abcd efgh ijkl mnop qrst uvwx');
    await submit();
    expect(client.connectWordPress).toHaveBeenCalledWith('b1', {
      siteUrl: 'blog.acme.example',
      username: 'editor',
      password: 'abcd efgh ijkl mnop qrst uvwx',
    });
    expect(toast.success).toHaveBeenCalledWith('WordPress connected');
    expect(container.textContent).toContain('Connected');
    expect(container.textContent).toContain('Site: https://blog.acme.example · signs in as editor');
    expect(container.textContent).toContain('Pages go to Acme Coffee Blog as draft posts.');
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('offers no saved password, and stops a password too short to be an Application Password', async () => {
    await render();
    expect(field('Application Password').autocomplete).toBe('new-password');
    await type('Site address', 'blog.acme.example');
    await type('User', 'editor');
    await type('Application Password', 'hunter2 pass');
    expect(button('Connect')!.disabled).toBe(true);
    expect(container.textContent).toContain(messages.settings.wordpress.passwordShort);
    await type('Application Password', 'abcd efgh ijkl mnop qrst uvwx');
    expect(button('Connect')!.disabled).toBe(false);
    expect(container.textContent).not.toContain(messages.settings.wordpress.passwordShort);
  });

  it('says what the site answered, in our words, and keeps what was typed', async () => {
    client.connectWordPress.mockResolvedValue({ ok: false, code: 'header_dropped' });
    await render();
    await type('Site address', 'blog.acme.example');
    await type('User', 'editor');
    await type('Application Password', 'abcd efgh ijkl mnop qrst uvwx');
    await submit();
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.header_dropped);
    expect(field('Site address').value).toBe('blog.acme.example');
  });

  it('asks to connect again after a refused sign-in, with the site and user filled in', async () => {
    client.readWordPress.mockResolvedValue({
      ok: true,
      configured: true,
      connection: { ...CONNECTED, status: 'auth_failed' },
    });
    await render();
    expect(container.textContent).toContain('Sign-in refused');
    expect(container.textContent).toContain('WordPress refused the saved sign-in.');
    expect(field('Site address').value).toBe('https://blog.acme.example');
    expect(field('User').value).toBe('editor');
    expect(field('Application Password').value).toBe('');
  });

  it('changes the sign-in on demand, and goes back on Cancel, not while the site is checked', async () => {
    client.readWordPress.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    expect(container.querySelector('form')).toBeNull();
    await click(button('Change sign-in'));
    expect(container.querySelector('form')).not.toBeNull();
    await click(button('Cancel'));
    expect(container.querySelector('form')).toBeNull();

    await click(button('Change sign-in'));
    client.connectWordPress.mockReturnValueOnce(new Promise(() => {}));
    await type('Application Password', 'abcd efgh ijkl mnop qrst uvwx');
    await submit();
    expect(button('Cancel')!.disabled).toBe(true);
  });

  it('shows another brand’s connection never, while its own is read', async () => {
    client.readWordPress.mockResolvedValueOnce({
      ok: true,
      configured: true,
      connection: CONNECTED,
    });
    await render();
    expect(container.textContent).toContain('https://blog.acme.example');
    client.readWordPress.mockReturnValueOnce(new Promise(() => {}));
    store.activeBrandId = 'b2';
    await render();
    expect(container.textContent).not.toContain('https://blog.acme.example');
    expect(client.readWordPress).toHaveBeenLastCalledWith('b2');
  });

  it('disconnects, saying so when the password was revoked too', async () => {
    client.readWordPress.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.disconnectWordPress.mockResolvedValue({ ok: true, success: true, revoked: true });
    await render();
    await click(button('Disconnect'));
    await click(button('Disconnect', document.querySelector('[role="dialog"]')!));
    expect(toast.success).toHaveBeenCalledWith('WordPress disconnected');
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('disconnects, and says to delete the password in WordPress when the site didn’t let it go', async () => {
    client.readWordPress.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.disconnectWordPress.mockResolvedValue({ ok: true, success: true, revoked: false });
    await render();
    await click(button('Disconnect'));
    await click(button('Disconnect', document.querySelector('[role="dialog"]')!));
    expect(client.disconnectWordPress).toHaveBeenCalledWith('b1');
    expect(toast.warning).toHaveBeenCalledWith(messages.settings.wordpress.disconnectedNotRevoked);
    expect(container.textContent).not.toContain('Connected');
  });

  it('shows members where pages go, with no form or buttons', async () => {
    role.canManage = false;
    client.readWordPress.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    expect(container.textContent).toContain('Pages go to Acme Coffee Blog as draft posts.');
    expect(container.querySelector('form')).toBeNull();
    expect(button('Disconnect')).toBeUndefined();
    client.readWordPress.mockResolvedValue({ ok: true, configured: true, connection: null });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain(
      'Not connected. Admins and managers can connect WordPress.',
    );
  });

  it('says when the server can’t keep a sign-in, or the connection can’t be read', async () => {
    client.readWordPress.mockResolvedValue({ ok: true, configured: false, connection: null });
    await render();
    expect(container.textContent).toContain("WordPress isn't set up on this server yet.");
    act(() => root.unmount());
    root = createRoot(container);
    client.readWordPress.mockResolvedValue({ ok: false, code: 'failed' });
    await render();
    expect(container.textContent).toContain("Couldn't read the WordPress connection right now.");
  });
  it('opens the upgrade dialog, not an error, when a read-only workspace’s connect or disconnect is refused', async () => {
    client.connectWordPress.mockResolvedValue({ ok: false, code: 'subscription' });
    await render();
    await type('Site address', 'blog.acme.example');
    await type('User', 'editor');
    await type('Application Password', 'abcd efgh ijkl mnop qrst uvwx');
    await submit();
    expect(client.connectWordPress).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();

    client.readWordPress.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.disconnectWordPress.mockResolvedValue({ ok: false, code: 'subscription' });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    await click(button('Disconnect'));
    const confirm = [...document.body.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Disconnect',
    );
    await click(confirm[confirm.length - 1]);
    expect(client.disconnectWordPress).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('on a read-only workspace, connects and changes nothing, and still disconnects', async () => {
    gate.isLocked = true;
    await render();
    await type('Site address', 'blog.acme.example');
    await type('User', 'editor');
    await type('Application Password', 'abcd efgh ijkl mnop qrst uvwx');
    await submit();
    expect(openUpgrade).toHaveBeenLastCalledWith('Connecting your CMS needs a plan');
    expect(client.connectWordPress).not.toHaveBeenCalled();

    client.readWordPress.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.disconnectWordPress.mockResolvedValue({ ok: true, success: true, revoked: true });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    await click(button('Change sign-in'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Connecting your CMS needs a plan');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    // Disconnect ends an access: it stays open.
    await click(button('Disconnect'));
    const confirm = [...document.body.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Disconnect',
    );
    await click(confirm[confirm.length - 1]);
    expect(client.disconnectWordPress).toHaveBeenCalledWith('b1');
    expect(toast.success).toHaveBeenCalledWith('WordPress disconnected');
  });
});
