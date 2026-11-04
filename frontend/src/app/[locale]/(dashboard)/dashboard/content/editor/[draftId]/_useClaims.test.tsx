import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkDraftClaims = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  checkDraftClaims: (...args: unknown[]) => checkDraftClaims(...args),
}));

const { CLAIMS_DELAY_MS, CLAIMS_EVERY_MS, useClaims } = await import('./_useClaims');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The claims in the draft's own words (Quality CE-045): asked a few seconds
 * after a save, no closer than CLAIMS_EVERY_MS, one ask at a time, not with
 * changes to save, leaving the block being written; a spent AI budget or
 * the day's reads made stop the asks.
 */

let container: HTMLDivElement;
let root: Root;
let writing: string | null = null;
let recheck: () => void = () => {};

function Probe({
  savedAt,
  enabled = true,
  unsaved = false,
}: {
  savedAt: string;
  enabled?: boolean;
  unsaved?: boolean;
}) {
  const read = useClaims('d1', savedAt, enabled, unsaved, () => writing);
  useEffect(() => {
    recheck = read.recheck;
  });
  return (
    <pre
      data-blocks={JSON.stringify(read.blocks)}
      data-paused={String(read.paused)}
      data-limited={String(read.limited)}
      data-reading={String(read.reading)}
    />
  );
}

const attr = (name: string) => container.querySelector('pre')!.getAttribute(name)!;
const blocks = () => JSON.parse(attr('data-blocks'));
const paused = () => attr('data-paused') === 'true';
const render = (savedAt: string, enabled = true, unsaved = false) =>
  act(async () => root.render(<Probe savedAt={savedAt} enabled={enabled} unsaved={unsaved} />));
const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
const BLOCK = {
  text: 'Ledgerly is the fastest app.',
  claims: [{ text: 'the fastest app', kind: 'superlative' }],
};

beforeEach(() => {
  vi.useFakeTimers();
  writing = null;
  checkDraftClaims.mockReset().mockResolvedValue({ blocks: [BLOCK], pending: 0, limited: false });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useClaims', () => {
  it('asks a few seconds after a save, leaving the block being written', async () => {
    writing = 'Still writing this.';
    await render('s1');
    await wait(CLAIMS_DELAY_MS - 100);
    expect(checkDraftClaims).not.toHaveBeenCalled();
    await wait(100);
    expect(checkDraftClaims).toHaveBeenCalledWith('d1', 'Still writing this.');
    expect(blocks()).toEqual([BLOCK]);
  });

  it('asks no closer together than CLAIMS_EVERY_MS, and once a save', async () => {
    await render('s1');
    await wait(CLAIMS_DELAY_MS);
    await render('s1');
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(1);
    await render('s2');
    await wait(CLAIMS_DELAY_MS);
    // Within half a minute of the last ask: not yet.
    await render('s3');
    await wait(CLAIMS_DELAY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(2);
  });

  it('is reading a save until its claims are asked about', async () => {
    await render('s1');
    await wait(CLAIMS_DELAY_MS);
    expect(attr('data-reading')).toBe('false');
    // A new save within the half minute: still to be read, the score may move.
    await render('s2');
    await wait(CLAIMS_DELAY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(1);
    expect(attr('data-reading')).toBe('true');
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(2);
    expect(attr('data-reading')).toBe('false');
  });

  it('asks about a save made while an ask is out once it is back', async () => {
    let answer: (value: unknown) => void = () => {};
    checkDraftClaims.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render('s1');
    await wait(CLAIMS_DELAY_MS);
    await render('s2');
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(1);
    await act(async () => answer({ blocks: [], pending: 0, limited: false }));
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(2);
  });

  it('pauses once the AI budget is spent, and stops silently when the API has them off', async () => {
    checkDraftClaims.mockResolvedValueOnce({ error: 'ai_budget' });
    await render('s1');
    await wait(CLAIMS_DELAY_MS);
    expect(paused()).toBe(true);
    await render('s2');
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(container);
    checkDraftClaims.mockReset().mockResolvedValue({ error: 'off' });
    await render('s1');
    await wait(CLAIMS_DELAY_MS);
    await render('s2');
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(1);
    expect(paused()).toBe(false);
  });

  it('asks again after the next save when an ask fails, not on a timer', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkDraftClaims.mockResolvedValueOnce({ error: 'failed' });
    await render('s1');
    await wait(CLAIMS_DELAY_MS);
    await wait(CLAIMS_EVERY_MS * 2);
    expect(checkDraftClaims).toHaveBeenCalledTimes(1);
    await render('s2');
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("asks nothing before Quality's second phase", async () => {
    await render('s1', false);
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).not.toHaveBeenCalled();
    expect(blocks()).toBeNull();
    expect(attr('data-reading')).toBe('false');
  });

  it('asks nothing while there are changes to save: their save asks', async () => {
    await render('s1', true, true);
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).not.toHaveBeenCalled();
    expect(attr('data-reading')).toBe('true');
    await render('s2');
    await wait(CLAIMS_DELAY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(1);
    expect(attr('data-reading')).toBe('false');
  });

  it('reads the block left for later once the person leaves it, with no save', async () => {
    writing = 'Still writing this.';
    await render('s1');
    await wait(CLAIMS_DELAY_MS);
    expect(checkDraftClaims).toHaveBeenLastCalledWith('d1', 'Still writing this.');
    writing = null;
    act(() => recheck());
    // Half a minute after the last ask, as any.
    await wait(CLAIMS_EVERY_MS - 100);
    expect(checkDraftClaims).toHaveBeenCalledTimes(1);
    await wait(100);
    expect(checkDraftClaims).toHaveBeenCalledTimes(2);
    expect(checkDraftClaims).toHaveBeenLastCalledWith('d1', null);
    // Nothing was left that time: leaving again asks nothing.
    act(() => recheck());
    await wait(CLAIMS_EVERY_MS * 2);
    expect(checkDraftClaims).toHaveBeenCalledTimes(2);
  });

  it('asks again for blocks an ask had no calls left for, and stops once the day’s reads are made', async () => {
    checkDraftClaims
      .mockResolvedValueOnce({ blocks: [BLOCK], pending: 5, limited: false })
      .mockResolvedValueOnce({ blocks: [BLOCK], pending: 2, limited: true });
    await render('s1');
    await wait(CLAIMS_DELAY_MS);
    expect(attr('data-reading')).toBe('true');
    await wait(CLAIMS_EVERY_MS);
    expect(checkDraftClaims).toHaveBeenCalledTimes(2);
    expect(attr('data-limited')).toBe('true');
    expect(attr('data-reading')).toBe('false');
    await render('s2');
    await wait(CLAIMS_EVERY_MS * 2);
    expect(checkDraftClaims).toHaveBeenCalledTimes(2);
  });
});
