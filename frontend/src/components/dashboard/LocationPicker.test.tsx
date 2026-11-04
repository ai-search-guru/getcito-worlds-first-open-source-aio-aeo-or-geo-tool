import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The location picker, on the engines' countries (PROMPT-015e). */

const getTrackingCountries = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/trackingCountries', () => ({ getTrackingCountries }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetModules();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function open() {
  const { LocationPicker } = await import('./LocationPicker');
  await act(async () => {
    root.render(<LocationPicker value={[]} onChange={() => {}} maxSelectable={null} allowEmpty />);
  });
  const trigger = container.querySelector('button') as HTMLButtonElement;
  await act(async () => trigger.click());
  return document.body.textContent ?? '';
}

describe('LocationPicker', () => {
  it('offers the countries the engines answer from, says which engines miss one, and cities only where Google answers', async () => {
    getTrackingCountries.mockResolvedValue([
      { code: 'US', models: ['chatgpt', 'copilot', 'aimode'] },
      { code: 'TR', models: ['chatgpt', 'copilot', 'aimode'] },
      { code: 'BO', models: ['chatgpt', 'aimode'] },
      { code: 'DE', models: ['chatgpt', 'copilot'] },
    ]);
    const text = await open();
    expect(text).toContain('Bolivia');
    expect(text).toContain('Country · not on Copilot');
    // No Google engine in Germany: its cities aren't offered; Türkiye's are.
    expect(text).toContain('İstanbul');
    expect(text).not.toContain('Berlin');
    // A brand region no engine answers from isn't offered.
    expect(text).not.toContain('Japan');
  });

  it("falls back to its own list when the engines' countries were never read", async () => {
    getTrackingCountries.mockResolvedValue([]);
    const text = await open();
    expect(text).toContain('Japan');
    expect(text).toContain('Berlin');
  });
});
