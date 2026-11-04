import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import type { ActionItem } from '@/lib/actions/actionCenter';
import {
  comparePriority,
  confidenceLevelOf,
  confidenceNote,
  highestPriorityLevel,
  isStale,
  parsePriorityReason,
  priorityConfidenceText,
  priorityLevelOf,
  priorityReasonText,
  storedPriorityLevel,
  topActionIds,
  type PriorityReason,
} from './priority';

const t = createTranslator({
  locale: 'en',
  messages,
  namespace: 'actionCenter.actionsPage.priority',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

const action = (over: Partial<ActionItem> = {}): ActionItem =>
  ({
    id: 'a',
    impact: 'medium',
    status: 'new',
    signalCount: 1,
    updatedAt: '2026-10-10T00:00:00Z',
    priorityScore: null,
    priorityLevel: null,
    priorityReason: null,
    ...over,
  }) as ActionItem;

const reason = (over: Partial<PriorityReason> = {}): PriorityReason => ({
  change: 'lost',
  subject: { entity: 'prompts', count: 7 },
  demand: 'high',
  commercial: true,
  heldBefore: true,
  days: 2,
  sources: 1,
  realDemand: null,
  pastSuccess: null,
  confidence: null,
  ...over,
});

describe('comparePriority', () => {
  it('puts the highest score first, and unscored actions after scored ones', () => {
    const list = [
      action({ id: 'unscored-high', impact: 'high' }),
      action({ id: 'p60', priorityScore: 60 }),
      action({ id: 'p94', priorityScore: 94 }),
    ];
    expect(list.sort(comparePriority).map((a) => a.id)).toEqual(['p94', 'p60', 'unscored-high']);
  });

  it('breaks a tie by impact, as the list did before scores', () => {
    const list = [
      action({ id: 'medium', priorityScore: 80 }),
      action({ id: 'high', priorityScore: 80, impact: 'high' }),
    ];
    expect(list.sort(comparePriority).map((a) => a.id)).toEqual(['high', 'medium']);
  });
});

describe('topActionIds', () => {
  it('names the five highest-priority open actions', () => {
    const list = [
      ...Array.from({ length: 7 }, (_, i) => action({ id: `open-${i}`, priorityScore: 50 + i })),
      action({ id: 'done', status: 'completed', priorityScore: 99 }),
    ];
    expect([...topActionIds(list)]).toEqual(['open-6', 'open-5', 'open-4', 'open-3', 'open-2']);
  });
});

describe('parsePriorityReason', () => {
  it('reads what the server stored, and drops what it does not know', () => {
    expect(
      parsePriorityReason({
        version: 1,
        change: 'lost',
        subject: { entity: 'prompts', count: 7 },
        demand: 'high',
        commercial: true,
        heldBefore: true,
        days: 2,
        sources: 2,
        factors: { impact: 1 },
      }),
    ).toEqual(reason({ sources: 2 }));
    expect(parsePriorityReason({ change: 'exploded', subject: null })).toMatchObject({
      change: null,
      subject: { entity: null, count: null },
      demand: null,
    });
    expect(parsePriorityReason(null)).toBeNull();
  });
});

describe('confidence', () => {
  it('reads the factor as a level and says why, never the bare number', () => {
    const one = parsePriorityReason({ kinds: 1, sources: 1, factors: { confidence: 0.3 } });
    expect(one?.confidence).toEqual({ level: 'low', score: 0.3, kinds: 1, sources: 1 });
    expect(priorityConfidenceText(one!.confidence!, t)).toBe(
      'Low confidence — one kind of finding from one source.',
    );
    expect(confidenceNote(one!.confidence!)).toBe('one kind of finding from one source');

    const two = parsePriorityReason({ kinds: 2, sources: 3, factors: { confidence: 0.9 } });
    expect(priorityConfidenceText(two!.confidence!, t)).toBe(
      'High confidence — 2 kinds of finding from 3 sources.',
    );
    expect(confidenceNote(two!.confidence!)).toBe('2 kinds of finding from 3 sources');
  });

  it('says when a person sent it, and is none from an older scorer', () => {
    const sent = parsePriorityReason({ kinds: 0, sources: 0, factors: { confidence: 0.6 } });
    expect(sent?.confidence?.level).toBe('medium');
    expect(priorityConfidenceText(sent!.confidence!, t)).toBe(
      'Medium confidence — rated from what it was sent with, not from detected findings.',
    );
    expect(parsePriorityReason({ factors: { impact: 1 } })?.confidence).toBeNull();
  });

  it('is High from 0.7 and Medium from 0.5', () => {
    expect([0.3, 0.45, 0.5, 0.65, 0.7, 1].map(confidenceLevelOf)).toEqual([
      'low',
      'low',
      'medium',
      'medium',
      'high',
      'high',
    ]);
  });
});

describe('isStale', () => {
  it('is a New action with the nightly stamp, never another status', () => {
    expect(isStale({ status: 'new', staleAt: '2026-10-31T03:00:00Z' })).toBe(true);
    expect(isStale({ status: 'new', staleAt: null })).toBe(false);
    expect(isStale({ status: 'new' })).toBe(false);
    expect(isStale({ status: 'in_progress', staleAt: '2026-10-31T03:00:00Z' })).toBe(false);
  });
});

describe('the age of the evidence', () => {
  it('counts the days since it was scored, so "2 days ago" stays true', () => {
    const parsed = parsePriorityReason(
      { change: 'lost', days: 2 },
      { scoredAt: '2026-10-12T06:00:00Z', now: new Date('2026-10-15T07:00:00Z') },
    );
    expect(parsed?.days).toBe(5);
  });
});

describe('priorityLevelOf', () => {
  it('reads a level from a score, as the server does', () => {
    expect([95, 80, 60, 10].map(priorityLevelOf)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it("keeps the stored level, and reads the score's when that is unknown", () => {
    expect(storedPriorityLevel('critical', 80)).toBe('critical');
    expect(storedPriorityLevel('urgent', 80)).toBe('high');
    expect(storedPriorityLevel(null, null)).toBeNull();
  });
});

describe('highestPriorityLevel', () => {
  it('names the highest level, for the summary cards', () => {
    expect(highestPriorityLevel(['medium', null, 'high', 'low'])).toBe('high');
    expect(highestPriorityLevel([null])).toBeNull();
    expect(highestPriorityLevel([])).toBeNull();
  });
});

describe('priorityReasonText', () => {
  it('says what changed, on what, when, and why it matters', () => {
    expect(priorityReasonText(reason(), t)).toBe(
      'Lost ground on 7 high-demand prompts 2 days ago — commercial intent, previously visible.',
    );
  });

  it('names high demand apart when the subject is not what is searched', () => {
    expect(
      priorityReasonText(
        reason({
          change: 'gap',
          subject: { entity: 'platforms', count: 2 },
          heldBefore: false,
          days: null,
          sources: 0,
        }),
        t,
      ),
    ).toBe('A gap to close on 2 platforms — high search demand, commercial intent.');
  });

  /** Its kind's track at the brand (learning B4), once it moved the score a point. */
  it('says how earlier actions of its kind did here', () => {
    expect(
      priorityReasonText(
        reason({ commercial: false, pastSuccess: { improved: 3, results: 4, points: 3.33 } }),
        t,
      ),
    ).toBe(
      'Lost ground on 7 high-demand prompts 2 days ago — previously visible, 3 of 4 earlier actions of this kind improved results here.',
    );
    expect(
      priorityReasonText(
        reason({ commercial: false, pastSuccess: { improved: 0, results: 1, points: -1.67 } }),
        t,
      ),
    ).toBe(
      'Lost ground on 7 high-demand prompts 2 days ago — previously visible, only 0 of 1 earlier action of this kind improved results here.',
    );
    // A point's nudge or less isn't worth a word.
    expect(
      priorityReasonText(
        reason({ commercial: false, pastSuccess: { improved: 1, results: 2, points: 0 } }),
        t,
      ),
    ).toBe('Lost ground on 7 high-demand prompts 2 days ago — previously visible.');
  });

  it('reads a stored track defensively', () => {
    expect(
      parsePriorityReason({ pastSuccess: { improved: 2, results: 3, points: 1.4 } })?.pastSuccess,
    ).toEqual({ improved: 2, results: 3, points: 1.4 });
    expect(parsePriorityReason({ pastSuccess: { improved: 2 } })?.pastSuccess).toBeNull();
    expect(parsePriorityReason({})?.pastSuccess).toBeNull();
  });

  it('counts independent sources, and says today for a fresh finding', () => {
    expect(
      priorityReasonText(
        reason({ change: 'slipping', days: 0, demand: null, commercial: false, sources: 3 }),
        t,
      ),
    ).toBe('Slipping on 7 prompts today — previously visible, confirmed by 3 sources.');
  });

  it('says so when nothing open supports the action any more', () => {
    expect(
      priorityReasonText(
        reason({ change: null, demand: null, commercial: false, heldBefore: false }),
        t,
      ),
    ).toBe('Its findings have resolved.');
  });

  it("says the prompts' measured demand level, and reads it from what was stored", () => {
    expect(priorityReasonText(reason({ realDemand: 'high' }), t)).toBe(
      'Lost ground on 7 high-demand prompts 2 days ago — measured demand High, commercial intent, previously visible.',
    );
    expect(
      priorityReasonText(
        reason({ demand: 'medium', realDemand: 'medium', commercial: false, heldBefore: false }),
        t,
      ),
    ).toBe('Lost ground on 7 prompts 2 days ago — measured demand Medium.');
    expect(parsePriorityReason({ change: 'gap', realDemand: 'medium' })?.realDemand).toBe('medium');
    expect(parsePriorityReason({ change: 'gap', realDemand: 'huge' })?.realDemand).toBeNull();
  });

  it('says both the measured demand and the track, when a reason has both', () => {
    const stored = parsePriorityReason({
      change: 'lost',
      subject: { entity: 'prompts', count: 7 },
      demand: 'high',
      heldBefore: true,
      days: 2,
      realDemand: 'high',
      pastSuccess: { improved: 3, results: 4, points: 3.33 },
    });
    expect(priorityReasonText(stored!, t)).toBe(
      'Lost ground on 7 high-demand prompts 2 days ago — measured demand High, previously visible, 3 of 4 earlier actions of this kind improved results here.',
    );
  });

  it('never gives Low as a reason: it raises nothing', () => {
    const stored = parsePriorityReason({
      change: 'dropped',
      subject: { entity: 'prompts', count: 7 },
      demand: 'medium',
      realDemand: 'low',
      days: 2,
    });
    expect(stored?.realDemand).toBeNull();
    expect(priorityReasonText(stored!, t)).not.toContain('measured demand');
  });

  it('falls back to a plain subject when the count is unknown', () => {
    expect(
      priorityReasonText(
        reason({
          change: 'issue',
          subject: { entity: null, count: null },
          demand: 'low',
          commercial: false,
          heldBefore: false,
          days: 5,
        }),
        t,
      ),
    ).toBe('A site issue 5 days ago.');
  });
});
