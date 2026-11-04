import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { Brand } from '@/types';
import { ConversionsCard } from './_ConversionsCard';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const updateBrand = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/brand', () => ({
  updateBrand: (...args: unknown[]) => updateBrand(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
vi.mock('@/config/api', () => ({ getPublicApiBaseUrl: () => 'https://api.getcito.test' }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Brand settings › Tracking › Conversions from AI visits (CE-017): on or off
 * and the consent mode, saved at once; once on, what the site adds.
 */

const brand = (over: Partial<Brand> = {}): Brand => ({
  id: 'b1',
  organizationId: 'o1',
  name: 'Acme',
  slug: 'acme',
  trackingCode: 'abc123',
  shoppingModeEnabled: false,
  industry: 'Technology',
  isActive: true,
  domains: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onUpdate = vi.fn();
const openUpgrade = vi.fn();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  updateBrand.mockReset().mockResolvedValue({});
  onUpdate.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  role.canManage = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(over: Partial<Brand> = {}, isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ConversionsCard brand={brand(over)} onUpdate={onUpdate} />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const click = async (el: Element | undefined) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
};
const checkbox = () => container.querySelector<HTMLElement>('#conversions-on')!;
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
const codes = () => [...container.querySelectorAll('pre')].map((pre) => pre.textContent);

describe('ConversionsCard', () => {
  it('says what it does and shows nothing to install while it’s off', async () => {
    await render();
    expect(container.textContent).toContain('Track conversions from AI visits');
    expect(container.textContent).toContain(
      'Off, with the tag without them, the snippet keeps nothing',
    );
    expect(codes()).toEqual([]);
  });

  it('turns them on at once, then shows the tag with conversions and what the site adds', async () => {
    await render();
    await click(checkbox());
    expect(updateBrand).toHaveBeenCalledWith('b1', { conversionsEnabled: true });
    expect(onUpdate).toHaveBeenCalledWith({ conversionsEnabled: true });
    expect(toast.success).toHaveBeenCalledWith(
      'Conversions are on. Use the tag below on your site.',
    );
    expect(codes()).toEqual([
      // The queue stub and the tag, copied together: calls before it loads are kept.
      expect.stringMatching(
        /^<script>window\.getcito=window\.getcito\|\|.*<\/script>\n<script src="https:\/\/api\.getcito\.test\/t\.js" data-t="abc123" data-c="1" data-consent="wait" defer><\/script>$/,
      ),
      "getcito('consent', 'granted');",
      // And the refusal: an id kept earlier is taken as consent until it's called.
      "getcito('consent', 'denied');",
      "getcito('conversion', { type: 'demo' });",
      expect.stringContaining("type: 'order'"),
    ]);
    // The refusal under its own line, below the grant.
    expect(container.textContent).toContain('When the visitor agrees');
    expect(container.textContent).toContain('When the visitor refuses');
    // Each copy button says what it copies.
    expect(container.querySelector('button[aria-label="Copy the tag"]')).not.toBeNull();
    expect(container.textContent).toContain("What it can't see");
  });

  it('turns nothing on on a read-only workspace: the box opens the upgrade dialog', async () => {
    openUpgrade.mockReset();
    await render({}, true);
    await click(checkbox());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith(
      'Changing conversion tracking needs a plan',
    );
    expect(updateBrand).not.toHaveBeenCalled();
    expect(codes()).toEqual([]);
  });

  it('turns back what it couldn’t save, and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    updateBrand.mockRejectedValue(new Error('offline'));
    await render();
    await click(checkbox());
    expect(toast.error).toHaveBeenCalledWith("Couldn't save it. Try again.");
    expect(checkbox().getAttribute('aria-checked') ?? checkbox().dataset.checked).not.toBe('true');
    expect(codes()).toEqual([]);
  });

  it('saves the consent mode, and the tag and steps follow it', async () => {
    await render({ conversionsEnabled: true });
    const label = [...container.querySelectorAll('label')].find(
      (l) => l.textContent === 'Consent',
    )!;
    await click(container.querySelector(`[id="${label.htmlFor}"]`)!);
    const always = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === "Don't wait: our own banner covers it",
    )!;
    await act(async () => {
      always.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(always);
    expect(updateBrand).toHaveBeenCalledWith('b1', { conversionsConsent: 'always' });
    expect(codes()[0]).toContain('data-consent="always"');
    // Nothing to wait for: no grant, but a visitor who refuses still says so.
    expect(codes()).not.toContain("getcito('consent', 'granted');");
    expect(codes()).toContain("getcito('consent', 'denied');");
    expect(container.textContent).toContain('When the visitor refuses');
  });

  it('turns the consent mode back when it couldn’t save it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    updateBrand.mockRejectedValue(new Error('offline'));
    await render({ conversionsEnabled: true });
    const label = [...container.querySelectorAll('label')].find(
      (l) => l.textContent === 'Consent',
    )!;
    await click(container.querySelector(`[id="${label.htmlFor}"]`)!);
    const always = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === "Don't wait: our own banner covers it",
    )!;
    await act(async () => {
      always.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(always);
    expect(toast.error).toHaveBeenCalledWith("Couldn't save it. Try again.");
    expect(codes()[0]).toContain('data-consent="wait"');
  });

  it('shows what the brand says now, after another admin changed it', async () => {
    await render();
    expect(codes()).toEqual([]);
    await render({ conversionsEnabled: true, conversionsConsent: 'always' });
    expect(codes()[0]).toContain('data-consent="always"');
  });

  it('shows the Shopify pixel at once for a shop, with the consent script its banner needs', async () => {
    await render({ conversionsEnabled: true, siteType: 'ecommerce' });
    expect(codes().some((code) => code?.includes('checkout_completed'))).toBe(true);
    expect(codes().some((code) => code?.includes('visitorConsentCollected'))).toBe(true);

    // Another brand: a card of its own.
    act(() => root.unmount());
    root = createRoot(container);
    await render({ conversionsEnabled: true, siteType: 'b2b' });
    expect(codes().some((code) => code?.includes('checkout_completed'))).toBe(false);
    await click(button('Show the Shopify pixel'));
    expect(codes().some((code) => code?.includes('checkout_completed'))).toBe(true);
  });

  it('lets only admins and managers change it', async () => {
    role.canManage = false;
    await render({ conversionsEnabled: true });
    expect(container.textContent).toContain('Only admins and managers can change this.');
    await click(checkbox());
    expect(updateBrand).not.toHaveBeenCalled();
  });
});
