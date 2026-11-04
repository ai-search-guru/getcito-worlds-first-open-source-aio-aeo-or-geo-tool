import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClampedText, ClampedTextTooltip, createClampedTextHandle, isTextCut } from './ClampedText';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('isTextCut', () => {
  const box = (scroll: [number, number], client: [number, number]) => ({
    scrollWidth: scroll[0],
    scrollHeight: scroll[1],
    clientWidth: client[0],
    clientHeight: client[1],
  });

  it('reads a clamped block or a truncated line as cut', () => {
    expect(isTextCut(box([320, 60], [320, 40]))).toBe(true);
    expect(isTextCut(box([210, 16], [140, 16]))).toBe(true);
  });

  it('leaves text that fits, within a pixel of rounding', () => {
    expect(isTextCut(box([320, 40], [320, 40]))).toBe(false);
    expect(isTextCut(box([141, 17], [140, 16]))).toBe(false);
  });
});

describe('ClampedText', () => {
  let container: HTMLDivElement;
  let root: Root;
  const text = 'Which specialty coffee subscriptions ship internationally to Europe?';

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function hover(sizes: { scrollHeight: number; clientHeight: number }) {
    const handle = createClampedTextHandle();
    act(() => {
      root.render(
        <>
          <ClampedText handle={handle} text={text} render={<span data-testid="cell" />} />
          <ClampedTextTooltip handle={handle} />
        </>,
      );
    });
    const cell = container.querySelector('[data-testid="cell"]') as HTMLElement;
    for (const [key, value] of Object.entries({ ...sizes, scrollWidth: 300, clientWidth: 300 })) {
      Object.defineProperty(cell, key, { configurable: true, value });
    }
    // jsdom has no PointerEvent; React and the tooltip read the event type.
    act(() => {
      for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
        cell.dispatchEvent(new MouseEvent(type, { bubbles: !type.endsWith('enter') }));
      }
    });
    act(() => vi.advanceTimersByTime(400));
    return cell;
  }

  it('keeps the whole text in the element', () => {
    const cell = hover({ scrollHeight: 40, clientHeight: 40 });
    expect(cell.textContent).toBe(text);
  });

  it('shows the whole text on hover when the element cut it', () => {
    hover({ scrollHeight: 60, clientHeight: 40 });
    const popup = document.querySelector('[data-slot="tooltip-content"]');
    expect(popup?.textContent).toBe(text);
  });

  it('shows the whole text when a cut link gets keyboard focus', () => {
    const handle = createClampedTextHandle();
    act(() => {
      root.render(
        <>
          <ClampedText
            handle={handle}
            text={text}
            render={<a href="#prompt" data-testid="cell" />}
          />
          <ClampedTextTooltip handle={handle} />
        </>,
      );
    });
    const cell = container.querySelector('[data-testid="cell"]') as HTMLElement;
    Object.defineProperty(cell, 'scrollWidth', { configurable: true, value: 420 });
    Object.defineProperty(cell, 'clientWidth', { configurable: true, value: 320 });
    act(() => cell.focus());
    act(() => vi.advanceTimersByTime(400));
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(text);
  });

  it('shows nothing for text that fits', () => {
    hover({ scrollHeight: 40, clientHeight: 40 });
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  });
});
