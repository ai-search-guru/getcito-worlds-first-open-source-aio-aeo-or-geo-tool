import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanelContext, type ChatPanelState } from './chatPanelContext';

/**
 * The panel's code loads the first time it opens, not with every app page,
 * and stays once loaded (closed, it keeps its chat and a run under way).
 */

const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('./ChatSidePanel', () => {
  loaded.count += 1;
  return { ChatSidePanel: () => <aside data-testid="panel" /> };
});

const { ChatSidePanelSlot } = await import('./ChatSidePanelSlot');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const state = (open: boolean) => ({ open, available: true }) as unknown as ChatPanelState;

async function render(open: boolean) {
  await act(async () => {
    root.render(
      <ChatPanelContext.Provider value={state(open)}>
        <ChatSidePanelSlot />
      </ChatPanelContext.Provider>,
    );
  });
  // The lazy import settles.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ChatSidePanelSlot', () => {
  it("loads the panel's code only when it first opens, and keeps it after closing", async () => {
    await render(false);
    expect(loaded.count).toBe(0);
    expect(container.querySelector('[data-testid="panel"]')).toBeNull();

    await render(true);
    expect(loaded.count).toBe(1);
    expect(container.querySelector('[data-testid="panel"]')).not.toBeNull();

    await render(false);
    expect(container.querySelector('[data-testid="panel"]')).not.toBeNull();
  });
});
