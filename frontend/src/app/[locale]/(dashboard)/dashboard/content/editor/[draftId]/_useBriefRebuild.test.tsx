import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentDraft } from '@/lib/content/drafts';
import type { DraftSourceChoice, DraftSourcesData } from '@/lib/content/sources';
import { toast } from 'sonner';
import { useBriefRebuild } from './_useBriefRebuild';
import type { SourcesRead } from './_useDraftReads';

/**
 * Rebuild outline (CE-007): from the sources in hand, or read afresh once
 * prompts were added — and that fresh read becomes the editor's, so the
 * Sources tab doesn't read them again.
 */

const addDraftPrompts = vi.fn();
const getDraftSources = vi.fn();
const rebuildDraftBrief = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  addDraftPrompts: (...args: unknown[]) => addDraftPrompts(...args),
  getDraftSources: (...args: unknown[]) => getDraftSources(...args),
  rebuildDraftBrief: (...args: unknown[]) => rebuildDraftBrief(...args),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SOURCES: { data: DraftSourcesData; choices: DraftSourceChoice[] } = {
  data: {
    prompts: [],
    fanouts: [{ query: 'espresso ratio', platforms: ['copilot-web'], searched: 3 }],
    citedPages: [],
    gscQueries: [],
    brandDomains: [],
    competitorDomains: [],
  },
  choices: [],
};
const draft = { id: 'd1', brandId: 'b1', sourceUrl: null } as unknown as ContentDraft;
const onSourcesRead = vi.fn();
const onRebuilt = vi.fn();
let inHand: SourcesRead | null;
let rulesNow: { key: string; name: string; detail: string }[] | undefined;

/** Whether the hook said the brief was the server's, each time it rendered. */
let serverSeen: boolean[] = [];

/** The hook behind buttons, as the side panel drives it. */
function Harness() {
  const { onServer, rebuild } = useBriefRebuild({
    draft,
    pageNow: () => ({ title: 'T', html: '<h1>T</h1>', length: 3000, rules: rulesNow }),
    sourcesNow: () => inHand,
    onSourcesRead,
    onRebuilt,
  });
  serverSeen.push(onServer);
  return (
    <>
      <button data-rebuild onClick={() => void rebuild()} />
      <button data-lost onClick={() => void rebuild({ addPrompts: ['p1'] })} />
    </>
  );
}

const press = (name: 'rebuild' | 'lost') =>
  act(async () => container.querySelector<HTMLButtonElement>(`[data-${name}]`)!.click());

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  for (const fn of [addDraftPrompts, getDraftSources, rebuildDraftBrief, onSourcesRead, onRebuilt])
    fn.mockReset();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  addDraftPrompts.mockResolvedValue(undefined);
  getDraftSources.mockResolvedValue(SOURCES);
  rebuildDraftBrief.mockResolvedValue({ brief: { builtFrom: null } });
  inHand = { ...SOURCES, failed: false };
  rulesNow = undefined;
  serverSeen = [];
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Harness />
      </NextIntlClientProvider>,
    ),
  );
});

afterEach(() => act(() => root.unmount()));

describe('useBriefRebuild', () => {
  it('says the brief is the server’s only once its write starts, not while prompts and sources go', async () => {
    let release: (value: unknown) => void = () => {};
    addDraftPrompts.mockImplementation(async () => {
      expect(serverSeen.at(-1)).toBe(false);
    });
    getDraftSources.mockImplementation(async () => {
      expect(serverSeen.at(-1)).toBe(false);
      return SOURCES;
    });
    rebuildDraftBrief.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ brief: { builtFrom: null } }))),
    );
    await press('lost');
    expect(addDraftPrompts).toHaveBeenCalled();
    expect(getDraftSources).toHaveBeenCalled();
    expect(serverSeen.at(-1)).toBe(true);
    await act(async () => release(null));
    expect(serverSeen.at(-1)).toBe(false);
    expect(onRebuilt).toHaveBeenCalled();
  });

  it('builds from the sources in hand, reading nothing', async () => {
    await press('rebuild');
    expect(getDraftSources).not.toHaveBeenCalled();
    expect(onSourcesRead).not.toHaveBeenCalled();
    expect(onRebuilt).toHaveBeenCalled();
  });

  it('sends the rules in effect beside the sources, so the brief plans to them', async () => {
    rulesNow = [{ key: 'h2Answer', name: 'Answer under each H2', detail: 'aim: 60 words' }];
    await press('rebuild');
    const [, , sources, rules] = rebuildDraftBrief.mock.calls[0];
    expect(sources).toMatchObject({ length: 3000 });
    expect(sources).not.toHaveProperty('rules');
    expect(rules).toEqual(rulesNow);
  });

  it('reads the sources once after adding prompts, and hands that read to the editor', async () => {
    await press('lost');
    expect(addDraftPrompts).toHaveBeenCalledWith('d1', ['p1']);
    expect(getDraftSources).toHaveBeenCalledTimes(1);
    expect(onSourcesRead).toHaveBeenCalledWith({ ...SOURCES, failed: false });
  });

  it('says the fresh read failed, so the Sources tab can try again', async () => {
    getDraftSources.mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await press('lost');
    expect(onSourcesRead).toHaveBeenCalledWith({ data: null, choices: [], failed: true });
    expect(rebuildDraftBrief).not.toHaveBeenCalled();
  });

  it('says a rebuild stopped from the agent card changed nothing, not that it failed', async () => {
    rebuildDraftBrief.mockResolvedValue({ error: 'stopped' });
    await press('rebuild');
    expect(toast).toHaveBeenCalledWith('Stopped · nothing was changed');
    expect(toast.error).not.toHaveBeenCalled();
    expect(onRebuilt).not.toHaveBeenCalled();
  });
});
