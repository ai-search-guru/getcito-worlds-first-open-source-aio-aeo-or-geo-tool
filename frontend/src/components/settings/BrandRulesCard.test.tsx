import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const getContentSettings = vi.fn();
const setBrandRules = vi.fn();
vi.mock('@/lib/actions/contentSettings', () => ({
  getContentSettings: (...args: unknown[]) => getContentSettings(...args),
  setBrandQualityHandoff: vi.fn(),
  setBrandTrustedSources: vi.fn(),
  setBrandRules: (...args: unknown[]) => setBrandRules(...args),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ContentSection } = await import('./ContentSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Settings › Content › Brand rules (customer priorities item 8, 00450): each
 * brand's rules in its own words, one per line.
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
const card = () => container.querySelector('[data-slot="brand-rules"]');
const RULE = 'No topics comparing us with a named competitor.';
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
      { id: 'b1', name: 'Acme', qualityHandoff: false, trustedSources: [], brandRules: [] },
      { id: 'b2', name: 'Brewline', qualityHandoff: false, trustedSources: [], brandRules: [RULE] },
    ],
    canManage: true,
    trustedSourcesOn: false,
    brandRulesOn: true,
  });
  setBrandRules.mockReset().mockImplementation(async (_id: string, rules: string[]) => ({
    ok: true,
    rules,
  }));
  toast.error.mockReset();
  toast.success.mockReset();
  openUpgrade.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('BrandRulesCard', () => {
  it('lists each brand’s rules, and saves what’s typed, one rule per line', async () => {
    await render();
    expect(card()!.textContent).toContain('AcmeNone yet');
    expect(card()!.textContent).toContain(`Brewline${'Edit'}${RULE}`);
    await act(async () => button('Edit')!.click());
    type(`  Cite official sources for health claims.\n\n${RULE}\n${RULE}`);
    expect(card()!.textContent).toContain('2 rules');
    await act(async () => button('Save')!.click());
    expect(setBrandRules).toHaveBeenCalledWith('b1', [
      'Cite official sources for health claims.',
      RULE,
    ]);
    expect(toast.success).toHaveBeenCalledWith('Brand rules saved');
    expect(card()!.textContent).toContain('Cite official sources for health claims.');
  });

  it('names a line too long, and saves nothing until it’s shorter', async () => {
    await render();
    await act(async () => button('Edit')!.click());
    type(`${RULE}\n${'x'.repeat(301)}`);
    expect(card()!.querySelector('[role="alert"]')!.textContent).toBe(
      'Line 2 is longer than 300 characters.',
    );
    expect(button('Save')!.disabled).toBe(true);
  });

  it('says why a save didn’t go, and keeps what’s typed', async () => {
    setBrandRules.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await render();
    await act(async () => button('Edit')!.click());
    type(RULE);
    await act(async () => button('Save')!.click());
    expect(toast.error).toHaveBeenCalledWith("Brand rules aren't available yet. Try again later.");
    expect(textarea().value).toBe(RULE);
  });

  it('opens the upgrade dialog on a read-only workspace, and shows nothing before 00450', async () => {
    await render(true);
    await act(async () => button('Edit')!.click());
    expect(openUpgrade).toHaveBeenCalled();
    expect(textarea()).toBeNull();

    getContentSettings.mockResolvedValue({ ...(await getContentSettings()), brandRulesOn: false });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(card()).toBeNull();
  });
});
