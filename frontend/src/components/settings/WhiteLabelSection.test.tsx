import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { WhiteLabelSettingsView } from '@/lib/actions/whiteLabel';

/**
 * Settings › White label: locked with the way to Growth on Starter, an
 * admin's kit with a preview, read-only for everyone else, and Save opening
 * the upgrade dialog on a read-only workspace.
 */

const actions = vi.hoisted(() => ({
  getWhiteLabelSettings: vi.fn(),
  prepareWhiteLabelLogoUpload: vi.fn(),
  saveWhiteLabelKit: vi.fn(),
  setWhiteLabelLogo: vi.fn(),
}));
vi.mock('@/lib/actions/whiteLabel', () => actions);
const uploadLogo = vi.hoisted(() => vi.fn());
vi.mock('@/lib/white-label/logoUpload', () => ({ uploadLogo }));
const forgetExportBranding = vi.hoisted(() => vi.fn());
vi.mock('@/lib/white-label/exportName', () => ({ forgetExportBranding }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { WhiteLabelSection } = await import('./WhiteLabelSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const view = (over: Partial<WhiteLabelSettingsView> = {}): WhiteLabelSettingsView => ({
  available: true,
  requiredPlan: 'growth',
  canEdit: true,
  inUse: true,
  companyName: 'Acme Agency',
  accentColor: '#1d4ed8',
  footerText: 'acme.com',
  logoUrl: null,
  updatedAt: '2026-10-31T09:00:00Z',
  updatedByName: 'Ada Admin',
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  actions.getWhiteLabelSettings.mockResolvedValue({ ok: true, view: view() });
  actions.saveWhiteLabelKit.mockResolvedValue({ ok: true });
  actions.setWhiteLabelLogo.mockResolvedValue({ ok: true });
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
          <WhiteLabelSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text);

async function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('WhiteLabelSection', () => {
  it('is locked on Starter, with the way to Growth for an admin', async () => {
    actions.getWhiteLabelSettings.mockResolvedValue({
      ok: true,
      view: view({ available: false, inUse: false }),
    });
    await render();
    expect(container.textContent).toContain('White label comes with the Growth plan');
    const upgrade = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Upgrade');
    expect(upgrade?.getAttribute('href')).toBe('/dashboard/settings/billing');
    expect(container.querySelector('#white-label-company')).toBeNull();
  });

  it('asks a member to turn to an admin when it is locked', async () => {
    actions.getWhiteLabelSettings.mockResolvedValue({
      ok: true,
      view: view({ available: false, canEdit: false }),
    });
    await render();
    expect(container.textContent).toContain('Ask an admin of your workspace to upgrade the plan.');
    expect(container.querySelector('a')).toBeNull();
  });

  it('shows the kit, who changed it, and a preview with its footer', async () => {
    await render();
    expect(container.querySelector<HTMLInputElement>('#white-label-company')!.value).toBe(
      'Acme Agency',
    );
    expect(container.textContent).toContain('The kit is in use.');
    expect(container.textContent).toContain('Last changed Oct 31, 2026 by Ada Admin');
    expect(container.textContent).toContain('Prepared for Your client');
    expect(container.textContent).toContain('acme.com');
  });

  it('saves an admin’s changes', async () => {
    await render();
    await type('#white-label-company', 'Acme Partners');
    await act(async () => button('Save changes')!.click());
    expect(actions.saveWhiteLabelKit).toHaveBeenCalledWith({
      companyName: 'Acme Partners',
      accentColor: '#1d4ed8',
      footerText: 'acme.com',
    });
    expect(toast.success).toHaveBeenCalledWith('White label saved.');
    // Downloads are named after the kit: read again on the next one.
    expect(forgetExportBranding).toHaveBeenCalled();
  });

  it('says a color it can’t read, and warns when a light one is darkened for text', async () => {
    await render();
    await type('#white-label-color', 'blue');
    expect(container.textContent).toContain('Use a hex color, such as #1d4ed8.');
    expect(button('Save changes')!.disabled).toBe(true);
    await type('#white-label-color', '#ffff00');
    expect(container.textContent).toContain('text set in it is darkened');
    expect(button('Save changes')!.disabled).toBe(false);
  });

  it('opens the upgrade dialog instead of saving on a read-only workspace', async () => {
    await render(true);
    await type('#white-label-company', 'Acme Partners');
    await act(async () => button('Save changes')!.click());
    expect(openUpgrade).toHaveBeenCalledWith('Changing the white label needs a plan');
    expect(actions.saveWhiteLabelKit).not.toHaveBeenCalled();
  });

  it('shows the kit to everyone else without a way to change it', async () => {
    actions.getWhiteLabelSettings.mockResolvedValue({ ok: true, view: view({ canEdit: false }) });
    await render();
    expect(container.querySelector<HTMLInputElement>('#white-label-company')!.disabled).toBe(true);
    expect(button('Save changes')).toBeUndefined();
    expect(button('Upload logo')).toBeUndefined();
    expect(container.textContent).toContain('Only admins change the white label kit.');
  });

  it('keeps the name, color and footer typed but not saved when a logo goes up or is removed', async () => {
    const signed = 'https://store.example/sign/org/kit/id.png';
    uploadLogo.mockResolvedValueOnce({ ok: true, path: 'org/kit/id.png' });
    await render();
    await type('#white-label-company', 'Acme Partners');
    await type('#white-label-color', '#0f766e');
    await type('#white-label-footer', 'acmepartners.com');
    // The server now has the logo, and still the saved words.
    actions.getWhiteLabelSettings.mockResolvedValue({ ok: true, view: view({ logoUrl: signed }) });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));

    const field = (id: string) => container.querySelector<HTMLInputElement>(id)!.value;
    expect(actions.setWhiteLabelLogo).toHaveBeenCalledWith('org/kit/id.png');
    expect(container.querySelector('[data-testid="logo-paper"] img')?.getAttribute('src')).toBe(
      signed,
    );
    expect(field('#white-label-company')).toBe('Acme Partners');
    expect(field('#white-label-color')).toBe('#0f766e');
    expect(field('#white-label-footer')).toBe('acmepartners.com');
    expect(button('Save changes')!.disabled).toBe(false);

    await act(async () => button('Remove')!.click());
    expect(actions.setWhiteLabelLogo).toHaveBeenLastCalledWith(null);
    expect(field('#white-label-company')).toBe('Acme Partners');

    // Saving them still takes what was typed.
    await act(async () => button('Save changes')!.click());
    expect(actions.saveWhiteLabelKit).toHaveBeenCalledWith({
      companyName: 'Acme Partners',
      accentColor: '#0f766e',
      footerText: 'acmepartners.com',
    });
  });

  it('shows the logo on white paper in both themes, as the report it goes on', async () => {
    await render();
    const paper = container.querySelector('[data-testid="logo-paper"]')!;
    expect(paper.className).toContain('bg-white');
    expect(paper.className).not.toMatch(/\bbg-muted|dark:/);
  });

  it('uploads a picked logo, sets it, and says why one didn’t go', async () => {
    uploadLogo.mockResolvedValueOnce({ ok: true, path: 'org/kit/id.png' });
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(actions.setWhiteLabelLogo).toHaveBeenCalledWith('org/kit/id.png');
    expect(toast.success).toHaveBeenCalledWith('Logo saved.');

    uploadLogo.mockResolvedValueOnce({ ok: false, error: 'size' });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(toast.error).toHaveBeenCalledWith('That logo is over 1 MB. Use a smaller one.');
  });

  it('says it couldn’t load, with a retry', async () => {
    actions.getWhiteLabelSettings.mockResolvedValue({ ok: false, failure: 'failed' });
    await render();
    expect(container.textContent).toContain("Couldn't load the white label settings.");
  });
});
