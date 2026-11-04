import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import type { FirstRun } from '@/hooks/useFirstRun';
import { FirstRunEmptyState } from './FirstRunEmptyState';

/**
 * What an empty page, a 0 or a Getting started step's card says while the
 * brand's first run goes on: as much of the run as is known.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function text(run: Partial<FirstRun>) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <FirstRunEmptyState
          run={{ brandId: 'b1', queued: false, progress: null, left: null, ...run }}
        />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent;
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

describe('FirstRunEmptyState', () => {
  it('says how far the run is and about how long is left', async () => {
    expect(await text({ progress: { current: 18, total: 40 }, left: { minutes: 6 } })).toBe(
      'Your first answers are arriving (18 of 40) · ~6 min. This fills in when tracking finishes.',
    );
    expect(await text({ progress: { current: 5, total: 400 }, left: { hours: 2 } })).toBe(
      'Your first answers are arriving (5 of 400) · ~2 hours. This fills in when tracking finishes.',
    );
  });

  it('says only what it knows: no count without the job, no time before the pace shows', async () => {
    expect(await text({})).toBe(
      'Your first answers are arriving. This fills in when tracking finishes.',
    );
    expect(await text({ progress: { current: 2, total: 40 } })).toBe(
      'Your first answers are arriving (2 of 40). This fills in when tracking finishes.',
    );
  });

  it('says when it waits for a slot', async () => {
    expect(await text({ queued: true })).toBe(
      'Your first tracking starts as soon as a slot opens. This fills in when tracking finishes.',
    );
  });
});
