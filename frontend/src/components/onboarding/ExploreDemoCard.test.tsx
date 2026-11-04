import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/** Onboarding's plan step: the demo brand, for someone not ready to add a card. */

const explore = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ opening: false }));
const preload = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useExploreDemo', () => ({
  useExploreDemo: () => ({
    explore,
    opening: state.opening,
    setupDialog: { setup: null, onRetry: explore, onClose: () => {} },
  }),
  usePreloadDemo: preload,
}));

const { ExploreDemoCard } = await import('./ExploreDemoCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render(brandName: string | null, withPreload = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ExploreDemoCard brandName={brandName} preload={withPreload} />
      </NextIntlClientProvider>,
    );
  });
}
const button = () => container.querySelector('button')!;

beforeEach(() => {
  vi.clearAllMocks();
  state.opening = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ExploreDemoCard', () => {
  it('offers the demo, no card needed, keeping the brand set up', async () => {
    await render('Acme');
    expect(container.querySelector('h3')?.textContent).toBe(
      'Not ready to add a card? Explore a demo brand',
    );
    expect(container.textContent).toContain(
      'See GetCito with sample data: prompts, AI answers, content and reports. No card needed. Acme stays saved, and tracking starts when you pick a plan.',
    );
    expect(button().textContent).toBe('Explore the demo');
    await act(async () => button().click());
    expect(explore).toHaveBeenCalledTimes(1);
  });

  it('says "Your brand" when the brand has no name yet', async () => {
    await render(null);
    expect(container.textContent).toContain('Your brand stays saved');
  });

  it('says the demo is being set up while it opens', async () => {
    state.opening = true;
    await render('Acme');
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('Setting up the demo…');
  });

  it('starts the setup ahead only when asked', async () => {
    await render('Acme', true);
    expect(preload).toHaveBeenLastCalledWith(true);
    await render('Acme', false);
    expect(preload).toHaveBeenLastCalledWith(false);
  });
});
