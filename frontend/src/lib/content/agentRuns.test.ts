import { describe, expect, it } from 'vitest';
import {
  RUN_STALE_MS,
  agentRunFrom,
  runUnderWay,
  sameRun,
  shownSteps,
  stepMessage,
} from './agentRuns';

/** The Content Agent's runs as the editor reads them (00249, CE-027/035). */
describe('agent runs', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    kind: 'fix',
    steps: [
      { key: 'read_rules', count: 4 },
      { key: 'gather_sources', count: 0 },
      { key: 'made_up', count: 1 },
      { key: 'write_changes', count: null },
    ],
    step: 9,
    started_at: '2026-10-23T10:00:00Z',
    finished_at: null,
    stopped_at: null,
    outcome: null,
    ...over,
  });

  it('reads a run, keeping the steps it can name and its step within them', () => {
    const run = agentRunFrom(row())!;
    expect(run.steps.map((s) => s.key)).toEqual(['read_rules', 'gather_sources', 'write_changes']);
    expect(run.step).toBe(3);
    expect(agentRunFrom(row({ kind: 'other' }))).toBeNull();
    expect(agentRunFrom(row({ steps: [] }))).toBeNull();
    expect(agentRunFrom(null)).toBeNull();
  });

  it('reads the rules its rules step kept small, keys only, five at most (learning B6)', () => {
    const steps = [
      { key: 'read_rules', count: 2, careful: ['faq', 3, '', 'a', 'b', 'c', 'd', 'e'] },
      { key: 'write_changes', count: null },
    ];
    expect(agentRunFrom(row({ steps }))!.steps[0].careful).toEqual(['faq', 'a', 'b', 'c', 'd']);
    expect(agentRunFrom(row())!.steps[0]).not.toHaveProperty('careful');
  });

  it('reads the live page its sources step kept in mind, whole numbers only (learning B5)', () => {
    const live = { days: 30, citations: 12, before: 20, lost: 1 };
    const steps = [
      { key: 'read_rules', count: 2 },
      { key: 'gather_sources', count: 0, live },
    ];
    expect(agentRunFrom(row({ steps }))!.steps[1].live).toEqual(live);
    const broken = [{ key: 'gather_sources', count: 0, live: { ...live, lost: -1 } }];
    expect(agentRunFrom(row({ steps: broken }))!.steps[0]).not.toHaveProperty('live');
  });

  it('is under way until it ends, or until a stopped server’s run goes stale', () => {
    const run = agentRunFrom(row())!;
    const started = Date.parse('2026-10-23T10:00:00Z');
    expect(runUnderWay(run, started + 1000)).toBe(true);
    expect(runUnderWay(run, started + RUN_STALE_MS + 1)).toBe(false);
    expect(runUnderWay(agentRunFrom(row({ finished_at: '2026-10-23T10:01:00Z' })), started)).toBe(
      false,
    );
    expect(runUnderWay(null)).toBe(false);
  });

  it('tells a read that changed nothing from one that moved on', () => {
    const run = agentRunFrom(row())!;
    expect(sameRun(run, agentRunFrom(row()))).toBe(true);
    expect(sameRun(run, agentRunFrom(row({ step: 1 })))).toBe(false);
    expect(sameRun(run, agentRunFrom(row({ stopped_at: '2026-10-23T10:00:30Z' })))).toBe(false);
    expect(sameRun(run, agentRunFrom(row({ steps: [{ key: 'read_rules', count: 5 }] })))).toBe(
      false,
    );
    expect(sameRun(run, null)).toBe(false);
    expect(sameRun(null, null)).toBe(true);
  });

  it('shows no step about data it has none of, and names each with or without its count', () => {
    const run = agentRunFrom(row())!;
    expect(shownSteps(run).map(({ step }) => step.key)).toEqual(['read_rules', 'write_changes']);
    expect(stepMessage({ key: 'read_rules', count: 4 })).toEqual({ key: 'readRules', count: 4 });
    expect(stepMessage({ key: 'write_changes', count: null })).toEqual({ key: 'writeChangesAny' });
  });
});

describe('Quality’s hand-off runs (CE-051)', () => {
  it('reads a hand-off run, its checks read first', () => {
    const run = agentRunFrom({
      id: 'run-1',
      kind: 'handoff',
      steps: [
        { key: 'read_checks', count: 6 },
        { key: 'write_changes', count: null },
      ],
      step: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
      outcome: null,
    });
    expect(run).toMatchObject({ kind: 'handoff' });
    expect(stepMessage(run!.steps[0])).toEqual({ key: 'readChecks', count: 6 });
  });
});
