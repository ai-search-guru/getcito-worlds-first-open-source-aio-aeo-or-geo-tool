import { describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));

import {
  normalizeTokens,
  isCoveredByPrompts,
  classifyCandidate,
  composeCandidates,
  MAX_CANDIDATES,
} from './gscSuggestions.js';

describe('normalizeTokens', () => {
  it('lowercases, strips punctuation, and drops stopwords', () => {
    expect(normalizeTokens('How to improve ChatGPT visibility?')).toEqual([
      'improve',
      'chatgpt',
      'visibility',
    ]);
  });

  it('keeps unicode letters (non-English queries)', () => {
    expect(normalizeTokens('yapay zekâ görünürlük aracı')).toEqual([
      'yapay',
      'zekâ',
      'görünürlük',
      'aracı',
    ]);
  });
});

describe('isCoveredByPrompts', () => {
  const prompts = ['What are the best AI visibility tracking tools?'];

  it('marks a query covered when its tokens appear in a tracked prompt', () => {
    expect(isCoveredByPrompts('ai visibility tracking tool', prompts)).toBe(true);
  });

  it('leaves genuinely untracked intents open', () => {
    expect(isCoveredByPrompts('how to improve chatgpt visibility', prompts)).toBe(false);
  });

  it('treats stopword-only queries as covered (nothing to track)', () => {
    expect(isCoveredByPrompts('how to do the best', prompts)).toBe(true);
  });
});

describe('classifyCandidate', () => {
  it('flags traffic-earning queries as protect_traffic', () => {
    expect(classifyCandidate({ impressions: 500, clicks: 40 })).toBe('protect_traffic');
  });

  it('flags high-impression zero-click queries as capture_demand', () => {
    expect(classifyCandidate({ impressions: 400, clicks: 1 })).toBe('capture_demand');
  });

  it('returns null when neither rationale applies', () => {
    expect(classifyCandidate({ impressions: 50, clicks: 3 })).toBeNull();
  });
});

describe('composeCandidates', () => {
  const row = (query, impressions, clicks = 0) => ({
    query,
    impressions,
    clicks,
    avg_position: 12.34,
  });

  it('filters covered queries and keeps head demand ordered by impressions', () => {
    const rows = [
      row('ai visibility tracking tool', 900, 20), // covered → dropped
      row('answer engine optimization guide', 800, 30),
      row('llm brand monitoring pricing', 300),
    ];
    const out = composeCandidates(rows, ['What are the best AI visibility tracking tools?']);
    expect(out.map((c) => c.query)).toEqual([
      'answer engine optimization guide',
      'llm brand monitoring pricing',
    ]);
    expect(out[0].badge).toBe('protect_traffic');
    expect(out[0].avgPosition).toBe(12.3);
  });

  it('excludes recently dismissed queries (normalized) so they cannot resurrect', () => {
    const rows = [row('answer engine optimization guide', 800), row('llm monitoring pricing', 300)];
    const excluded = new Set(['answer engine optimization guide']);
    const out = composeCandidates(rows, [], excluded);
    expect(out.map((c) => c.query)).toEqual(['llm monitoring pricing']);
    // Matching is case/whitespace-insensitive on the candidate side too.
    const out2 = composeCandidates([row('  Answer Engine Optimization Guide ', 800)], [], excluded);
    expect(out2).toEqual([]);
  });

  it('adds a long-tail slice beyond the head without duplicates', () => {
    const rows = [];
    for (let i = 0; i < 12; i++) rows.push(row(`headterm${i} tools`, 1000 - i));
    rows.push(row('how does answer engine optimization work for startups', 15));
    const out = composeCandidates(rows, []);
    expect(out.length).toBeLessThanOrEqual(MAX_CANDIDATES);
    expect(out.some((c) => c.query.startsWith('how does answer engine'))).toBe(true);
    // Short or too-quiet tail rows don't make the long-tail slice.
    const out2 = composeCandidates([...rows, row('tiny query', 15)], []);
    expect(out2.some((c) => c.query === 'tiny query')).toBe(false);
  });

  it('keeps quiet rows out of the head but lets long-tail ones through', () => {
    // A small site: one head query, everything else between the long-tail
    // floor (10) and the head floor (30) — what the RPC now returns.
    const rows = [
      row('consultancy official website', 2900),
      row('who to hire first for go to market', 22),
      row('outbound stopped working', 18), // 3 words → not long-tail
      row('gtm diagnostic', 12), // 2 words, below head floor → dropped
    ];
    const out = composeCandidates(rows, []);
    expect(out.map((c) => c.query)).toEqual([
      'consultancy official website',
      'who to hire first for go to market',
    ]);
  });
});
