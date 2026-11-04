import { describe, expect, it } from 'vitest';
import {
  formatChange,
  gscSignalState,
  paidSignalState,
  questionKey,
  type PromptDemand,
} from './promptDemand';

/** What each Demand card shows when its signal isn't there (PROMPT-014). */

const demand = (over: Partial<PromptDemand> = {}): PromptDemand => ({
  level: null,
  signals: 0,
  updatedAt: null,
  keyword: null,
  locationCode: null,
  languageCode: null,
  gsc: null,
  trends: null,
  paa: null,
  youtube: null,
  pending: { trends: false, paa: false, youtube: false },
  hasVolume: true,
  hasKeyword: true,
  paidSignals: true,
  ...over,
});

describe('paidSignalState', () => {
  it('shows data first, then a task being read, then what is missing', () => {
    const paa = { questions: [], at: '2026-10-27T12:00:00Z' };
    expect(paidSignalState(demand({ paa, hasVolume: false }), 'paa')).toBe('data');
    expect(
      paidSignalState(demand({ pending: { trends: false, paa: true, youtube: false } }), 'paa'),
    ).toBe('pending');
    expect(paidSignalState(demand({ hasVolume: false, hasKeyword: false }), 'paa')).toBe(
      'noVolume',
    );
    expect(paidSignalState(demand({ hasKeyword: false }), 'trends')).toBe('noKeyword');
    expect(paidSignalState(demand({ paidSignals: false }), 'youtube')).toBe('off');
    expect(paidSignalState(demand(), 'youtube')).toBe('notRead');
  });
});

describe('gscSignalState', () => {
  it("shows what was read whatever the source's state, else the state", () => {
    const gsc = { impressions: 1, clicks: 0, queries: 1, top: null, at: '2026-10-27T12:00:00Z' };
    expect(gscSignalState(demand({ gsc }), 'not_connected')).toBe('data');
    expect(gscSignalState(demand(), 'not_connected')).toBe('not_connected');
    expect(gscSignalState(demand(), 'unmapped')).toBe('unmapped');
    expect(gscSignalState(demand(), 'connected')).toBe('notRead');
    expect(gscSignalState(demand(), null)).toBe('notRead');
  });
});

describe('formatChange', () => {
  it('signs the change', () => {
    expect(formatChange(64)).toBe('+64%');
    expect(formatChange(-12)).toBe('−12%');
    expect(formatChange(0)).toBe('0%');
  });
});

describe('questionKey', () => {
  it('reads the same question written differently as one, as the server does', () => {
    expect(questionKey('How do I track my brand in ChatGPT?')).toBe(
      'how do i track my brand in chatgpt',
    );
    expect(questionKey('  how do I  track my brand in CHATGPT ')).toBe(
      'how do i track my brand in chatgpt',
    );
    expect(questionKey('Café-crème: what is it?')).toBe('cafe creme what is it');
    expect(questionKey('What is AI search?')).not.toBe(
      questionKey('What is AI search monitoring?'),
    );
  });
});
