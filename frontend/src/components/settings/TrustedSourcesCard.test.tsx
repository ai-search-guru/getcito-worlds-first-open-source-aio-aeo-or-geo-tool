import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const getContentSettings = vi.fn();
const setBrandTrustedSources = vi.fn();
vi.mock('@/lib/actions/contentSettings', () => ({
  getContentSettings: (...args: unknown[]) => getContentSettings(...args),
  setBrandQualityHandoff: vi.fn(),
  setBrandTrustedSources: (...args: unknown[]) => setBrandTrustedSources(...args),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ContentSection } = await import('./ContentSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Settings › Content › Trusted sources (customer priorities item 6, 00449):
 * the sites each brand trusts, one per line, saved as sites.
 */

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
const card = () => container.querySelector('[data-slot="trusted-sources"]');
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name);
const textarea = () => container.querySelector('textarea')!;

function type(text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    set.call(textarea(), text);
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  getContentSettings.mockReset().mockResolvedValue({
    brands: [
      { id: 'b1', name: 'Acme', qualityHandoff: false, trustedSources: [] },
      { id: 'b2', name: 'Brewline', qualityHandoff: false, trustedSources: ['sca.coffee'] },
    ],
    canManage: true,
    trustedSourcesOn: true,
  });
  setBrandTrustedSources.mockReset().mockImplementation(async (_id: string, sources: string[]) => ({
    ok: true,
    sources,
  }));
  toast.error.mockReset();
  toast.success.mockReset();
  openUpgrade.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('TrustedSourcesCard', () => {
  it('lists each brand’s sites, and saves what’s typed as sites', async () => {
    await render();
    expect(card()!.textContent).toContain('AcmeNone yet');
    expect(card()!.textContent).toContain('Brewlinesca.coffee');
    await act(async () => button('Edit')!.click());
    type('https://www.NCAusa.org/guide\nsca.coffee, ncausa.org');
    expect(card()!.textContent).toContain('2 sites');
    await act(async () => button('Save')!.click());
    expect(setBrandTrustedSources).toHaveBeenCalledWith('b1', ['ncausa.org', 'sca.coffee']);
    expect(toast.success).toHaveBeenCalledWith('Trusted sources saved');
    expect(card()!.textContent).toContain('Acmencausa.orgsca.coffee');
  });

  it('names what isn’t a site, and saves nothing until it’s fixed', async () => {
    await render();
    await act(async () => button('Edit')!.click());
    type('sca.coffee\nnot a site');
    expect(card()!.querySelector('[role="alert"]')!.textContent).toBe(
      "This isn't a site: not a site",
    );
    expect(button('Save')!.disabled).toBe(true);
  });

  it('says why a save didn’t go, and keeps what’s typed', async () => {
    setBrandTrustedSources.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await render();
    await act(async () => button('Edit')!.click());
    type('sca.coffee');
    await act(async () => button('Save')!.click());
    expect(toast.error).toHaveBeenCalledWith(
      "Trusted sources aren't available yet. Try again later.",
    );
    expect(textarea().value).toBe('sca.coffee');
  });

  it('opens the upgrade dialog on a read-only workspace, and shows no Edit to members', async () => {
    await render(true);
    await act(async () => button('Edit')!.click());
    expect(openUpgrade).toHaveBeenCalled();
    expect(textarea()).toBeNull();

    getContentSettings.mockResolvedValue({
      ...(await getContentSettings()),
      canManage: false,
    });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(button('Edit')).toBeUndefined();
  });

  it('shows nothing before 00449', async () => {
    getContentSettings.mockResolvedValue({
      brands: [{ id: 'b1', name: 'Acme', qualityHandoff: false, trustedSources: [] }],
      canManage: true,
      trustedSourcesOn: false,
    });
    await render();
    expect(card()).toBeNull();
  });
});
