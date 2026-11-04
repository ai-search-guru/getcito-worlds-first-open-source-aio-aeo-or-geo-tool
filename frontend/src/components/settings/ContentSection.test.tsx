import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const getContentSettings = vi.fn();
const setBrandQualityHandoff = vi.fn();
vi.mock('@/lib/actions/contentSettings', () => ({
  getContentSettings: (...args: unknown[]) => getContentSettings(...args),
  setBrandQualityHandoff: (...args: unknown[]) => setBrandQualityHandoff(...args),
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ContentSection } = await import('./ContentSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Content (CE-051): Hand off quality fixes automatically, per brand. */

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ContentSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}
const box = () => container.querySelector<HTMLButtonElement>('[role="checkbox"]')!;

beforeEach(() => {
  getContentSettings.mockReset().mockResolvedValue({
    brands: [{ id: 'b1', name: 'Acme', qualityHandoff: false }],
    canManage: true,
  });
  setBrandQualityHandoff.mockReset().mockResolvedValue(undefined);
  toast.error.mockReset();
  openUpgrade.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('ContentSection', () => {
  it('turns a brand’s hand-off on, and says what it does', async () => {
    await render();
    expect(container.textContent).toContain('AcmeHand off quality fixes automatically');
    expect(container.textContent).toContain('Its changes wait for your review');
    expect(box().getAttribute('aria-checked')).toBe('false');
    await act(async () => box().click());
    expect(setBrandQualityHandoff).toHaveBeenCalledWith('b1', true);
    expect(box().getAttribute('aria-checked')).toBe('true');
    // Saved: not read again.
    expect(getContentSettings).toHaveBeenCalledTimes(1);
  });

  it('saves nothing on a read-only workspace: the box opens the upgrade dialog', async () => {
    await render(true);
    await act(async () => box().click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Changing content settings needs a plan');
    expect(setBrandQualityHandoff).not.toHaveBeenCalled();
    expect(box().getAttribute('aria-checked')).toBe('false');
  });

  it('puts it back when the save fails', async () => {
    setBrandQualityHandoff.mockRejectedValue(new Error('forbidden'));
    await render();
    await act(async () => box().click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't save that. Try again.");
    expect(box().getAttribute('aria-checked')).toBe('false');
  });

  it('shows it, not to change, to members who aren’t admins or managers', async () => {
    getContentSettings.mockResolvedValue({
      brands: [{ id: 'b1', name: 'Acme', qualityHandoff: true }],
      canManage: false,
    });
    await render();
    expect(box().disabled).toBe(true);
    expect(container.textContent).toContain('Only admins and managers can change these.');
  });

  it('says when there’s no brand, and when the read fails', async () => {
    getContentSettings.mockResolvedValue({ brands: [], canManage: true });
    await render();
    expect(container.textContent).toContain('Add a brand to choose how its pages work.');
    getContentSettings.mockRejectedValue(new Error('down'));
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain("Couldn't load the brands.");
    // No workspace to read: no endless wait.
    getContentSettings.mockResolvedValue(null);
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain("Couldn't load the brands.");
  });
});
