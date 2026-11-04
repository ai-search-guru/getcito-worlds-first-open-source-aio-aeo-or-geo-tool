import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { AreaTooltip } from './_charts';

/**
 * AT-004: the trend's tooltip names a day whose visits came from Google
 * Analytics rather than the snippet.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

function render(label: string) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AreaTooltip
          active
          label={label}
          payload={[{ name: 'chatgpt.com', value: 5, color: '#6366f1' }]}
          analyticsDays={new Set(['2026-10-12'])}
        />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

describe('the trend tooltip', () => {
  it('says a day came from Google Analytics', () => {
    expect(render('2026-10-12')).toBe('Oct 12 · from Google AnalyticsChatGPT:5');
  });

  it('says nothing more for a day from the snippet', () => {
    expect(render('2026-10-13')).toBe('Oct 13ChatGPT:5');
  });
});
