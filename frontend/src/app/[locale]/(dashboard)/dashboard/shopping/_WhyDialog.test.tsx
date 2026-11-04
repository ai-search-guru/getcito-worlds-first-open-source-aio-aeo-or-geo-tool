import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/** "Why GetCito Product Visibility?" (ECOM-010). */

const connect = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useIntegrationConnect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect }),
}));

const { WhyDialog } = await import('./_WhyDialog');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  connect.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(offerGa: boolean, onOpenChange = vi.fn()) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WhyDialog open onOpenChange={onOpenChange} offerGa={offerGa} onConnected={() => {}} />
      </NextIntlClientProvider>,
    );
  });
  return onOpenChange;
}

const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

describe('WhyDialog', () => {
  it('tells the shelf-to-cart story in four steps, in order', async () => {
    await render(false);
    const steps = [...document.body.querySelectorAll('ol li')].map(
      (li) => li.querySelector('p')?.textContent,
    );
    expect(steps).toEqual([
      'See your AI shelf',
      'Know why you lost',
      'Fix it, then push',
      'See what it sells',
    ]);
    expect(document.body.textContent).toContain('From AI shelf to cart');
    expect(document.body.textContent).toContain(
      "Most tools tell you if you're visible. GetCito shows why, fixes it and shows the sales.",
    );
  });

  it('offers Connect Google Analytics only when asked, and closes on Got it', async () => {
    const onOpenChange = await render(false);
    expect(button('Connect Google Analytics')).toBeUndefined();
    await act(async () => button('Got it')!.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await render(true);
    await act(async () => button('Connect Google Analytics')!.click());
    expect(connect).toHaveBeenCalledOnce();
  });
});
