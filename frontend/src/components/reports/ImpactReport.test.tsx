import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ImpactReport } from '@/lib/actions/impactReport';
import type { ImpactRow } from '@/lib/impact/report';

/**
 * Reports › "What GetCito did for you" (mockup signature #f-impact): the
 * month's headline (Improved counts Medium and High verdicts only), the
 * method, outcome filters with counts, a row a change with its 7 · 14 · 30
 * · 90 day checkpoints, its evidence, Export as CSV, and the month picker
 * that never goes past this month.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/impactReport', () => ({ readImpactReport: read }));
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (pick: (s: unknown) => unknown) =>
    pick({ activeBrandId: 'brand-1', brands: [{ id: 'brand-1', name: 'Acme Coffee' }] }),
}));

const { ImpactReportView } = await import('./ImpactReport');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const row = (key: string, more: Partial<ImpactRow> = {}): ImpactRow => ({
  key,
  title: 'FAQ block on /pricing',
  kind: 'cms_publish',
  source: 'action_center',
  shippedAt: '2026-10-03T10:00:00.000Z',
  actionNo: 1241,
  by: { who: 'you', name: null },
  executionMode: 'assisted',
  targetPrompts: 6,
  pages: ['https://acme.example/pricing'],
  outcome: 'improved',
  confidence: 'high',
  checkpoint: 'd14',
  metric: 'visibility',
  before: 33.3,
  after: 83.3,
  controlBefore: 40,
  controlAfter: 40,
  effect: 50,
  direction: null,
  window: {
    preStart: '2026-09-19',
    preEnd: '2026-10-02',
    postStart: '2026-10-04',
    postEnd: '2026-10-17',
  },
  notMeasurableReason: null,
  concurrent: [],
  checkpoints: [
    {
      checkpoint: 'd7',
      state: 'measured',
      outcome: 'pending',
      effect: 33,
      direction: 'up',
      lasting: null,
      measuredAt: null,
    },
    {
      checkpoint: 'd14',
      state: 'measured',
      outcome: 'improved',
      effect: 50,
      direction: 'up',
      lasting: null,
      measuredAt: null,
    },
    { checkpoint: 'd30', state: 'due', dueOn: '2026-11-02' },
    { checkpoint: 'd90', state: 'due', dueOn: '2027-01-01' },
  ],
  ...more,
});
const report = (more: Partial<ImpactReport> = {}): ImpactReport => ({
  rows: [
    row('r1'),
    row('r2', {
      title: 'Reddit answer for “AEO tools”',
      source: 'chat',
      kind: 'third_party_observed',
      actionNo: null,
      by: { who: 'teammate', name: 'Alex Kim' },
      targetPrompts: 0,
      outcome: 'not_measurable',
      confidence: null,
      notMeasurableReason: 'too_few_controls',
      before: null,
      after: null,
      controlBefore: null,
      controlAfter: null,
      effect: null,
      checkpoints: [
        { checkpoint: 'd7', state: 'none' },
        {
          checkpoint: 'd14',
          state: 'measured',
          outcome: 'not_measurable',
          effect: null,
          direction: null,
          lasting: null,
          measuredAt: null,
        },
        { checkpoint: 'd30', state: 'none' },
        { checkpoint: 'd90', state: 'none' },
      ],
    }),
    row('r3', {
      title: 'Schema on /features',
      outcome: 'pending',
      confidence: null,
      checkpoint: 'd7',
    }),
  ],
  capped: false,
  summary: { shipped: 3, previous: 10, improved: 1, judged: 1, pending: 1 },
  traffic: { current: 120, previous: 100, pages: 2 },
  generatedAt: '2026-10-31T09:14:00.000Z',
  dataAsOf: '2026-10-31T08:00:00.000Z',
  ...more,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 31, 12, 0));
  read.mockReset().mockResolvedValue({ ok: true, report: report() });
  download.saveBlob.mockClear();
  toast.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ImpactReportView />
      </NextIntlClientProvider>,
    );
  });
}
const text = () => host.textContent ?? '';
const $ = (selector: string) => document.querySelector(selector) as HTMLElement | null;
const click = async (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });

describe('ImpactReportView', () => {
  it('reads the brand’s month in the browser’s time, as instants and as days', async () => {
    await render();
    expect(read).toHaveBeenCalledWith('brand-1', {
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 10, 1).toISOString(),
      previousFrom: new Date(2026, 8, 1).toISOString(),
      days: { from: '2026-10-01', to: '2026-11-01', previousFrom: '2026-09-01' },
    });
  });

  it('shows the month’s headline, its method and a row a change, as the mockup does', async () => {
    await render();
    expect($('h1')?.textContent).toBe('What GetCito did for you');
    expect(text()).toContain(
      'Acme Coffee · shipped actions measured against untouched similar prompts',
    );
    expect($('[data-slot="month"]')?.textContent).toBe('October 2026');
    const kpis = $('[data-slot="impact-kpis"]')!.textContent;
    expect(kpis).toContain('Actions shipped3Sep: 10');
    expect(kpis).toContain('Improved1 of 1verdict at 14 days · 1 pending');
    expect(kpis).toContain('AI traffic to changed pages+20%Google Analytics · vs September');
    expect(text()).toContain('Correlation, not causation');
    expect(
      [...document.querySelectorAll('[data-action="impact.filterOutcome"]')].map(
        (b) => b.textContent,
      ),
    ).toEqual([
      'All3',
      'Improved1',
      'Pending1',
      'No meaningful change0',
      'Declined0',
      'Not measurable1',
    ]);
    const first = $('[data-row="r1"]')!;
    expect(first.textContent).toContain('AC-1241 · Action Center · published to your CMS by you');
    expect(first.textContent).toContain('Shipped Oct 3 · 6 prompts');
    expect(first.textContent).toContain('33.3% → 83.3%');
    expect(first.textContent).toContain('40% → 40%');
    expect(first.textContent).toContain('+50 pts');
    expect(
      [...first.querySelectorAll('[data-checkpoint]')].map((c) => [
        c.getAttribute('data-state'),
        c.textContent,
      ]),
    ).toEqual([
      ['measured', '▲'],
      ['measured', '+50'],
      ['due', 'Nov 2'],
      ['due', 'Jan 1'],
    ]);
    expect($('[data-row="r2"]')!.textContent).toContain('Chat · seen in AI answers by Alex Kim');
    expect($('[data-row="r2"]')!.textContent).toContain('no tracked prompt');
    expect($('[data-row="r3"]')!.textContent).toContain('Pending · early signal');
  });

  it('filters by outcome, and says when a month has none of one', async () => {
    await render();
    await click($('[data-outcome="not_measurable"]')!);
    expect(
      [...document.querySelectorAll('[data-row]')].map((r) => r.getAttribute('data-row')),
    ).toEqual(['r2']);
    await click($('[data-outcome="declined"]')!);
    expect(text()).toContain('No actions with this outcome in October 2026.');
  });

  it('opens a change’s evidence: windows, numbers, outcome, other changes and checkpoints', async () => {
    await render();
    await click($('[data-row="r1"] [data-action="impact.openEvidence"]')!);
    const drawer = $('[data-slot="impact-evidence"]')!.textContent;
    expect(drawer).toContain('BaselineSep 19 – Oct 2 · 14 days before ship');
    expect(drawer).toContain('Target prompts6 · frozen as it shipped');
    expect(drawer).toContain('Lift vs control+50 pts');
    expect(drawer).toContain('OutcomeImproved · High confidence');
    expect(drawer).toContain('Same windowNo other shipped change on these prompts');
    expect(drawer).toContain('Day 30Confirmeddue Nov 2');
  });

  it('shows whether day 90’s effect lasted, Held or Faded, as the job kept it', async () => {
    const at90 = (lasting: 'held' | 'faded' | null) =>
      row('r1', {
        checkpoint: 'd90',
        effect: 12.5,
        checkpoints: [
          ...row('r1').checkpoints.slice(0, 2),
          {
            checkpoint: 'd30',
            state: 'measured',
            outcome: 'improved',
            effect: 14,
            direction: 'up',
            lasting: null,
            measuredAt: null,
          },
          {
            checkpoint: 'd90',
            state: 'measured',
            outcome: lasting === 'faded' ? 'no_meaningful_change' : 'improved',
            effect: 12.5,
            direction: 'up',
            lasting,
            measuredAt: null,
          },
        ],
      });
    read.mockResolvedValue({ ok: true, report: report({ rows: [at90('held')] }) });
    await render();
    const box = $('[data-row="r1"] [data-checkpoint="d90"]')!;
    expect(box.textContent).toBe('+12.5');
    expect(box.getAttribute('aria-label')).toBe('Day 90: Improved · Held');
    await click($('[data-row="r1"] [data-action="impact.openEvidence"]')!);
    const drawer = $('[data-slot="impact-evidence"]')!.textContent;
    expect(drawer).toContain('Day 90Lasting effectImproved · +12.5 pts · Held');
    // Day 30 has none to keep: only day 90 says whether it lasted.
    expect(drawer).toContain('Day 30ConfirmedImproved · +14 pts');
    expect(drawer).not.toContain('+14 pts · ');

    read.mockResolvedValue({ ok: true, report: report({ rows: [at90('faded')] }) });
    await click($('[data-action="impact.changeMonth"]')!);
    expect($('[data-row="r1"] [data-checkpoint="d90"]')!.getAttribute('aria-label')).toBe(
      'Day 90: No meaningful change · Faded',
    );

    read.mockResolvedValue({ ok: true, report: report({ rows: [at90(null)] }) });
    await click($('[data-action="impact.changeMonth"]')!);
    expect($('[data-row="r1"] [data-checkpoint="d90"]')!.getAttribute('aria-label')).toBe(
      'Day 90: Improved',
    );
  });

  it('rounds before, after, control and lift the same, so a row adds up as shown', async () => {
    read.mockResolvedValue({
      ok: true,
      report: report({
        rows: [
          row('r1', { before: 33.3, after: 50, controlBefore: 40, controlAfter: 40, effect: 16.7 }),
        ],
      }),
    });
    await render();
    const first = $('[data-row="r1"]')!.textContent;
    expect(first).toContain('33.3% → 50%');
    expect(first).toContain('40% → 40%');
    expect(first).toContain('+16.7 pts');
    await click($('[data-row="r1"] [data-action="impact.openEvidence"]')!);
    const drawer = $('[data-slot="impact-evidence"]')!.textContent;
    expect(drawer).toContain('Before33.3%');
    expect(drawer).toContain('Latest50%');
    expect(drawer).toContain('Lift vs control+16.7 pts');
  });

  it('says why a change can’t be measured', async () => {
    await render();
    await click($('[data-row="r2"] [data-action="impact.openEvidence"]')!);
    expect($('[data-slot="impact-evidence"]')!.textContent).toContain(
      'WhyNot enough similar prompts to compare.',
    );
  });

  it('says a change closed once the plan wasn’t active is why it can’t be measured (plan_inactive)', async () => {
    read.mockResolvedValue({
      ok: true,
      report: report({
        rows: [
          row('r1', {
            outcome: 'not_measurable',
            confidence: null,
            notMeasurableReason: 'plan_inactive',
          }),
        ],
      }),
    });
    await render();
    await click($('[data-row="r1"] [data-action="impact.openEvidence"]')!);
    expect($('[data-slot="impact-evidence"]')!.textContent).toContain(
      "WhyMeasuring stopped while your plan wasn't active.",
    );
  });

  it('shows no sign on a lift or a traffic change of zero', async () => {
    read.mockResolvedValue({
      ok: true,
      report: report({
        rows: [row('r1', { outcome: 'no_meaningful_change', effect: 0 })],
        traffic: { current: 100, previous: 100, pages: 1 },
      }),
    });
    await render();
    expect($('[data-row="r1"]')!.textContent).toContain('0 pts');
    expect($('[data-row="r1"]')!.textContent).not.toContain('±');
    expect($('[data-slot="impact-kpis"]')!.textContent).toContain('AI traffic to changed pages0%');
  });

  it('shows day 7 as its direction only, never points, in the table and the evidence', async () => {
    read.mockResolvedValue({
      ok: true,
      report: report({
        rows: [
          row('r1', {
            outcome: 'pending',
            confidence: null,
            checkpoint: 'd7',
            effect: null,
            direction: 'up',
            checkpoints: [
              {
                checkpoint: 'd7',
                state: 'measured',
                outcome: 'pending',
                effect: null,
                direction: 'up',
                lasting: null,
                measuredAt: null,
              },
              { checkpoint: 'd14', state: 'due', dueOn: '2026-10-17' },
              { checkpoint: 'd30', state: 'due', dueOn: '2026-11-02' },
              { checkpoint: 'd90', state: 'due', dueOn: '2027-01-01' },
            ],
          }),
        ],
      }),
    });
    await render();
    const first = $('[data-row="r1"]')!;
    expect(first.textContent).not.toContain(' pts');
    expect(first.textContent).toContain('▲Early direction: up');
    await click($('[data-row="r1"] [data-action="impact.openEvidence"]')!);
    const drawer = $('[data-slot="impact-evidence"]')!.textContent;
    expect(drawer).toContain('Lift vs controlEarly direction: up');
    expect(drawer).toContain('Day 7Pending · early signalPending · Early direction: up');
  });

  it('dates a baseline with no window kept as the job does: the 14 UTC days before the ship', async () => {
    // Late on Oct 3 in UTC is Oct 4 here: the job's baseline is still Sep 19 – Oct 2.
    const tz = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      read.mockResolvedValue({
        ok: true,
        report: report({
          rows: [row('r1', { shippedAt: '2026-10-03T22:30:00.000Z', window: null })],
        }),
      });
      await render();
      await click($('[data-row="r1"] [data-action="impact.openEvidence"]')!);
      expect($('[data-slot="impact-evidence"]')!.textContent).toContain(
        'BaselineSep 19 \u2013 Oct 2 \u00b7 14 days before ship',
      );
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('names each checkpoint box for screen readers, not only on hover', async () => {
    await render();
    const boxes = [...$('[data-row="r1"]')!.querySelectorAll('[data-checkpoint]')];
    // A name on a plain span isn't read out: each box is an image with its name.
    expect(boxes.map((b) => [b.getAttribute('role'), b.getAttribute('aria-label')])).toEqual([
      ['img', 'Day 7: Pending'],
      ['img', 'Day 14: Improved'],
      ['img', 'Day 30, due Nov 2'],
      ['img', 'Day 90, due Jan 1'],
    ]);
  });

  it('says when a month has more changes than it lists', async () => {
    await render();
    expect($('[data-slot="impact-capped"]')).toBeNull();
    read.mockResolvedValue({ ok: true, report: report({ capped: true }) });
    await click([...document.querySelectorAll('[data-action="impact.changeMonth"]')][0]);
    expect($('[data-slot="impact-capped"]')!.textContent).toBe(
      'Showing the first 3 changes shipped in September 2026; the counts above cover only these.',
    );
  });

  it('dates a change shipped near midnight the same on the page and in the CSV', async () => {
    // Late on Oct 3 in UTC is Oct 4 here: both say Oct 4, the browser's day.
    const tz = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      read.mockResolvedValue({
        ok: true,
        report: report({ rows: [row('r1', { shippedAt: '2026-10-03T22:30:00.000Z' })] }),
      });
      await render();
      expect($('[data-row="r1"]')!.textContent).toContain('Shipped Oct 4');
      await click($('[data-action="impact.export"]')!);
      await click($('[data-action="impact.exportCsv"]')!);
      const [blob] = download.saveBlob.mock.calls[0] as [Blob, string];
      const csv = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(blob);
      });
      expect(csv.split('\n')[1]).toContain(',2026-10-04,');
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('downloads the month as CSV', async () => {
    await render();
    await click($('[data-action="impact.export"]')!);
    await click($('[data-action="impact.exportCsv"]')!);
    expect(download.saveBlob).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/csv;charset=utf-8' }),
      'getcito-impact-2026-10.csv',
    );
    expect(toast).toHaveBeenCalledWith('Downloaded getcito-impact-2026-10.csv');
  });

  it('goes back a month, never past this one', async () => {
    await render();
    const [previous, next] = [...document.querySelectorAll('[data-action="impact.changeMonth"]')];
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await click(previous);
    expect($('[data-slot="month"]')?.textContent).toBe('September 2026');
    expect(read).toHaveBeenLastCalledWith(
      'brand-1',
      expect.objectContaining({
        days: { from: '2026-09-01', to: '2026-10-01', previousFrom: '2026-08-01' },
      }),
    );
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks to connect Google Analytics without its data, and says when nothing shipped', async () => {
    read.mockResolvedValue({
      ok: true,
      report: report({
        rows: [],
        summary: { shipped: 0, previous: 0, improved: 0, judged: 0, pending: 0 },
        traffic: null,
      }),
    });
    await render();
    expect(text()).toContain('Connect Google Analytics to see it');
    expect($('[data-action="integrations.connect"]')?.getAttribute('href')).toBe(
      '/dashboard/settings/integrations',
    );
    expect(text()).toContain('Nothing shipped in October 2026.');
    expect(($('[data-action="impact.export"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says it couldn’t load, and tries again', async () => {
    read.mockResolvedValueOnce({ ok: false, failure: 'failed' });
    await render();
    expect(text()).toContain("Couldn't load what GetCito did. Try again.");
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!);
    expect(read).toHaveBeenCalledTimes(2);
    expect($('[data-row="r1"]')).not.toBeNull();
  });
});
