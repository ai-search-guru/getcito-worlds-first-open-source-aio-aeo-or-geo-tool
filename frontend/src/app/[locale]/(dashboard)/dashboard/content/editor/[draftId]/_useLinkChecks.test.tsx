import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkCheck } from '@/lib/content/qualityChecks';

const checkDraftLinks = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  checkDraftLinks: (...args: unknown[]) => checkDraftLinks(...args),
}));

const { LINK_CHECK_DELAY_MS, useLinkChecks } = await import('./_useLinkChecks');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Trust's link reads (Quality spec §2.2): the saved draft's links, asked
 * about after the links or the save change; a link without a read is asked
 * about again only after the next save.
 */

let container: HTMLDivElement;
let root: Root;
/** The links the API reads from the saved draft. */
let saved: string[];
/** The links the API never reads. */
let skipped: string[];

function Probe({
  hrefs,
  savedAt,
  enabled,
}: {
  hrefs: string[];
  savedAt: string;
  enabled: boolean;
}) {
  const { checks, pending } = useLinkChecks('d1', savedAt, hrefs, enabled);
  return <pre data-checks={JSON.stringify([...checks])} data-pending={pending} />;
}

/** The reads the hook holds, by link. */
const seen = () =>
  new Map<string, LinkCheck>(
    JSON.parse(container.querySelector('pre')?.getAttribute('data-checks') ?? '[]'),
  );

/** How many links' reads may still come. */
const pending = () => Number(container.querySelector('pre')?.getAttribute('data-pending'));

const render = (hrefs: string[], savedAt = 's1', enabled = true) =>
  act(async () => root.render(<Probe hrefs={hrefs} savedAt={savedAt} enabled={enabled} />));
const wait = (ms = LINK_CHECK_DELAY_MS) => act(async () => vi.advanceTimersByTimeAsync(ms));
const ok = (href: string): LinkCheck => ({ href, status: 'ok', httpStatus: 200, date: null });

beforeEach(() => {
  vi.useFakeTimers();
  saved = [];
  skipped = [];
  checkDraftLinks.mockReset().mockImplementation(async () => ({ links: saved.map(ok), skipped }));
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useLinkChecks', () => {
  it('asks about the saved draft once the links settle, and keeps the reads', async () => {
    saved = ['https://a.example/', 'https://b.example/'];
    await render(['https://a.example/']);
    await wait(LINK_CHECK_DELAY_MS - 100);
    await render(['https://a.example/', 'https://b.example/']);
    expect(pending()).toBe(2);
    await wait();
    expect(checkDraftLinks).toHaveBeenCalledTimes(1);
    expect(checkDraftLinks).toHaveBeenCalledWith('d1');
    expect([...seen().keys()]).toEqual(['https://a.example/', 'https://b.example/']);
    expect(pending()).toBe(0);

    // Nothing new to read: no ask.
    await render(['https://a.example/', 'https://b.example/'], 's2');
    await wait();
    expect(checkDraftLinks).toHaveBeenCalledTimes(1);
  });

  it('asks about a link the answer left out again after the next save, not holding this one', async () => {
    // Not saved yet (or over the hourly reads): the API's answer leaves it out.
    saved = ['https://a.example/'];
    await render(['https://a.example/', 'https://new.example/']);
    await wait();
    expect(seen().has('https://new.example/')).toBe(false);
    // No read is coming at this save: it doesn't hold the score.
    expect(pending()).toBe(0);

    // Same save: not asked again.
    await render(['https://a.example/', 'https://new.example/', 'https://a.example/']);
    await wait();
    expect(checkDraftLinks).toHaveBeenCalledTimes(1);

    saved = ['https://a.example/', 'https://new.example/'];
    await render(['https://a.example/', 'https://new.example/'], 's2');
    // Its read comes after the next save.
    expect(pending()).toBe(1);
    await wait();
    expect(checkDraftLinks).toHaveBeenCalledTimes(2);
    expect(pending()).toBe(0);
    expect(seen().get('https://new.example/')?.status).toBe('ok');
  });

  it("doesn't let an older save's late answer hold a newer save's left-out link", async () => {
    let lateA!: (answer: unknown) => void;
    checkDraftLinks.mockImplementationOnce(() => new Promise((resolve) => (lateA = resolve)));
    await render(['https://a.example/']);
    await wait();
    // A newer save asks again; its answer leaves the link out (over the hourly reads).
    await render(['https://a.example/'], 's2');
    await wait();
    expect(checkDraftLinks).toHaveBeenCalledTimes(2);
    expect(pending()).toBe(0);
    await act(async () => lateA({ links: [], skipped: [] }));
    expect(pending()).toBe(0);
  });

  it('counts a call that fails on its own as a failed read: no read is coming in this save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    checkDraftLinks.mockRejectedValueOnce(new Error('offline'));
    await render(['https://a.example/']);
    expect(pending()).toBe(1);
    await wait();
    expect(pending()).toBe(0);
    vi.mocked(console.error).mockRestore();
  });

  it("doesn't ask again in the same save after a failed ask, nor with Quality off", async () => {
    checkDraftLinks.mockResolvedValue({ error: 'failed' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render(['https://a.example/']);
    expect(pending()).toBe(1);
    await wait(LINK_CHECK_DELAY_MS * 3);
    expect(checkDraftLinks).toHaveBeenCalledTimes(1);
    expect(seen().size).toBe(0);
    // No read is coming in this save.
    expect(pending()).toBe(0);

    await render(['https://d.example/'], 's1', false);
    await wait();
    expect(checkDraftLinks).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask again about a link the API never reads", async () => {
    skipped = ['https://a.example/unsubscribe'];
    await render(['https://a.example/unsubscribe']);
    await wait();
    await render(['https://a.example/unsubscribe'], 's2');
    await wait();
    expect(checkDraftLinks).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(0);
  });
});
