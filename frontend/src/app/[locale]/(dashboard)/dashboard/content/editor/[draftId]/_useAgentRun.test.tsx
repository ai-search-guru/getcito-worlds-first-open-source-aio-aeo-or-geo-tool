import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '@/lib/content/agentRuns';
import { AGENT_POLL_MS } from '@/lib/content/drafts';
import { RUN_POLL_MS, useAgentRun } from './_useAgentRun';

/**
 * The run's steps read while the editor waits on the agent (CE-027/035): a
 * second after each read, less often in a hidden tab, and at once when it
 * shows again.
 */

const readAgentRun = vi.fn();
vi.mock('@/lib/content/agentRunsClient', () => ({
  readAgentRun: (...args: unknown[]) => readAgentRun(...args),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const run = (): AgentRun => ({
  id: 'r1',
  kind: 'fix',
  steps: [{ key: 'write_changes', count: null }],
  step: 0,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  stoppedAt: null,
  outcome: null,
});

/** The hook as the editor uses it: the run it reads, by id. */
function Harness() {
  const run = useAgentRun('d1', true, ['fix']);
  return <span data-run={run?.id ?? ''} />;
}
const seen = () => container.querySelector('[data-run]')!.getAttribute('data-run');

let container: HTMLDivElement;
let root: Root;
let hidden = false;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  readAgentRun.mockReset().mockResolvedValue(run());
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useAgentRun', () => {
  it('reads the run a second after each read', async () => {
    expect(seen()).toBe('r1');
    expect(readAgentRun).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(RUN_POLL_MS)));
    expect(readAgentRun).toHaveBeenCalledTimes(2);
  });

  it('reads less often in a hidden tab, and at once when it shows again', async () => {
    hidden = true;
    await act(async () => void (await vi.advanceTimersByTimeAsync(RUN_POLL_MS)));
    // The read due now goes; the one after waits the longer step.
    expect(readAgentRun).toHaveBeenCalledTimes(2);
    await act(async () => void (await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 2)));
    expect(readAgentRun).toHaveBeenCalledTimes(2);

    hidden = false;
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    expect(readAgentRun).toHaveBeenCalledTimes(3);
    expect(AGENT_POLL_MS).toBeGreaterThan(RUN_POLL_MS * 2);
  });
});
