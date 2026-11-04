import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import type { DraftCms } from '@/lib/content/cmsSendClient';
import { CmsSentChip } from './CmsSentChip';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(last: NonNullable<DraftCms['last']>) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CmsSentChip last={last} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const at = '2026-10-27T09:00:00Z';

/** The editor header's word on the page's last send (#1331). */
describe('CmsSentChip', () => {
  it('says a page sent to Webflow is a draft item there, and when, in its tip', async () => {
    await render({ status: 'sent', target: 'webflow', at, error: null });
    const chip = container.querySelector('span')!;
    expect(chip.textContent).toBe('In Webflow · draft');
    expect(chip.getAttribute('title')).toContain('In Webflow as a draft item since');
  });

  it('says a webhook send went, is going, or failed, with why', async () => {
    await render({ status: 'sent', target: 'webhook', at, error: null });
    expect(container.textContent).toBe('Sent to your CMS');
    await render({ status: 'queued', target: 'webflow', at, error: null });
    expect(container.textContent).toBe('Sending to Webflow…');
    await render({ status: 'failed', target: 'webhook', at, error: 'The webhook answered 500.' });
    expect(container.textContent).toBe('Send failed');
    expect(container.querySelector('span')!.getAttribute('title')).toContain(
      'The webhook answered 500.',
    );
  });

  it('says a page taken down is taken down, with when and where in its tip', async () => {
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC" onError={onError}>
          <CmsSentChip last={{ status: 'taken_down', target: 'webflow', at, error: null }} />
        </NextIntlClientProvider>,
      );
    });
    const chip = container.querySelector('span')!;
    expect(chip.textContent).toBe('Taken down');
    expect(chip.getAttribute('title')).toContain('a draft item in Webflow again');
    expect(chip.className).not.toContain('bg-blue-50');
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC" onError={onError}>
          <CmsSentChip last={{ status: 'taken_down', target: 'wordpress', at, error: null }} />
        </NextIntlClientProvider>,
      );
    });
    expect(container.textContent).toBe('Taken down');
    expect(errors).toEqual([]);
  });

  it('leaves a published page to its status', async () => {
    await render({ status: 'published', target: 'webflow', at, error: null });
    expect(container.textContent).toBe('');
  });
});
