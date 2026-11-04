import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { InsightsSummary, TrackedPromptsKpi } from '@/lib/actions/tracking';
import { InfoTip, KpiRows } from './_KpiCards';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

// Only what the cards read; the rest of the summary doesn't matter here.
const summary = (over: Partial<InsightsSummary> = {}) =>
  ({
    totalResults: 120,
    mentioningResults: 80,
    positionedResults: 60,
    totalMentions: 340,
    mentionsChange: 12,
    totalCitations: 90,
    citationsChange: -4,
    netSentiment: null,
    netSentimentChange: null,
    positiveSentimentPct: null,
    negativeSentimentPct: null,
    avgPosition: null,
    avgPositionChange: null,
    citationRate: null,
    citationRateChange: null,
    ...over,
  }) as unknown as InsightsSummary;

let container: HTMLDivElement;
let root: Root;
const onBreakdown = vi.fn();
const onNavigate = vi.fn();

function render(
  trackedPrompts: TrackedPromptsKpi,
  over: Partial<InsightsSummary> = {},
  props: { mentionsHref?: string } = {},
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <KpiRows
          summary={summary(over)}
          trend={null}
          trackedPrompts={trackedPrompts}
          coverage={null}
          sov={null}
          competitors={null}
          comparison={null}
          series={null}
          onBreakdown={onBreakdown}
          onNavigate={onNavigate}
          {...props}
        />
      </NextIntlClientProvider>,
    );
  });
}

const plan = (quotaUsed: number, quotaLimit: number): TrackedPromptsKpi => ({
  activeInPeriod: 7,
  quotaUsed,
  quotaLimit,
});

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Tracked prompts card', () => {
  it('says how many more prompts or locations the plan can take', () => {
    render(plan(47, 50));
    expect(container.textContent).toContain('3 prompts/locations left to add');
    expect(container.textContent).not.toContain('all brands');
  });

  it('says one more in the singular', () => {
    render(plan(49, 50));
    expect(container.textContent).toContain('1 prompt/location left to add');
  });

  it('formats a large count', () => {
    render(plan(250, 1500));
    expect(container.textContent).toContain('1,250 prompts/locations left to add');
  });

  it('says the limit is reached when the plan is full', () => {
    render(plan(50, 50));
    expect(container.textContent).toContain('Plan limit reached');
  });

  it('says how far over the limit an account is after a downgrade', () => {
    render(plan(52, 50));
    expect(container.textContent).toContain('2 over your plan limit');
  });
});

describe('the Mentions and Citations cards', () => {
  it('say their change is against the previous period', () => {
    render(plan(47, 50));
    expect(container.textContent?.match(/vs previous period/g)).toHaveLength(2);
    expect(container.textContent).not.toMatch(/same \d+ prompts?/);
  });

  it('open their own pages', () => {
    render(plan(47, 50));
    const card = (label: string) =>
      container.querySelector(`[role=button][aria-label="${label}"]`) as HTMLElement;
    act(() => card('Mentions: open Mentions').click());
    expect(onNavigate).toHaveBeenLastCalledWith('/dashboard/mentions');
    act(() => card('Citations: open Citations').click());
    expect(onNavigate).toHaveBeenLastCalledWith('/dashboard/citations');
    expect(onBreakdown).not.toHaveBeenCalled();
  });

  it('opens Mentions on the same range from Mentions and Net sentiment', () => {
    render(plan(47, 50), {}, { mentionsHref: '/dashboard/mentions?range=7d' });
    const card = (label: string) =>
      container.querySelector(`[role=button][aria-label="${label}"]`) as HTMLElement;
    act(() => card('Mentions: open Mentions').click());
    expect(onNavigate).toHaveBeenLastCalledWith('/dashboard/mentions?range=7d');
    onNavigate.mockClear();
    act(() => card('Net sentiment: open Mentions').click());
    expect(onNavigate).toHaveBeenLastCalledWith('/dashboard/mentions?range=7d');
  });

  it('say nothing of a change they do not have', () => {
    render(plan(47, 50), { mentionsChange: null, citationsChange: null });
    expect(container.textContent).not.toContain('vs previous period');
  });
});

describe('InfoTip', () => {
  /** Hovers an icon whose box starts at `left`, and returns where the tooltip is centred. */
  function tooltipCentreFor(left: number) {
    act(() => {
      root.render(<InfoTip content="What this counts" />);
    });
    const icon = container.querySelector<HTMLElement>('[aria-label="More information"]')!;
    icon.getBoundingClientRect = () => ({ left, width: 12, bottom: 100 }) as DOMRect;
    act(() => {
      icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.textContent).toBe('What this counts');
    return parseFloat(tooltip.style.left);
  }

  it('centres on its icon', () => {
    expect(tooltipCentreFor(500)).toBe(506);
  });

  it("stays on screen beside the window's edges", () => {
    // 224px wide, 8px from either edge.
    expect(tooltipCentreFor(window.innerWidth - 20)).toBe(window.innerWidth - 120);
    expect(tooltipCentreFor(2)).toBe(120);
  });
});
