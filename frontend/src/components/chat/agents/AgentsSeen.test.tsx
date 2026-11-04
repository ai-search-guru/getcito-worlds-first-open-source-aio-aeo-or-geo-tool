import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Agent Center seen (CHAT-21 §A item 1): any of its pages marks it, so the
 * chat menu's "New" beside it goes, however it was opened; without browser
 * storage the pill just shows again.
 */

const { AgentsSeen, readAgentsSeen } = await import('./AgentsSeen');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;
const kept = new Map<string, string>();

beforeEach(() => {
  kept.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('AgentsSeen', () => {
  it('marks Agent Center seen once one of its pages shows, and renders nothing', async () => {
    expect(readAgentsSeen()).toBe(false);
    await act(async () => root.render(<AgentsSeen />));
    expect(readAgentsSeen()).toBe(true);
    // The key it had under Chat, so a pill already gone stays gone.
    expect(kept.get('getcito.chatMenu.agentsSeen')).toBe('1');
    expect(host.innerHTML).toBe('');
  });

  it('shows the page without browser storage, the pill then staying', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    await act(async () => root.render(<AgentsSeen />));
    expect(readAgentsSeen()).toBe(false);
  });
});
