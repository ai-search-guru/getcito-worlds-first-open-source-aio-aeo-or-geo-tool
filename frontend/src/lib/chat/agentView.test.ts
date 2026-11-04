import { describe, expect, it } from 'vitest';
import {
  agentDot,
  agentPageId,
  averageShare,
  barWidth,
  engineName,
  nextRunOf,
  outcomeCounts,
  percentOf,
  runDot,
  runMatches,
  triggerSummary,
  triggerZone,
  whenParts,
} from './agentView';

/**
 * Chat › Agents as the browser shows it (CHAT-21 §B, §C; CHAT-27 items
 * 24–25): the dot, shares as percents (never dollars), triggers in parts,
 * the next run on its schedule's clock, and times as the lists say them.
 */

describe('agentDot', () => {
  it('is green for Active, amber for Paused and grey for Draft and Archived', () => {
    expect(agentDot('active')).toBe('active');
    expect(agentDot('paused')).toBe('paused');
    expect(agentDot('draft')).toBe('idle');
    expect(agentDot('archived')).toBe('idle');
  });
});

describe('shares', () => {
  it('reads as percents of the monthly limit, never dollars', () => {
    expect(percentOf(0.032)).toBe('3.2%');
    expect(percentOf(0.1)).toBe('10%');
    expect(percentOf(0.125)).toBe('13%');
    expect(percentOf(0.0003)).toBe('<0.1%');
    expect(percentOf(0)).toBe('0%');
    expect(percentOf(Number.NaN)).toBe('0%');
    for (const share of [0.032, 0.1, 0.5]) expect(percentOf(share)).not.toContain('$');
  });

  it('fills the bar by the share, a sliver for any use, full at the limit', () => {
    expect(barWidth(0)).toBe(0);
    expect(barWidth(0.001)).toBe(2);
    expect(barWidth(0.25)).toBe(25);
    expect(barWidth(3)).toBe(100);
  });

  it('averages over the runs that spent', () => {
    expect(averageShare(0.06, 4)).toBeCloseTo(0.015);
    expect(averageShare(0.06, 0)).toBe(0);
  });
});

describe('outcomeCounts', () => {
  it('lists the outcomes that happened, Improved first', () => {
    expect(
      outcomeCounts({
        pending: 2,
        improved: 4,
        no_meaningful_change: 0,
        declined: 1,
        not_measurable: 0,
      }),
    ).toEqual([
      { outcome: 'improved', count: 4 },
      { outcome: 'pending', count: 2 },
      { outcome: 'declined', count: 1 },
    ]);
  });
});

describe('triggerSummary', () => {
  const schedule = (rrule: string) =>
    triggerSummary({
      kind: 'schedule',
      config: { type: 'recurring', rrule, timezone: 'Europe/Istanbul' },
    });

  it('reads a schedule: every day, weekdays, some days, monthly, once', () => {
    expect(schedule('FREQ=DAILY;BYHOUR=9;BYMINUTE=0')).toEqual({
      kind: 'schedule',
      repeat: 'daily',
      days: [],
      time: '09:00',
    });
    expect(schedule('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=30')).toMatchObject({
      repeat: 'weekdays',
      time: '08:30',
    });
    expect(schedule('FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0')).toEqual({
      kind: 'schedule',
      repeat: 'days',
      days: ['MO'],
      time: '07:00',
    });
    expect(schedule('FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=18;BYMINUTE=0')).toEqual({
      kind: 'schedule',
      repeat: 'monthly',
      monthDay: -1,
      time: '18:00',
    });
    expect(
      triggerSummary({ kind: 'schedule', config: { type: 'once', at: '2026-11-02T06:00:00Z' } }),
    ).toEqual({ kind: 'schedule', repeat: 'once', at: '2026-11-02T06:00:00Z' });
    expect(schedule('FREQ=HOURLY')).toEqual({ kind: 'schedule', repeat: 'unknown' });
  });

  it('reads a Signal, a KPI and a watch rule as they are kept', () => {
    expect(
      triggerSummary({
        kind: 'signal',
        config: { category: 'recover', definition_ids: ['citation_lost'] },
      }),
    ).toEqual({ kind: 'signal', category: 'recover', definitions: 1 });
    expect(
      triggerSummary({
        kind: 'kpi',
        config: {
          kpi: 'citations',
          direction: 'down',
          threshold: 10,
          unit: 'percent',
          period: 'week',
        },
      }),
    ).toEqual({
      kind: 'kpi',
      kpi: 'citations',
      direction: 'down',
      threshold: 10,
      unit: 'percent',
      period: 'week',
    });
    expect(triggerSummary({ kind: 'watch_rule', config: { watch_rule_id: 'x' } })).toEqual({
      kind: 'watch_rule',
    });
  });
});

