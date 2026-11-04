import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { Signal } from '@/lib/signals/map';
import { SupportingSignals } from './SupportingSignals';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
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

const signal = (over: Partial<Signal> = {}): Signal => ({
  id: 's1',
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detectedAt: '2026-10-14T00:00:00Z',
  lastDetectedAt: '2026-10-14T00:00:00Z',
  resolvedAt: null,
  previousValue: null,
  currentValue: null,
  changeValue: null,
  payload: { promptText: 'What is the best AI rank tracker?' },
  kpiKeys: [],
  actionId: 'a1',
  where: { platforms: ['chatgpt-web', 'gemini-web'], regions: ['US'], topics: [] },
  ...over,
});

const lines = () => [...container.querySelectorAll('li')].map((li) => li.textContent);

describe('SupportingSignals', () => {
  it('counts the open signals and names each by type, platform and prompt', () => {
    render(
      <SupportingSignals
        actionId="a1"
        signals={[
          signal(),
          signal({
            id: 's2',
            status: 'acknowledged',
            where: { platforms: [], regions: [], topics: [] },
          }),
          // No longer supports it.
          signal({ id: 's3', status: 'resolved' }),
        ]}
        onOpenSignal={vi.fn()}
        onShowAll={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('2 signals support this action');
    expect(lines()).toEqual([
      'Citation · LostChatGPT, Gemini · What is the best AI rank tracker?',
      'Citation · LostWhat is the best AI rank tracker?',
    ]);
    // The resolved one is still on the Signals tab.
    expect(container.textContent).toContain('All signals (3)');
  });

  it('opens a signal, and the Signals tab for the rest', () => {
    const onOpenSignal = vi.fn();
    const onShowAll = vi.fn();
    const many = Array.from({ length: 7 }, (_, i) => signal({ id: `s${i}` }));
    render(
      <SupportingSignals
        actionId="a1"
        signals={many}
        onOpenSignal={onOpenSignal}
        onShowAll={onShowAll}
      />,
    );

    expect(lines()).toHaveLength(5);
    act(() =>
      container
        .querySelector('li button')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(onOpenSignal).toHaveBeenCalledWith('s0');

    const all = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('All signals'),
    )!;
    act(() => all.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onShowAll).toHaveBeenCalled();
  });

  it('does not count a signal that has moved on to a later action', () => {
    render(
      <SupportingSignals
        actionId="a1"
        signals={[signal(), signal({ id: 's2', actionId: 'a2' })]}
        onOpenSignal={vi.fn()}
        onShowAll={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('1 signal supports this action');
    expect(container.textContent).toContain('All signals (2)');
  });

  it('says so when nothing open supports the action any more', () => {
    render(
      <SupportingSignals
        actionId="a1"
        signals={[signal({ status: 'dismissed' })]}
        onOpenSignal={vi.fn()}
        onShowAll={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('No open signal supports this action any more.');
    expect(lines()).toEqual([]);
  });
});
