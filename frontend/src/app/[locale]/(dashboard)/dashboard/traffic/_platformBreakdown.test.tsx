import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { PlatformBreakdownChart } from './_charts';

/**
 * #1283: the Platform Breakdown card lists ChatGPT Shopping under ChatGPT,
 * as a part of ChatGPT's share rather than a platform of its own.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
// jsdom has no layout: the pie's container measures 0 wide and draws nothing.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the platform breakdown', () => {
  it("lists a platform's surface under it, as part of its share", () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <PlatformBreakdownChart
            data={[
              {
                platform: 'chatgpt.com',
                visits: 30,
                surfaces: [{ surface: 'shopping', visits: 6 }],
              },
              { platform: 'claude.ai', visits: 10, surfaces: [] },
            ]}
          />
        </NextIntlClientProvider>,
      );
    });
    // Shares of all visits: ChatGPT's 75% includes its Shopping 15%.
    expect(container.textContent).toBe('ChatGPT75%Shopping15%Claude25%');
    expect(container.querySelector('[title]')?.getAttribute('title')).toContain(
      "part of ChatGPT's visits",
    );
  });
});
