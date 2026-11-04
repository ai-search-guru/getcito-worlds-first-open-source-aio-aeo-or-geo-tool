import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { DemoSetupDialog, type DemoSetupState } from './DemoSetupDialog';

/**
 * The demo's setup screen: what the server writes, step by step, the step
 * under way moving and counting up, a failure with Try again.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
let reduced = false;

beforeEach(() => {
  reduced = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') && reduced,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const handlers = { onRetry: vi.fn(), onClose: vi.fn() };

async function show(setup: DemoSetupState | null) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DemoSetupDialog setup={setup} {...handlers} />
      </NextIntlClientProvider>,
    ),
  );
}

const row = (key: string) => document.body.querySelector<HTMLElement>(`[data-step="${key}"]`)!;
const count = (key: string) => row(key).querySelector('[data-slot="count"]')?.textContent ?? null;
const asked = (ago: number): DemoSetupState => ({
  startedAt: Date.now() - ago,
  answeredAt: null,
  failed: false,
});

describe('DemoSetupDialog', () => {
  it('names what is prepared, with the counts the sample data has', async () => {
    // Half way through the citations.
    await show(asked(1200 + 3000 + 750));
    expect(document.body.textContent).toContain('Preparing your demo');
    expect(row('brand').textContent).toContain('Setting up Brewline Coffee');
    expect(row('answers').textContent).toContain('Preparing sample AI answers from 6 platforms');
    expect(row('answers').dataset.state).toBe('done');
    expect(count('answers')).toBe('720');
    expect(row('citations').dataset.state).toBe('now');
    expect(row('citations').getAttribute('aria-current')).toBe('step');
    const citations = Number(count('citations')!.replace(/,/g, ''));
    expect(citations).toBeGreaterThan(1000);
    expect(citations).toBeLessThan(2694);
    // Still to come: no count yet.
    expect(row('audit').dataset.state).toBe('next');
    expect(count('audit')).toBeNull();
    expect(document.body.textContent).toContain('This takes a few seconds the first time.');
  });

  it('shows the whole count at once with reduced motion', async () => {
    reduced = true;
    await show(asked(1200 + 3000 + 750));
    expect(count('citations')).toBe('2,694');
  });

  it('holds on the last step when it takes long, and says so', async () => {
    await show(asked(40_000));
    expect(row('reports').dataset.state).toBe('now');
    expect(document.body.textContent).toContain('This is taking longer than usual.');
  });

  it('shows everything done once the answer came and the rest ran through', async () => {
    const startedAt = Date.now() - 10_000;
    await show({ startedAt, answeredAt: startedAt + 1000, failed: false });
    for (const key of ['brand', 'answers', 'reports']) expect(row(key).dataset.state).toBe('done');
    expect(count('reports')).toBe('2');
    expect(document.body.textContent).toContain('Ready. Opening the Action Center…');
  });

  it('says a failure, with Try again and Close', async () => {
    await show({ ...asked(5000), failed: true });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't prepare the demo. Check your connection and try again.",
    );
    const button = (label: string) =>
      [...document.body.querySelectorAll('button')].find((b) => b.textContent === label)!;
    await act(async () => button('Try again').click());
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
    await act(async () => button('Close').click());
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it('shows nothing without a setup', async () => {
    await show(null);
    expect(document.body.querySelector('[data-step]')).toBeNull();
  });
});
