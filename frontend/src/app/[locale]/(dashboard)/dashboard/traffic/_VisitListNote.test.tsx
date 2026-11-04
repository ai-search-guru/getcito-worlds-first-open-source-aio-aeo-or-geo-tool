import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { VisitListSourceNote } from './_VisitListNote';

/**
 * AT-004: when Google Analytics filled days of the range, the visit list
 * says it holds the snippet's visits only, so its count can be lower than
 * the KPI's.
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

function render(analyticsDays: number) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <VisitListSourceNote analyticsDays={analyticsDays} />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

describe('VisitListSourceNote', () => {
  it('says the list is the snippet’s when Google Analytics filled days', () => {
    expect(render(4)).toBe(
      "Google Analytics doesn't report single visits: this list shows the tracking snippet's, while the totals above also count 4 days from Google Analytics.",
    );
    expect(render(1)).toContain('also count 1 day from Google Analytics');
  });

  it('says nothing when every day came from the snippet', () => {
    expect(render(0)).toBe('');
  });
});
