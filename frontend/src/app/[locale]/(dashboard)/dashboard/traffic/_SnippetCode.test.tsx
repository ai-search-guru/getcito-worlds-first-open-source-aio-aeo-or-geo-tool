import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/**
 * The tracking snippet's dialog (AT-001): the whole tag, wrapped in its box,
 * and a copy button; and its banner while the code isn't seen on the site,
 * with the steps and Check again (00433).
 */

vi.mock('@/config/api', () => ({ getPublicApiBaseUrl: () => 'https://api.example.com' }));
const checkTrackingSnippet = vi.fn();
vi.mock('@/lib/trafficSnippetClient', () => ({
  checkTrackingSnippet: (...a: unknown[]) => checkTrackingSnippet(...a),
}));

const { SnippetBanner, SnippetDialog } = await import('./_SnippetCode');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const writeText = vi.fn();

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockReset();
  checkTrackingSnippet.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('SnippetDialog', () => {
  it('shows the whole tag, wrapping in its box rather than widening the dialog, and copies it', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <SnippetDialog trackingCode="t_abc123" open onOpenChange={() => {}} />
        </NextIntlClientProvider>,
      );
    });
    const tag = '<script src="https://api.example.com/t.js" data-t="t_abc123" defer></script>';
    const pre = document.body.querySelector('pre')!;
    expect(pre.textContent).toBe(tag);
    // jsdom has no layout: what keeps it inside the dialog is the wrap and a
    // block that may shrink below the tag's width (a grid item otherwise can't).
    expect(pre.className).toContain('whitespace-pre-wrap');
    expect(pre.closest('.min-w-0')?.parentElement?.className).toContain('min-w-0');

    const copy = document.body.querySelector(
      'button[aria-label="Copy tracking script"]',
    ) as HTMLElement;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith(tag);
  });

  it('shows the tag with conversions for a brand that has them on (CE-017)', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <SnippetDialog trackingCode="t_abc123" conversions="wait" open onOpenChange={() => {}} />
        </NextIntlClientProvider>,
      );
    });
    expect(document.body.querySelector('pre')!.textContent).toMatch(
      /window\.getcito=window\.getcito\|\|[\s\S]*<script src="https:\/\/api\.example\.com\/t\.js" data-t="t_abc123" data-c="1" data-consent="wait" defer><\/script>$/,
    );
  });
});

describe('SnippetBanner', () => {
  const onFound = vi.fn();
  const renderBanner = async (check?: {
    domain?: string;
    checkedAt?: string | null;
    busy?: boolean;
  }) => {
    onFound.mockReset();
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <SnippetBanner
            trackingCode="t_abc123"
            check={
              check
                ? {
                    brandId: 'b1',
                    domain: check.domain,
                    checkedAt: check.checkedAt ?? null,
                    busy: check.busy,
                    onFound,
                  }
                : undefined
            }
          />
        </NextIntlClientProvider>,
      );
    });
  };
  const button = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Check again')!;
  const status = () => container.querySelector('[role="status"]')?.textContent ?? null;

  it('says the code isn’t on the domain, how to add it, and checks again', async () => {
    await renderBanner({ domain: 'getcito.com' });
    expect(container.textContent).toContain('Tracking code not detected on getcito.com');
    expect([...container.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual([
      'Copy the snippet below.',
      'Paste it before the closing </head> tag on every page, your 404 page included.',
      'Publish the change, then click Check again.',
    ]);
    checkTrackingSnippet.mockResolvedValue({
      ok: true,
      status: 'found',
      domain: 'getcito.com',
      checkedAt: new Date().toISOString(),
    });
    await act(async () => button().click());
    expect(checkTrackingSnippet).toHaveBeenCalledWith('b1');
    expect(onFound).toHaveBeenCalledTimes(1);
  });

  it('says what the check saw when it didn’t find it, or couldn’t read the page', async () => {
    await renderBanner({ domain: 'getcito.com' });
    checkTrackingSnippet.mockResolvedValue({
      ok: true,
      status: 'not_found',
      domain: 'getcito.com',
      checkedAt: new Date().toISOString(),
    });
    await act(async () => button().click());
    expect(status()).toBe("Not found on getcito.com's home page yet.");
    checkTrackingSnippet.mockResolvedValue({
      ok: true,
      status: 'unreachable',
      domain: 'getcito.com',
      checkedAt: null,
    });
    await act(async () => button().click());
    expect(status()).toBe("Couldn't read getcito.com's home page. Try again in a few minutes.");
    checkTrackingSnippet.mockResolvedValue({ ok: false });
    await act(async () => button().click());
    expect(status()).toBe("The check didn't run. Try again.");
    expect(onFound).not.toHaveBeenCalled();
  });

  it('waits while the page’s first check runs, then says when it checked', async () => {
    await renderBanner({ domain: 'getcito.com', busy: true });
    const waiting = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Checking…',
    );
    expect(waiting?.disabled).toBe(true);
    expect(status()).toBeNull();

    await renderBanner({ domain: 'getcito.com', checkedAt: new Date().toISOString() });
    expect(button().disabled).toBe(false);
    expect(status()).toMatch(/^Last checked /);
  });

  it('asks for a domain before a brand without one can be checked', async () => {
    await renderBanner({});
    expect(container.textContent).toContain('Tracking code not detected');
    expect(button().disabled).toBe(true);
    expect(status()).toBe("Add your website's domain in the brand's settings to check it.");
  });

  it('keeps the plain title, with no check, when the state couldn’t be read', async () => {
    await renderBanner();
    expect(container.textContent).toContain('Add this snippet to your website');
    expect(container.querySelector('ol')).toBeNull();
    expect(container.textContent).not.toContain('Check again');
  });
});
