import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrafficSources } from '@/lib/actions/traffic';
import type { SnippetCheckResult } from '@/lib/trafficSnippetClient';

/**
 * AI Traffic's first check (2026-11-01): a brand never checked for the
 * snippet, with no AI visit, is checked once as the page opens, once a
 * browser session; a refused or failed check keeps what the page showed.
 */

const checkTrackingSnippet = vi.fn<(brandId: string) => Promise<SnippetCheckResult>>();
vi.mock('@/lib/trafficSnippetClient', () => ({
  checkTrackingSnippet: (brandId: string) => checkTrackingSnippet(brandId),
}));

const { firstCheckKey, needsFirstCheck, useFirstSnippetCheck } =
  await import('./_useFirstSnippetCheck');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const off = { configured: true, connected: false, mapped: false, firstDataAt: null };
const sources = (over: Partial<TrafficSources> = {}): TrafficSources => ({
  snippetLastVisitAt: null,
  snippetFoundAt: null,
  snippetCheckedAt: null,
  ga: { ...off, lastDataAt: null, property: null },
  gsc: { ...off, lastDataAt: null, property: null },
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onChecked = vi.fn();

function Probe(props: { sources: TrafficSources | null; domain?: string }) {
  const checking = useFirstSnippetCheck({
    brandId: 'b1',
    sources: props.sources,
    domain: props.domain,
    onChecked,
  });
  return <p>{checking ? 'checking' : 'idle'}</p>;
}

function render(props: { sources: TrafficSources | null; domain?: string }) {
  act(() => {
    root.render(<Probe {...props} />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('needsFirstCheck', () => {
  it('checks only a brand never checked, with no AI visit and a domain', () => {
    expect(needsFirstCheck(sources(), 'acme.com')).toBe(true);
    expect(needsFirstCheck(null, 'acme.com')).toBe(false);
    expect(needsFirstCheck(sources({ snippetCheckedAt: '2026-10-31T09:00:00Z' }), 'acme.com')).toBe(
      false,
    );
    expect(
      needsFirstCheck(sources({ snippetLastVisitAt: '2026-09-01T09:00:00Z' }), 'acme.com'),
    ).toBe(false);
    expect(needsFirstCheck(sources(), undefined)).toBe(false);
  });
});

describe('useFirstSnippetCheck', () => {
  it('checks once as the page opens, says so while it runs, then reads the sources again', async () => {
    let answer: (result: SnippetCheckResult) => void = () => {};
    checkTrackingSnippet.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    render({ sources: sources(), domain: 'acme.com' });
    expect(checkTrackingSnippet).toHaveBeenCalledOnce();
    expect(checkTrackingSnippet).toHaveBeenCalledWith('b1');
    expect(container.textContent).toBe('checking');

    await act(async () => {
      answer({ ok: true, status: 'not_found', domain: 'acme.com', checkedAt: null });
    });
    expect(container.textContent).toBe('idle');
    expect(onChecked).toHaveBeenCalledOnce();

    // The same sources again, or the page opened again this session: no new check.
    render({ sources: sources(), domain: 'acme.com' });
    act(() => root.unmount());
    root = createRoot(container);
    render({ sources: sources(), domain: 'acme.com' });
    expect(checkTrackingSnippet).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(firstCheckKey('b1'))).toBe('1');
  });

  it('keeps what the page showed when the check is refused, as by the rate limit', async () => {
    checkTrackingSnippet.mockResolvedValue({ ok: false });

    render({ sources: sources(), domain: 'acme.com' });
    await act(async () => {});
    expect(container.textContent).toBe('idle');
    expect(onChecked).not.toHaveBeenCalled();
  });

  it('checks nothing while the sources load, once checked, after a visit, or without a domain', () => {
    render({ sources: null, domain: 'acme.com' });
    render({ sources: sources({ snippetCheckedAt: '2026-10-31T09:00:00Z' }), domain: 'acme.com' });
    render({
      sources: sources({ snippetLastVisitAt: '2026-09-01T09:00:00Z' }),
      domain: 'acme.com',
    });
    render({ sources: sources() });
    expect(checkTrackingSnippet).not.toHaveBeenCalled();
    expect(container.textContent).toBe('idle');
  });
});
