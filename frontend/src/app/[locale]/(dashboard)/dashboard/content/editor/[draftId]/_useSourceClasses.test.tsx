import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const classifyDraftSources = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  classifyDraftSources: (...args: unknown[]) => classifyDraftSources(...args),
}));

const { SOURCE_CLASS_DELAY_MS, useSourceClasses } = await import('./_useSourceClasses');
const { MAX_SOURCE_SITES } = await import('@/lib/content/sourceClass');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The model's reads of sites the rules can't place (Quality CE-046, part
 * b): asked a few seconds after a save, each site once a save, each read
 * kept; a spent AI budget pauses the asks.
 */

let container: HTMLDivElement;
let root: Root;

function Probe({
  sites,
  savedAt,
  enabled,
}: {
  sites: string[];
  savedAt: string;
  enabled: boolean;
}) {
  const { kinds, paused, reading } = useSourceClasses('d1', savedAt, sites, enabled);
  return (
    <pre
      data-kinds={JSON.stringify([...kinds])}
      data-paused={String(paused)}
      data-reading={String(reading)}
    />
  );
}

const kinds = () =>
  new Map(JSON.parse(container.querySelector('pre')?.getAttribute('data-kinds') ?? '[]'));
const paused = () => container.querySelector('pre')?.getAttribute('data-paused') === 'true';
const render = (sites: string[], savedAt = 's1', enabled = true) =>
  act(async () => root.render(<Probe sites={sites} savedAt={savedAt} enabled={enabled} />));
const wait = (ms = SOURCE_CLASS_DELAY_MS) => act(async () => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  classifyDraftSources.mockReset().mockImplementation(async (_id: string, sites: string[]) => ({
    classes: sites.map((site) => ({ site, kind: 'weak' })),
    limited: false,
  }));
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const reading = () => container.querySelector('pre')?.getAttribute('data-reading') === 'true';

describe('useSourceClasses', () => {
  it('is reading a site until it has its kind, or its ask at this save is answered', async () => {
    await render(['blog.example']);
    expect(reading()).toBe(true);
    await wait();
    expect(reading()).toBe(false);
    // An ask that fails: read again after the next save, not reading meanwhile.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    classifyDraftSources.mockRejectedValueOnce(new Error('offline'));
    await render(['blog.example', 'forum.example']);
    expect(reading()).toBe(true);
    await wait();
    expect(reading()).toBe(false);
    await render(['blog.example', 'forum.example'], 's2');
    expect(reading()).toBe(true);
    vi.mocked(console.error).mockRestore();
  });

  it('asks about the sites a few seconds after a save, and keeps each read', async () => {
    await render(['blog.example']);
    await wait(SOURCE_CLASS_DELAY_MS - 100);
    expect(classifyDraftSources).not.toHaveBeenCalled();
    await wait(100);
    expect(classifyDraftSources).toHaveBeenCalledWith('d1', ['blog.example']);
    expect(kinds()).toEqual(new Map([['blog.example', 'weak']]));

    // A site read isn't asked about again; a new one is, after its save.
    await render(['blog.example', 'other.example'], 's2');
    await wait();
    expect(classifyDraftSources).toHaveBeenLastCalledWith('d1', ['other.example']);
    expect(classifyDraftSources).toHaveBeenCalledTimes(2);
  });

  it('asks about a site the API left unread only after the next save', async () => {
    classifyDraftSources.mockResolvedValueOnce({ classes: [], limited: true });
    await render(['blog.example']);
    await wait();
    await render(['blog.example']);
    await wait();
    expect(classifyDraftSources).toHaveBeenCalledTimes(1);
    await render(['blog.example'], 's2');
    await wait();
    expect(classifyDraftSources).toHaveBeenCalledTimes(2);
  });

  it('asks about a site once while its ask is out, a save meanwhile or not', async () => {
    let answer: (value: unknown) => void = () => {};
    classifyDraftSources.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render(['blog.example']);
    await wait();
    await render(['blog.example'], 's2');
    await wait();
    expect(classifyDraftSources).toHaveBeenCalledTimes(1);
    await act(async () =>
      answer({ classes: [{ site: 'blog.example', kind: 'weak' }], limited: false }),
    );
    expect(kinds()).toEqual(new Map([['blog.example', 'weak']]));
  });

  it('lets a site go when its call fails on its own, to ask again after the next save', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    classifyDraftSources.mockRejectedValueOnce(new Error('network'));
    await render(['blog.example']);
    await wait();
    expect(error).toHaveBeenCalledWith('Failed to read the sources:', expect.any(Error));
    await render(['blog.example'], 's2');
    await wait();
    expect(classifyDraftSources).toHaveBeenCalledTimes(2);
    expect(kinds()).toEqual(new Map([['blog.example', 'weak']]));
    error.mockRestore();
  });

  it('asks about the sites past a failed batch at the same save', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    classifyDraftSources.mockRejectedValueOnce(new Error('network'));
    const sites = Array.from({ length: MAX_SOURCE_SITES + 1 }, (_, i) => `site${i}.example`);
    await render(sites);
    await wait();
    expect(classifyDraftSources).toHaveBeenCalledTimes(1);
    // The one past the batch is still to be read: asked without a save.
    expect(reading()).toBe(true);
    await wait();
    expect(classifyDraftSources).toHaveBeenCalledTimes(2);
    expect(classifyDraftSources).toHaveBeenLastCalledWith('d1', [sites[MAX_SOURCE_SITES]]);
    expect(reading()).toBe(false);
    error.mockRestore();
  });

  it('stops asking, silently, when the API has the reads off', async () => {
    classifyDraftSources.mockResolvedValueOnce({ error: 'off' });
    await render(['blog.example']);
    await wait();
    await render(['blog.example', 'other.example'], 's2');
    await wait();
    expect(classifyDraftSources).toHaveBeenCalledTimes(1);
    expect(paused()).toBe(false);
  });

  it('pauses once the AI budget is spent, and asks nothing while off', async () => {
    classifyDraftSources.mockResolvedValueOnce({ error: 'ai_budget' });
    await render(['blog.example']);
    await wait();
    expect(paused()).toBe(true);
    await render(['blog.example', 'other.example'], 's2');
    await wait();
    expect(classifyDraftSources).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(container);
    classifyDraftSources.mockClear();
    await render(['blog.example'], 's1', false);
    await wait();
    expect(classifyDraftSources).not.toHaveBeenCalled();
  });
});
