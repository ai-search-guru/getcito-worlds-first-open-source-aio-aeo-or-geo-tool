import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { WebhookTestResult } from '@/lib/actions/content';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';

const getWebhookConfig = vi.hoisted(() => vi.fn());
const testWebhook = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/content', () => ({
  getWebhookConfig,
  saveWebhookConfig: vi.fn(),
  testWebhook,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { WebhookSettingsDialog } = await import('./_WebhookSettings');

/**
 * Test Webhook (#1568 review): the test is the brand's, and the dialog says
 * why it failed: who may test, too many tests, where a redirect points, or
 * the network error that kept the webhook out of reach.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render(role: TeamRole = 'manager') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <WebhookSettingsDialog open onOpenChange={vi.fn()} brandId="brand-1" />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const button = (name: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name)!;

/** Presses Test Webhook with the test answering `result`; what the dialog then says. */
async function runTest(result: WebhookTestResult) {
  testWebhook.mockResolvedValue(result);
  await render();
  await act(async () => button('Test Webhook').click());
  return dialog().textContent;
}

beforeEach(() => {
  getWebhookConfig.mockReset().mockResolvedValue({
    webhookUrl: 'https://hooks.example/abc',
    webhookSecret: 'shh',
    isActive: true,
    events: ['opportunity.sent'],
  });
  testWebhook.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WebhookSettingsDialog – Test Webhook', () => {
  it('tests the address and secret in the form for this brand', async () => {
    expect(await runTest({ success: true, status: 200 })).toContain(
      'Webhook responded successfully!',
    );
    expect(testWebhook).toHaveBeenCalledWith('brand-1', 'https://hooks.example/abc', 'shh');
  });

  it('shows a member the webhook, and why it can’t be changed or tested, before anything is pressed (#1605)', async () => {
    await render('analyst');
    expect(dialog().textContent).toContain(
      'Only admins and managers can change or test this webhook.',
    );
    expect(button('Test Webhook').disabled).toBe(true);
    expect(button('Save Webhook').disabled).toBe(true);
    expect((dialog().querySelector('#webhook-url') as HTMLInputElement).value).toBe(
      'https://hooks.example/abc',
    );
    expect((dialog().querySelector('#webhook-url') as HTMLInputElement).disabled).toBe(true);
    const toggle = dialog().querySelector('[role="switch"]')!;
    expect(toggle.hasAttribute('disabled')).toBe(true);
    // Dimmed, with the not-allowed cursor, as the disabled checkboxes beside it.
    expect(toggle.className).toContain('disabled:cursor-not-allowed');
    expect(toggle.className).toContain('disabled:opacity-50');

    await render('admin');
    expect(dialog().textContent).not.toContain('Only admins and managers can change');
    expect(button('Test Webhook').disabled).toBe(false);
  });

  it('says only admins and managers can test', async () => {
    expect(await runTest({ success: false, status: 0, failure: 'forbidden' })).toContain(
      'Only admins and managers can test the webhook.',
    );
  });

  it.each([
    ['busy', 'Too many requests. Wait a minute and try again.'],
    ['workspace', "This brand isn't in your workspace. Switch to one of your brands."],
    ['session', 'Your session expired. Sign in again.'],
  ] as const)('says why the API refused the test (%s)', async (failure, text) => {
    expect(await runTest({ success: false, status: 0, failure })).toContain(text);
  });

  it('names the address a redirect points to', async () => {
    expect(
      await runTest({ success: false, status: 308, location: 'https://hooks.example/v2' }),
    ).toContain(
      'The address redirects (HTTP 308) to https://hooks.example/v2. Nothing is sent on to it: use that address instead.',
    );
  });

  it('shows why the webhook couldn’t be reached, else its status', async () => {
    expect(
      await runTest({
        success: false,
        status: 0,
        error: 'The webhook could not be reached (ENOTFOUND)',
      }),
    ).toContain('The webhook could not be reached (ENOTFOUND)');
    expect(await runTest({ success: false, status: 500 })).toContain('HTTP 500');
  });
});
