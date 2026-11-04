import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { DEFAULT_MENTIONS_FILTERS } from '@/lib/mentionsFilters';
import { MentionsFilterBar } from './_FilterBar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function render(searchPlaceholder?: string) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <MentionsFilterBar
          filters={DEFAULT_MENTIONS_FILTERS}
          onChange={vi.fn()}
          regions={[]}
          topics={[]}
          searchPlaceholder={searchPlaceholder}
        />
      </NextIntlClientProvider>,
    );
  });
}

const search = () => container.querySelector<HTMLInputElement>('#mentions-search')!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('MentionsFilterBar', () => {
  it('searches prompts by default, and words the search as a tab asks', () => {
    render();
    expect(search().placeholder).toBe('Search prompts…');
    // The Perception tab words it as keywords; it still matches the prompts' text.
    render(messages.mentions.filters.searchPlaceholderPerception);
    expect(search().placeholder).toBe('Search keywords…');
  });
});
