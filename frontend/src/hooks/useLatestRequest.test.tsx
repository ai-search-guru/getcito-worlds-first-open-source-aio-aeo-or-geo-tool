import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useLatestRequest } from './useLatestRequest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Start = () => () => boolean;

function Probe({ onStart }: { onStart: (start: Start) => void }) {
  const start = useLatestRequest();
  useEffect(() => {
    onStart(start);
  }, [start, onStart]);
  return null;
}

/** Only the latest of several requests may set state (gkhngyk on #1216). */
describe('useLatestRequest', () => {
  it('tells each request whether a newer one started', () => {
    const seen: Start[] = [];
    const onStart = (start: Start) => seen.push(start);
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe onStart={onStart} />));
    const start = seen[0];

    // 90 days, then 24 hours before the first answered.
    const ninetyDays = start();
    const day = start();
    expect(day()).toBe(true);
    expect(ninetyDays()).toBe(false);

    // The same function across renders: a re-render doesn't reset the order.
    act(() => root.render(<Probe onStart={onStart} />));
    expect(seen.every((s) => s === start)).toBe(true);
    expect(day()).toBe(true);
    act(() => root.unmount());
  });
});
