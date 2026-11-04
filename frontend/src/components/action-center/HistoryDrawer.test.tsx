import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ActionHistoryItem } from '@/lib/action-center/history';
import type { Signal } from '@/lib/signals/map';
import { guessedVolumeEstimate } from '@/lib/volumeEstimate';

/**
 * The History drawer's goal and what happened, told from the action's own
 * signals as the Actions drawer tells them (AC-003), with the general
 * sentences while nothing can be read.
 */

const { getActionSignals, getPromptDemand } = vi.hoisted(() => ({
  getActionSignals: vi.fn(),
  getPromptDemand: vi.fn(),
}));
vi.mock('@/lib/actions/actionCenter', () => ({ getActionSignals, getPromptDemand }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { HistoryDrawer } = await import('./HistoryDrawer');

// Days are read where the reader is; pin it so the fixtures' days hold anywhere.
process.env.TZ = 'UTC';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const item = {
  id: 'a1',
  actionNo: 12,
  kind: 'recover_lost_citations',
  type: 'recover',
  priorityScore: 84,
  priorityLevel: 'high',
  status: 'completed',
  outcome: 'improved',
  payload: {},
  kpiKeys: [],
  sources: ['ai_results'],
  triggerSignals: [{ signalId: 's1', kind: 'lost_citations', detectedAt: '2026-10-09T00:00:00Z' }],
  affected: [],
  results: [],
  positionOutcome: null,
  tasks: [],
  assignee: null,
  dueDate: '2026-11-09',
  createdAt: '2026-10-10T00:00:00Z',
  completedAt: '2026-10-20T00:00:00Z',
  timeToCloseDays: 10,
} as ActionHistoryItem;

const signal = {
  id: 's1',
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'resolved',
  source: ['ai_results'],
  detectedAt: '2026-10-09T00:00:00Z',
  lastDetectedAt: '2026-10-09T00:00:00Z',
  resolvedAt: '2026-10-20T00:00:00Z',
  previousValue: null,
  currentValue: null,
  changeValue: null,
  payload: {
    promptId: 'p1',
    promptText: 'Best coffee subscription?',
    lostUrls: [{ url: 'https://acme.example/pricing', position: 2 }],
  },
  kpiKeys: [],
  actionId: 'a1',
  where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
} as unknown as Signal;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

/** The text under a section's label. */
const under = (label: string) =>
  [...document.querySelectorAll('section')].find((s) => s.textContent?.startsWith(label))
    ?.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getActionSignals.mockReset();
  getPromptDemand.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('HistoryDrawer', () => {
  it("tells the goal and what happened from the action's signals once they are read", async () => {
    let answer: (value: unknown) => void = () => {};
    getActionSignals.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    getPromptDemand.mockResolvedValue({ p1: guessedVolumeEstimate(5500, null) });
    render(<HistoryDrawer brandId="b1" item={item} onOpenChange={() => {}} />);

    // Placeholders while reading, not the general sentences.
    expect(under('What was the goal?')).toBe('What was the goal?');
    expect(getActionSignals).toHaveBeenCalledWith('b1', 'a1');

    await act(async () => answer([signal]));
    const happened = under('What happened?');
    expect(happened).toContain('Best coffee subscription?');
    expect(happened).toContain('2.7–11k AI searches a month, estimated');
    expect(happened).toContain('Oct 9');
    // The goal is dated by the action's due date.
    expect(under('What was the goal?')).toContain('Nov 9');
  });

  it('says what became of the signals that raised it, beside the result (learning A3)', async () => {
    getActionSignals.mockResolvedValue([]);
    render(
      <HistoryDrawer
        brandId="b1"
        item={{
          ...item,
          signalsAfter: { total: 4, ended: 2, replaced: 1, dismissed: 0, open: 1 },
        }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(under('Result')).toContain(
      'Of the 4 signals that raised it, when measured: 2 ended, 1 turned into another, 1 still open.',
    );

    render(
      <HistoryDrawer brandId="b1" item={{ ...item, signalsAfter: null }} onOpenChange={() => {}} />,
    );
    await act(async () => {});
    expect(under('Result')).not.toContain('that raised it');
  });

  it('says it was measured on the prompts it named, the brand-wide figures beside (learning A1)', async () => {
    getActionSignals.mockResolvedValue([]);
    const metric = (id: string, before: number, after: number) => ({
      id,
      label: id,
      metric: id as never,
      before,
      after,
      delta: after - before,
      unit: 'number' as const,
      direction: 'higher_is_better' as const,
    });
    render(
      <HistoryDrawer
        brandId="b1"
        item={{
          ...item,
          results: [metric('mentions', 2, 6)],
          measuredOn: { entity: 'prompts', count: 2 },
          brandWideResults: [metric('citations', 100, 104)],
        }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    const result = under('Result');
    expect(result).toContain('Measured on the 2 prompts it named.');
    expect(result).toMatch(/Brand-wide over the same days: \S.* 100 → 104/);
  });

  /** Its change net of the brand's prompts it didn't touch (learning B2). */
  it("says the result net of the brand's other prompts over the same days", async () => {
    getActionSignals.mockResolvedValue([]);
    render(
      <HistoryDrawer
        brandId="b1"
        item={{
          ...item,
          controlNet: {
            basis: 'topics',
            prompts: 6,
            net: [
              { metric: 'ai_visibility', net: 6, unit: 'points' },
              { metric: 'mentions', net: -12.5, unit: 'percent' },
              { metric: 'unknown_metric', net: 1, unit: 'points' },
            ],
          },
        }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(under('Result')).toMatch(
      /Net of the 6 other prompts in its topics over the same days: \S.* \+6 pts · \S.* −12\.5%$/,
    );
  });

  it('leaves the net line out when it names no metric it can show', async () => {
    getActionSignals.mockResolvedValue([]);
    render(
      <HistoryDrawer
        brandId="b1"
        item={{
          ...item,
          controlNet: {
            basis: 'brand',
            prompts: 8,
            net: [{ metric: 'unknown_metric', net: 1, unit: 'points' }],
          },
        }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(under('Result')).not.toContain('Net of');
  });

  it('says how a Site Audit fix’s pages read when audited again, or that none was yet (learning A2)', async () => {
    getActionSignals.mockResolvedValue([]);
    render(
      <HistoryDrawer
        brandId="b1"
        item={{ ...item, auditAfter: { pages: 3, audited: 2, passed: 1 } }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(under('Result')).toContain('Audited again since it closed: 1 of 2 pages pass.');

    render(
      <HistoryDrawer
        brandId="b1"
        item={{ ...item, auditAfter: { pages: 3, audited: 0, passed: 0 } }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(under('Result')).toContain(
      'None of its 3 pages was audited again since it closed: the result is from the metrics.',
    );
  });

  it('names the main metric it was judged by, and reads a mixed result (learning A4)', async () => {
    getActionSignals.mockResolvedValue([]);
    render(
      <HistoryDrawer
        brandId="b1"
        item={{ ...item, outcome: 'mixed', results: [], primaryMetric: 'citations' }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    const result = under('Result');
    expect(result).toMatch(/Judged by \S.*, its main metric\./);
    expect(result).toContain(
      'some metrics moved up and others down, or only some of its pages pass',
    );
  });

  it('says which nights tracking missed, and when too many to compare (learning A6)', async () => {
    getActionSignals.mockResolvedValue([]);
    render(
      <HistoryDrawer
        brandId="b1"
        item={{ ...item, dataGaps: { before: 1, after: 2, tooMany: false } }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(under('Result')).toContain(
      'Tracking missed 1 night of the week before it and 2 nights of the week of the latest reading: mentions and citations are counted as for a full week.',
    );

    render(
      <HistoryDrawer
        brandId="b1"
        item={{ ...item, dataGaps: { before: 0, after: 4, tooMany: true } }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(under('Result')).toContain(
      'Tracking missed 4 nights of the week of the latest reading: too many to compare mentions and citations fairly, so they are left out of the result.',
    );
  });

  it('says why a dismissed action was dismissed (learning A5)', async () => {
    getActionSignals.mockResolvedValue([]);
    render(
      <HistoryDrawer
        brandId="b1"
        item={{ ...item, status: 'dismissed', dismissReason: 'wrong_data' }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(under('Result')).toContain('Dismissed: The data behind it is wrong.');
  });

  it('lists the readings after it closed, and when the final one comes (learning B1)', async () => {
    getActionSignals.mockResolvedValue([]);
    render(
      <HistoryDrawer
        brandId="b1"
        item={{
          ...item,
          outcome: 'mixed',
          readings: [
            { day: 7, outcome: 'improved' },
            { day: 14, outcome: 'mixed' },
          ],
          outcomeFinal: false,
        }}
        onOpenChange={() => {}}
      />,
    );
    await act(async () => {});
    expect(under('Result')).toContain(
      'Read after it closed: day 7, Improved · day 14, Mixed. The final reading is on day 30.',
    );
  });

  it('says a dismissed action was not measured, not that nothing could be read', async () => {
    getActionSignals.mockResolvedValue([]);
    for (const outcome of ['not_measurable', 'pending_measurement'] as const) {
      render(
        <HistoryDrawer
          brandId="b1"
          item={{ ...item, status: 'dismissed', outcome }}
          onOpenChange={() => {}}
        />,
      );
      await act(async () => {});
      const result = under('Result');
      expect(result).toContain(
        'Not measured: it was dismissed, and only a completed action is measured.',
      );
      expect(result).not.toContain('could be read');
      expect(result).not.toContain('fill in once validation runs');
    }
  });

  it('keeps the general sentences when the signals cannot be read', async () => {
    getActionSignals.mockRejectedValue(new Error('offline'));
    render(<HistoryDrawer brandId="b1" item={item} onOpenChange={() => {}} />);
    await act(async () => {});

    expect(under('What happened?')).toContain(
      `What happened?${messages.actionCenter.actionTexts.recover_lost_citations.description}`,
    );
    expect(under('What was the goal?')).not.toBe('What was the goal?');
    expect(getPromptDemand).not.toHaveBeenCalled();
  });

  it.each([
    [1, 'Consolidated from 1 signal'],
    [3, 'Consolidated from 3 signals'],
  ])('counts %i trigger signal(s) in the right grammatical number', async (count, text) => {
    getActionSignals.mockResolvedValue([]);
    const triggerSignals = Array.from({ length: count }, (_, i) => ({
      signalId: `s${i}`,
      kind: 'lost_citations',
      detectedAt: '2026-10-09T00:00:00Z',
    }));
    render(
      <HistoryDrawer brandId="b1" item={{ ...item, triggerSignals }} onOpenChange={() => {}} />,
    );
    await act(async () => {});

    const line = [...document.querySelectorAll('p')].find((p) =>
      p.textContent?.startsWith('Consolidated from'),
    );
    expect(line?.textContent).toBe(text);
  });
});