describe('nextRunOf', () => {
  const weekly = (nextFireAt: string, enabled = true, timezone = 'Europe/Istanbul') => ({
    kind: 'schedule' as const,
    config: { type: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0', timezone },
    enabled,
    nextFireAt,
  });

  it('takes the soonest switched-on schedule with its zone, else an event trigger, else Run now only', () => {
    expect(
      nextRunOf([
        weekly('2026-11-03T06:00:00Z'),
        weekly('2026-11-02T04:00:00Z', true, 'Asia/Tokyo'),
        weekly('2026-11-01T06:00:00Z', false),
      ]),
    ).toEqual({ kind: 'at', at: '2026-11-02T04:00:00Z', zone: 'Asia/Tokyo' });
    expect(
      nextRunOf([
        {
          kind: 'schedule',
          config: { type: 'once', at: '2026-11-02T06:00:00Z' },
          enabled: true,
          nextFireAt: '2026-11-02T06:00:00Z',
        },
      ]),
    ).toEqual({ kind: 'at', at: '2026-11-02T06:00:00Z', zone: null });
    expect(nextRunOf([{ kind: 'signal', config: {}, enabled: true, nextFireAt: null }])).toEqual({
      kind: 'event',
    });
    expect(nextRunOf([{ kind: 'signal', config: {}, enabled: false, nextFireAt: null }])).toEqual({
      kind: 'manual',
    });
  });

  it("reads a recurring schedule's zone, and none for a one-off or an event trigger", () => {
    expect(triggerZone(weekly('2026-11-02T04:00:00Z'))).toBe('Europe/Istanbul');
    expect(triggerZone({ kind: 'schedule', config: { type: 'once', at: 'x' } })).toBeNull();
    expect(triggerZone({ kind: 'kpi', config: { timezone: 'UTC' } })).toBeNull();
  });
});

describe('whenParts', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  it('says Today, Yesterday, Tomorrow, a weekday within 6 days, else the date', () => {
    expect(whenParts('2026-10-30T09:14:00Z', now, 'UTC')).toMatchObject({
      kind: 'today',
      time: '09:14',
    });
    expect(whenParts('2026-10-29T23:00:00Z', now, 'UTC').kind).toBe('yesterday');
    expect(whenParts('2026-10-31T07:00:00Z', now, 'UTC').kind).toBe('tomorrow');
    expect(whenParts('2026-11-02T07:00:00Z', now, 'UTC')).toMatchObject({
      kind: 'week',
      weekday: 'Mon',
    });
    expect(whenParts('2026-10-19T07:00:00Z', now, 'UTC')).toMatchObject({
      kind: 'date',
      date: 'Oct 19',
    });
    expect(whenParts('2025-10-19T07:00:00Z', now, 'UTC').date).toBe('Oct 19, 2025');
  });

  it('counts days in the zone shown', () => {
    // 23:30 UTC on Oct 30 is already Oct 31 in Istanbul.
    expect(whenParts('2026-10-30T23:30:00Z', now, 'Europe/Istanbul').kind).toBe('tomorrow');
  });
});

describe('runs', () => {
  it('maps a run state to its dot', () => {
    expect(runDot('running')).toBe('running');
    expect(runDot('needs_you')).toBe('needsYou');
    expect(runDot('done')).toBe('done');
    expect(runDot('stopped')).toBe('failed');
    expect(runDot('paused_cap')).toBe('paused');
    expect(runDot('queued')).toBe('idle');
  });

  it('filters by outcome, and Stopped takes failed runs too', () => {
    expect(runMatches({ status: 'done', outcome: 'improved' }, 'improved')).toBe(true);
    expect(runMatches({ status: 'done', outcome: 'pending' }, 'improved')).toBe(false);
    expect(runMatches({ status: 'failed', outcome: null }, 'stopped')).toBe(true);
    expect(runMatches({ status: 'done', outcome: null }, 'all')).toBe(true);
  });
});

describe('names and ids', () => {
  it('names an engine by its label, else by its id', () => {
    expect(engineName('perplexity-web')).toBe('Perplexity');
    expect(engineName('something-else')).toBe('something-else');
  });

  it("takes only an agent's id from the address", () => {
    expect(agentPageId('aaaaaaaa-0000-4000-8000-000000000001')).toBe(
      'aaaaaaaa-0000-4000-8000-000000000001',
    );
    expect(agentPageId('new')).toBeNull();
  });
});
