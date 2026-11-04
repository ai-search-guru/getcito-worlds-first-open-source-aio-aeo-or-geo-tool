import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { Brand } from '@/types';

/**
 * Brand settings › Client logo: Admins and Managers set the client's logo
 * on a plan with white label; others see it; Starter names Growth; a
 * the card isn't shown where white label isn't offered.
 */

const actions = vi.hoisted(() => ({
  getBrandClientLogo: vi.fn(),
  prepareBrandClientLogoUpload: vi.fn(),
  setBrandClientLogo: vi.fn(),
}));
vi.mock('@/lib/actions/whiteLabel', () => actions);
const uploadLogo = vi.hoisted(() => vi.fn());
vi.mock('@/lib/white-label/logoUpload', () => ({ uploadLogo }));
const plan = vi.hoisted(() => ({ isCloud: true }));
vi.mock('@/components/context/PlanProvider', () => ({ usePlanContext: () => plan }));
// Whether this install offers white label: the cloud and a self-host do today.
const offered = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/white-label/kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/white-label/kit')>()),
  whiteLabelOffered: () => offered.value,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ClientLogoCard } = await import('./_ClientLogoCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const brand = { id: 'brand-1', name: 'Northwind' } as Brand;
const signed = 'https://store.example/sign/logo.png';

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  plan.isCloud = true;
  offered.value = true;
  actions.getBrandClientLogo.mockResolvedValue({
    ok: true,
    view: { available: true, requiredPlan: 'growth', canEdit: true, logoUrl: null },
  });
  actions.setBrandClientLogo.mockResolvedValue({ ok: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ClientLogoCard brand={brand} />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text);

describe('ClientLogoCard', () => {
  it('names the brand the cover is prepared for', async () => {
    await render();
    expect(container.textContent).toContain(
      'Your client\'s logo for this brand\'s report cover, beside "Prepared for Northwind".',
    );
    expect(actions.getBrandClientLogo).toHaveBeenCalledWith('brand-1');
  });

  it('uploads a picked logo for the brand and sets it', async () => {
    uploadLogo.mockResolvedValueOnce({ ok: true, path: 'org/brands/brand-1/id.png' });
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'logo.png', { type: 'image/png' })],
      configurable: true,
    });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(actions.setBrandClientLogo).toHaveBeenCalledWith('brand-1', 'org/brands/brand-1/id.png');
    expect(toast.success).toHaveBeenCalledWith('Client logo saved.');
  });

  it('removes the logo', async () => {
    actions.getBrandClientLogo.mockResolvedValue({
      ok: true,
      view: { available: true, requiredPlan: 'growth', canEdit: true, logoUrl: signed },
    });
    await render();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(signed);
    await act(async () => button('Remove')!.click());
    expect(actions.setBrandClientLogo).toHaveBeenCalledWith('brand-1', null);
  });

  it('opens the upgrade dialog instead on a read-only workspace', async () => {
    actions.getBrandClientLogo.mockResolvedValue({
      ok: true,
      view: { available: true, requiredPlan: 'growth', canEdit: true, logoUrl: signed },
    });
    await render(true);
    await act(async () => button('Remove')!.click());
    expect(openUpgrade).toHaveBeenCalledWith('Changing the client logo needs a plan');
    expect(actions.setBrandClientLogo).not.toHaveBeenCalled();
  });

  it('shows an analyst the logo without a way to change it', async () => {
    actions.getBrandClientLogo.mockResolvedValue({
      ok: true,
      view: { available: true, requiredPlan: 'growth', canEdit: false, logoUrl: signed },
    });
    await render();
    expect(button('Replace')).toBeUndefined();
    expect(container.textContent).toContain('Only admins and managers change the client logo.');
  });

  it('names Growth on Starter', async () => {
    actions.getBrandClientLogo.mockResolvedValue({
      ok: true,
      view: { available: false, requiredPlan: 'growth', canEdit: true, logoUrl: null },
    });
    await render();
    expect(container.textContent).toContain(
      'Client logos come with white label, on the Growth plan.',
    );
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('shows its logo on white paper in both themes, as the report cover it goes on', async () => {
    await render();
    const paper = container.querySelector('[data-testid="logo-paper"]')!;
    expect(paper.className).toContain('bg-white');
    expect(paper.className).not.toMatch(/\bbg-muted|dark:/);
  });

  it('isn’t shown where white label isn’t offered', async () => {
    offered.value = false;
    await render();
    expect(container.textContent).toBe('');
    expect(actions.getBrandClientLogo).not.toHaveBeenCalled();
  });
});
