import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { DraftSourceChoice, DraftSourcesData } from '@/lib/content/sources';
import { SourcesTab } from './_SourcesTab';
import { useDraftReads } from './_useDraftReads';

const getDraftSources = vi.fn();
const setDraftSourceIncluded = vi.fn();
const addDraftSource = vi.fn();
const getContentStartOptions = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  getDraftSources: (...args: unknown[]) => getDraftSources(...args),
  getDraftBrief: async () => null,
  setDraftSourceIncluded: (...args: unknown[]) => setDraftSourceIncluded(...args),
  addDraftSource: (...args: unknown[]) => addDraftSource(...args),
  getContentStartOptions: (...args: unknown[]) => getContentStartOptions(...args),
}));
const onRebuild = vi.fn();
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = 'https://acme-coffee.example.com/guides/espresso';

const data = (over: Partial<DraftSourcesData> = {}): DraftSourcesData => ({
  prompts: [
    {
      id: 'p1',
      text: 'Best espresso machines under $500?',
      inDraft: true,
      citesPage: false,
      answers: 21,
      mentioned: 4,
    },
  ],
  fanouts: [{ query: 'home espresso grinder', platforms: ['perplexity-web'], searched: 3 }],
  citedPages: [
    {
      url: 'https://www.reddit.com/r/espresso/x',
      title: 'Thread',
      domain: 'reddit.com',
      citations: 12,
      answers: 9,
    },
  ],
  gscQueries: [
    { query: 'espresso machine under 500', clicks: 40, impressions: 900 },
    { query: 'coffee subscription', clicks: 12, impressions: 300 },
  ],
  brandDomains: ['acme-coffee.example.com'],
  competitorDomains: [],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render(
  bodyHtml = '<h1>The home espresso guide</h1>',
  choices: DraftSourceChoice[] = [],
  agentUsedAt: string | null = null,
) {
  getDraftSources.mockResolvedValue({ data: data(), choices });
  await act(async () => {
    root.render(<Tab bodyHtml={bodyHtml} agentUsedAt={agentUsedAt} />);
  });
}

/** The tab as the editor gives it its sources: one read, shared (useDraftReads). */
function Tab({ bodyHtml, agentUsedAt = null }: { bodyHtml: string; agentUsedAt?: string | null }) {
  const reads = useDraftReads('d1');
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <SourcesTab
        read={reads.sources}
        setRead={reads.setSources}
        onReload={reads.reloadSources}
        draftId="d1"
        brandId="b1"
        title="The home espresso guide"
        sourceUrl={PAGE}
        bodyHtml={bodyHtml}
        rebuilding={false}
        onRebuild={onRebuild}
        agentUsedAt={agentUsedAt}
      />
    </NextIntlClientProvider>
  );
}

const rows = () =>
  [...container.querySelectorAll('li')].map((li) => ({
    text: li.textContent,
    checked: li.querySelector('[role="checkbox"]')?.getAttribute('aria-checked'),
  }));
const checkbox = (name: string) =>
  container.querySelector<HTMLElement>(`[role="checkbox"][aria-label="Use ${name}"]`)!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getDraftSources.mockReset();
  setDraftSourceIncluded.mockReset().mockResolvedValue(undefined);
  addDraftSource.mockReset().mockResolvedValue(undefined);
  getContentStartOptions
    .mockReset()
    .mockResolvedValue({ opportunities: [], prompts: [], promptsSeen: 0, topics: [] });
  onRebuild.mockReset();
  toast.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Sources tab', () => {
  it('says when the Content Agent last wrote from them (v1.1 CE-034)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
    try {
      await render(undefined, [], null);
      expect(container.textContent).toContain('Not used by Content Agent yet');
      await render(undefined, [], '2026-10-23T09:58:00Z');
      expect(container.textContent).toContain('Last used by Content Agent · 2 minutes ago');
      await render(undefined, [], '2026-10-23T09:59:40Z');
      expect(container.textContent).toContain('Last used by Content Agent · just now');
    } finally {
      vi.useRealTimers();
    }
  });

  it('names every source with its numbers and where the draft uses it', async () => {
    await render(
      '<h1>The home espresso guide</h1><h2>Best espresso machines under $500</h2>' +
        '<p>Read <a href="https://reddit.com/r/espresso/x">the thread</a>.</p>',
    );

    expect(getDraftSources).toHaveBeenCalledWith('d1');
    expect(container.textContent).toContain('4 sources in use');
    expect(container.textContent).toContain(
      '1 prompt · 1 fan-out · 1 cited page · 1 Search Console query',
    );
    expect(rows()).toEqual([
      {
        text: "Best espresso machines under $500?21 answers · you're named in 4H2 · Best espresso machines under $500",
        checked: 'true',
      },
      { text: 'home espresso grinderPerplexity · searched 3×Not used', checked: 'true' },
      {
        text: 'https://www.reddit.com/r/espresso/x12 citations · forumOutbound link',
        checked: 'true',
      },
      {
        text: 'espresso machine under 50040 clicks · 900 impressionsH2 · Best espresso machines under $500',
        checked: 'true',
      },
    ]);
  });

  it('follows the page as it is written', async () => {
    await render();
    expect(rows()[1].text).toContain('Not used');
    await act(async () => {
      root.render(<Tab bodyHtml="<h1>Guide</h1><p>Buy a home espresso grinder first.</p>" />);
    });
    expect(rows()[1].text).toContain('Paragraph 1');
  });

  it('leaves a source out when it is unchecked, and keeps it in when that fails', async () => {
    await render();
    await act(async () => checkbox('home espresso grinder').click());
    expect(setDraftSourceIncluded).toHaveBeenCalledWith('d1', {
      kind: 'fanout',
      ref: 'home espresso grinder',
      included: false,
    });
    expect(rows()[1].checked).toBe('false');
    expect(container.textContent).toContain('3 sources in use');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    setDraftSourceIncluded.mockRejectedValueOnce(new Error('boom'));
    await act(async () => checkbox('home espresso grinder').click());
    expect(rows()[1].checked).toBe('false');
    expect(toast.error).toHaveBeenCalledWith("Couldn't change the source. Try again.");
  });

  it('rebuilds the brief from the sources as checked here', async () => {
    await render();
    await act(async () => checkbox('home espresso grinder').click());
    const rebuild = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Rebuild with selection',
    )!;
    await act(async () => rebuild.click());
    expect(onRebuild).toHaveBeenCalledWith({
      data: data(),
      choices: [{ kind: 'fanout', ref: 'home espresso grinder', included: false, added: false }],
    });
  });

  it('changes each row on its own, and puts back only the one that failed', async () => {
    await render();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail!: (err: Error) => void;
    setDraftSourceIncluded
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockResolvedValueOnce(undefined);
    // Two quick toggles: the second doesn't undo the first.
    await act(async () => {
      checkbox('home espresso grinder').click();
      checkbox('Best espresso machines under $500?').click();
    });
    expect(rows()[1].checked).toBe('false');
    expect(rows()[0].checked).toBe('false');

    // The first one fails: only its row goes back.
    await act(async () => fail(new Error('boom')));
    expect(rows()[1].checked).toBe('true');
    expect(rows()[0].checked).toBe('false');
  });

  it('lists a source left out unchecked', async () => {
    await render(undefined, [{ kind: 'prompt', ref: 'p1', included: false, added: false }]);
    expect(rows()[0].checked).toBe('false');
    expect(container.textContent).toContain('3 sources in use');
  });

  it('adds a page by its address and reads the sources again', async () => {
    await render();
    const addButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Add source',
    )!;
    await act(async () => addButton.click());
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (b) => b.textContent === 'Page URL',
    )!;
    await act(async () => {
      tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      tab.click();
    });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Page address"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'https://example.org/espresso-study');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add')!;
    await act(async () => submit.click());

    expect(addDraftSource).toHaveBeenCalledWith('d1', {
      kind: 'cited_page',
      url: 'https://example.org/espresso-study',
    });
    expect(toast.success).toHaveBeenCalledWith('Source added');
    expect(getDraftSources).toHaveBeenCalledTimes(2);
  });

  it('offers to retry when the sources can’t be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getDraftSources.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      root.render(<Tab bodyHtml="" />);
    });
    expect(container.textContent).toContain("Couldn't load the sources.");

    getDraftSources.mockResolvedValue({ data: data(), choices: [] });
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    await act(async () => retry.click());
    expect(container.textContent).toContain('4 sources in use');
  });

  it('says when there is nothing to list', async () => {
    getDraftSources.mockResolvedValue({
      data: data({ prompts: [], fanouts: [], citedPages: [], gscQueries: [] }),
      choices: [],
    });
    await act(async () => {
      root.render(<Tab bodyHtml="" />);
    });
    expect(container.textContent).toContain('No sources yet.');
  });
});
