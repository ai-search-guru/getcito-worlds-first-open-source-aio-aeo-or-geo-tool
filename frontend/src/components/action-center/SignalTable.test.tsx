import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { Signal } from '@/lib/signals/map';
import { groupSignals } from '@/lib/signals/group';
import { NO_WHERE } from '@/lib/signals/where';
import { SignalTable, SignalWhereLine } from './SignalTable';

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

describe('SignalWhereLine', () => {
  it('shows one icon per engine and the first locations, and names them all for screen readers', () => {
    render(
      <SignalWhereLine
        where={{
          platforms: [
            'chatgpt-web',
            'chatgpt',
            'gemini-web',
            'google-aio',
            'perplexity-web',
            'grok-web',
          ],
          regions: ['US', 'GB', 'DE'],
          topics: [],
        }}
      />,
    );
    // The ChatGPT app and its API share one icon; four shown, one more counted.
    const icons = [...container.querySelectorAll('[aria-hidden="true"] > [title]')];
    expect(icons.map((icon) => icon.getAttribute('title'))).toEqual([
      'ChatGPT',
      'Gemini',
      'Google AI Overviews',
      'Perplexity',
    ]);
    expect(container.textContent).toContain('+1');
    expect(container.textContent).toContain('US · GB +1');
    expect(container.querySelector('.sr-only')?.textContent).toBe(
      'Tracked on ChatGPT, ChatGPT API, Gemini, Google AI Overviews, Perplexity, Grok · Tracked in United States, United Kingdom, Germany',
    );
  });

  it('says nothing when Affected already names the one place, or there is none', () => {
    render(
      <SignalWhereLine
        where={{ platforms: ['gemini-web'], regions: [], topics: [] }}
        besides={['Gemini', null]}
      />,
    );
    expect(container.textContent).toBe('');
    render(<SignalWhereLine where={NO_WHERE} />);
    expect(container.textContent).toBe('');
  });
});

const TEXT = 'Which specialty coffee subscriptions ship internationally?';
const copy = (id: string, topic: string, status: Signal['status']): Signal => ({
  id,
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status,
  source: ['ai_results'],
  detectedAt: '2026-10-13T05:47:00+00:00',
  lastDetectedAt: '2026-10-13T05:47:00+00:00',
  resolvedAt: null,
  previousValue: null,
  currentValue: null,
  changeValue: null,
  payload: { promptId: `p-${id}`, promptText: TEXT },
  kpiKeys: [],
  actionId: null,
  where: { platforms: ['chatgpt-web'], regions: ['US'], topics: [topic] },
});

describe('SignalTable groups', () => {
  const copies = [copy('a', 'Coffee subscriptions', 'new'), copy('b', 'Gifts', 'resolved')];

  it('shows copies as one row that opens onto each copy, and acts on the open ones', () => {
    const onSelect = vi.fn();
    const onStatusChange = vi.fn();
    render(
      <SignalTable
        groups={groupSignals(copies)}
        onSelect={onSelect}
        onStatusChange={onStatusChange}
        busyIds={new Set()}
      />,
    );
    const rows = () => container.querySelectorAll('tbody tr');
    expect(rows().length).toBe(1);
    expect(container.textContent).toContain('×2 grouped');
    expect(container.textContent).toContain('2 prompts');

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(rows().length).toBe(3);
    expect(rows()[1].textContent).toContain('In Coffee subscriptions');
    expect(rows()[2].textContent).toContain('In Gifts');

    // A copy opens its own drawer.
    act(() => (rows()[2] as HTMLElement).click());
    expect(onSelect).toHaveBeenCalledWith(copies[1]);
  });

  it('opens the group of a copy selected from elsewhere, such as an action link', () => {
    render(
      <SignalTable
        groups={groupSignals(copies)}
        onSelect={vi.fn()}
        onStatusChange={vi.fn()}
        busyIds={new Set()}
        selectedId="b"
      />,
    );
    expect(container.querySelectorAll('tbody tr').length).toBe(3);
  });

  it("resolves a group's open copies from its menu and leaves the resolved one alone", async () => {
    const onStatusChange = vi.fn();
    render(
      <SignalTable
        groups={groupSignals(copies)}
        onSelect={vi.fn()}
        onStatusChange={onStatusChange}
        busyIds={new Set()}
      />,
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for this signal"]',
    )!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      'Acknowledge',
      'Mark resolved',
      'Dismiss',
      'Reopen',
    ]);
    await act(async () => items[1].click());
    expect(onStatusChange).toHaveBeenCalledWith([copies[0]], 'resolved');
  });
});
