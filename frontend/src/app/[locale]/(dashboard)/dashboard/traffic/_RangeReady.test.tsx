import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RangeReadyProvider, rangeKeyOf, useRangeGate, useRangeReady } from './_RangeReady';

/**
 * A new range on the AI Traffic page shows only a spinner until the page and
 * every section have its data; a settled range stays shown.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function Section({ id, ready }: { id: string; ready: boolean }) {
  useRangeReady(id, ready);
  return null;
}

function Page({
  range,
  own,
  sections,
}: {
  range: string;
  own: boolean;
  sections: Record<string, boolean>;
}) {
  const gate = useRangeGate(range, own);
  return (
    <RangeReadyProvider value={gate.value}>
      <p>{gate.settled ? 'shown' : 'spinner'}</p>
      {Object.entries(sections).map(([id, ready]) => (
        <Section key={id} id={id} ready={ready} />
      ))}
    </RangeReadyProvider>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const render = async (props: Parameters<typeof Page>[0]) => {
  await act(async () => root.render(<Page {...props} />));
  await act(async () => vi.advanceTimersByTime(1));
  return container.textContent;
};

describe('the range gate', () => {
  it('waits for the page and every section, then shows the range', async () => {
    expect(await render({ range: 'a', own: false, sections: { pages: true } })).toBe('spinner');
    expect(await render({ range: 'a', own: true, sections: { pages: false, bots: true } })).toBe(
      'spinner',
    );
    expect(await render({ range: 'a', own: true, sections: { pages: true, bots: true } })).toBe(
      'shown',
    );
  });

  it("doesn't hide a settled range when a section reads again for a tab", async () => {
    await render({ range: 'a', own: true, sections: { pages: true } });
    expect(await render({ range: 'a', own: true, sections: { pages: false } })).toBe('shown');
  });

  it('hides the page again for a new range, until its sections have it', async () => {
    await render({ range: 'a', own: true, sections: { pages: true } });
    // The same render the range changes in: the section still holds range a.
    expect(await render({ range: 'b', own: true, sections: { pages: true } })).toBe('shown');
    // ...because it hadn't said otherwise: a section that has nothing to read
    // for b is ready for b straight away. One still reading keeps it hidden.
    expect(await render({ range: 'c', own: true, sections: { pages: false } })).toBe('spinner');
    expect(await render({ range: 'c', own: true, sections: { pages: true } })).toBe('shown');
  });

  it("shows the page after 10 s even if a read hangs, about the reads' statement timeout", async () => {
    expect(await render({ range: 'a', own: true, sections: { pages: false } })).toBe('spinner');
    await act(async () => vi.advanceTimersByTime(9_000));
    expect(container.textContent).toBe('spinner');
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toBe('shown');
  });

  // gkhngyk on #1216: All time → 7d → All time while 7d loads showed the old
  // All time state as settled at once, with 7d's data if it had landed.
  it('waits again when the range comes back to one that settled before', async () => {
    await render({ range: 'all', own: true, sections: { pages: true } });
    await render({ range: '7d', own: false, sections: { pages: false } });
    expect(await render({ range: 'all', own: false, sections: { pages: false } })).toBe('spinner');
    expect(await render({ range: 'all', own: true, sections: { pages: true } })).toBe('shown');
  });
});

describe('rangeKeyOf', () => {
  it('names a window by its two ends; all time has none', () => {
    expect(rangeKeyOf({ dateFrom: '2026-10-12T00:00:00Z', dateTo: '2026-10-19T00:00:00Z' })).toBe(
      '2026-10-12T00:00:00Z|2026-10-19T00:00:00Z',
    );
    expect(rangeKeyOf({})).toBe('|');
  });
});
