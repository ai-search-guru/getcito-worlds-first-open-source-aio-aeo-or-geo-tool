import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Settings › MCP & API Keys on a read-only workspace (plan not active): the keys
 * show and both New key and revoking stay open. A key costs nothing, and the
 * MCP surface it opens only reads for such a workspace.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApiKeysSection } = await import('./ApiKeysSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();
const fetchMock = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    !init?.method
      ? json({
          keys: [
            {
              id: 'k1',
              name: 'MCP — laptop',
              prefix: 'ak_1234',
              created_at: '2026-10-01T00:00:00Z',
              last_used_at: null,
              revoked_at: null,
            },
          ],
        })
      : json({ ok: true }),
  );
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ApiKeysSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

describe('ApiKeysSection', () => {
  it('is titled MCP & API Keys, as the Settings menu names it', async () => {
    await render(false);
    expect(container.querySelector('[data-slot="card-title"]')?.textContent).toBe('MCP & API Keys');
    expect(messages.settings.apiKeys).toBe('MCP & API Keys');
  });

  it('creates and revokes keys on a read-only workspace', async () => {
    await render(true);
    expect(container.textContent).toContain('MCP — laptop');
    await act(async () => button('New key')!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New API key');
    await act(async () => button('Cancel')!.click());

    const trash = container.querySelector<HTMLButtonElement>('button.text-destructive')!;
    await act(async () => trash.click());
    await act(async () => button('Revoke')!.click());
    expect(fetchMock).toHaveBeenCalledWith('/api/keys/k1', { method: 'DELETE' });
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('says on the cloud that MCP writes need Growth, and nothing self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    await render(false);
    expect(container.querySelector('[data-slot="mcp-plan-note"]')?.textContent).toBe(
      'On Starter and in the free trial, MCP tools and the API can read. Changes need Growth.',
    );
    act(() => root.unmount());
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    root = createRoot(container);
    await render(false);
    expect(container.querySelector('[data-slot="mcp-plan-note"]')).toBeNull();
    vi.unstubAllEnvs();
  });

  it('shows the new key and its MCP setup outside session replays', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? json({ key: { id: 'k2', name: 'laptop', prefix: 'ak_9876', token: 'ak_9876_secret' } })
        : json({ keys: [] }),
    );
    await render(false);
    await act(async () => button('New key')!.click());
    const name = document.querySelector<HTMLInputElement>('#apiKeyName')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        name,
        'laptop',
      );
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Create')!.click());

    const shown = [...document.querySelectorAll('code, pre')].filter((el) =>
      el.textContent?.includes('ak_9876_secret'),
    );
    expect(shown.map((el) => el.tagName)).toEqual(['CODE', 'PRE']);
    for (const el of shown) expect(el.closest('.ph-no-capture')).not.toBeNull();
  });

  it('opens New key on an active plan', async () => {
    await render(false);
    await act(async () => button('New key')!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New API key');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
