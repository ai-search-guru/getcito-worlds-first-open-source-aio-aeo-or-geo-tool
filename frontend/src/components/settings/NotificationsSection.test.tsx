import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Settings › Notifications: the AI Traffic weekly digest (AT-013) is turned
 * on or off per brand beside its Daily Pulse, and saved with it.
 */

let canManage = true;
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ role: canManage ? 'admin' : 'analyst', canManage, canAdmin: canManage }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { NotificationsSection } = await import('./NotificationsSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const fetchMock = vi.fn();
let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  canManage = true;
  fetchMock.mockReset().mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? { ok: true, json: async () => ({ success: true }) }
      : {
          ok: true,
          json: async () => ({
            brands: [
              {
                brandId: 'b1',
                brandName: 'Acme',
                frequency: 'daily',
                recipients: [],
                trafficDigest: true,
              },
            ],
          }),
        },
  );
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <NotificationsSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const checkbox = () => container.querySelector<HTMLButtonElement>('#traffic-digest-b1')!;

describe('NotificationsSection', () => {
  it('saves nothing on a read-only workspace: Save opens the upgrade dialog', async () => {
    openUpgrade.mockClear();
    await render(true);
    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save changes',
    )!;
    await act(async () => save.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith(
      'Saving notification settings needs a plan',
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('shows the weekly digest on, and saves it off with the pulse', async () => {
    await render();
    expect(container.textContent).toContain('AI Traffic weekly digest');
    expect(checkbox().getAttribute('data-state')).toBe('checked');

    await act(async () => checkbox().click());
    expect(checkbox().getAttribute('data-state')).toBe('unchecked');
    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save changes',
    )!;
    await act(async () => save.click());

    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(JSON.parse(init.body)).toEqual({
      brandId: 'b1',
      frequency: 'daily',
      recipients: [],
      trafficDigest: false,
    });
  });

  it("shows it off, and can't be turned on, while the brand's pulse is off", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        brands: [
          {
            brandId: 'b1',
            brandName: 'Acme',
            frequency: 'off',
            recipients: [],
            trafficDigest: true,
          },
        ],
      }),
    }));
    await render();
    expect(checkbox().getAttribute('data-state')).toBe('unchecked');
    expect(
      checkbox().hasAttribute('disabled') || checkbox().getAttribute('data-disabled') !== null,
    ).toBe(true);
    expect(container.textContent).toContain('Not sent while the Daily Pulse is off');
  });

  it('lets members see it but not change it', async () => {
    canManage = false;
    await render();
    expect(checkbox().disabled).toBe(true);
  });
});
