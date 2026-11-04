import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

const {
  CAREFUL_MIN_DECIDED,
  CAREFUL_MIN_DRAFTS,
  CAREFUL_REJECT_SHARE,
  DECISION_WINDOW_DAYS,
  carefulLine,
  carefulRules,
} = await import('./contentSuggestionStats.js');

/** The rules a brand mostly rejects the Content Agent's suggestions for (learning B6). */

const db = (rows) => {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  return { rpc };
};

describe('carefulRules', () => {
  it('names the rules decided often enough and mostly rejected, the most rejected first', async () => {
    const reads = db([
      { rule_key: 'faq', accepted: 2, rejected: 8, drafts: 3 },
      { rule_key: 'tables', accepted: 0, rejected: 12, drafts: 4 },
      // 7 of 10: just at the share.
      { rule_key: 'dated', accepted: 3, rejected: 7, drafts: 2 },
      // Mostly taken.
      { rule_key: 'answerFirst', accepted: 9, rejected: 1, drafts: 5 },
      // Too few to tell.
      { rule_key: 'aiTraces', accepted: 0, rejected: CAREFUL_MIN_DECIDED - 1, drafts: 2 },
    ]);
    const now = new Date('2026-10-28T12:00:00Z');
    expect(await carefulRules('b1', { now, db: reads })).toEqual([
      { key: 'tables', accepted: 0, rejected: 12, drafts: 4 },
      { key: 'faq', accepted: 2, rejected: 8, drafts: 3 },
      { key: 'dated', accepted: 3, rejected: 7, drafts: 2 },
    ]);
    expect(CAREFUL_REJECT_SHARE).toBe(0.7);
    const since = new Date(now.getTime() - DECISION_WINDOW_DAYS * 86_400_000).toISOString();
    expect(reads.rpc).toHaveBeenCalledWith('content_suggestion_decisions', {
      p_brand_id: 'b1',
      p_since: since,
    });
  });

  it('takes no one Reject all for a habit: a rule decided on fewer than two drafts', async () => {
    expect(CAREFUL_MIN_DRAFTS).toBe(2);
    const reads = db([
      // Eight rejected at once on one draft.
      { rule_key: 'faq', accepted: 0, rejected: 8, drafts: 1 },
      { rule_key: 'tables', accepted: 0, rejected: 6, drafts: 2 },
    ]);
    expect((await carefulRules('b1', { db: reads })).map(({ key }) => key)).toEqual(['tables']);
  });

  it('names five at most, and throws when the decisions can’t be read', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      rule_key: `rule${i}`,
      accepted: 0,
      rejected: 10 + i,
      drafts: 2,
    }));
    expect(await carefulRules('b1', { db: db(many) })).toHaveLength(5);
    const failing = { rpc: async () => ({ data: null, error: { message: 'gone' } }) };
    await expect(carefulRules('b1', { db: failing })).rejects.toThrow('gone');
  });

  it('looks only at the rules it is given, before the five, so others never take their places', async () => {
    // Six other keys (an outside agent's suggestions can name any) rejected more.
    const many = [
      ...Array.from({ length: 6 }, (_, i) => ({
        rule_key: `other${i}`,
        accepted: 0,
        rejected: 20 + i,
        drafts: 3,
      })),
      { rule_key: 'faq', accepted: 1, rejected: 7, drafts: 2 },
      { rule_key: 'dated', accepted: 6, rejected: 1, drafts: 2 },
    ];
    expect(await carefulRules('b1', { db: db(many), keys: new Set(['faq', 'dated']) })).toEqual([
      { key: 'faq', accepted: 1, rejected: 7, drafts: 2 },
    ]);
  });
});

describe('content_suggestion_decisions (00367)', () => {
  const sql = readFileSync(
    new URL('../../../supabase/migrations/00367_content_suggestion_decisions.sql', import.meta.url),
    'utf8',
  );

  it('counts small changes only, never a whole page rewritten, and the drafts they were rejected on', () => {
    // The kinds a suggestion is (00217, 00247): every one but 'page'.
    expect(sql).toMatch(/and s\.kind in \('replace', 'insert'\)/);
    // Only the drafts with a rejection: a Reject all on one draft and an
    // Accept on another are still one draft.
    expect(sql).toMatch(
      /count\(distinct s\.draft_id\) filter \(where s\.status = 'rejected'\)::integer as drafts/,
    );
    expect(sql).toMatch(
      /returns table \(rule_key text, accepted integer, rejected integer, drafts integer\)/,
    );
  });

  it('has the API see it at once', () => {
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe('carefulLine', () => {
  it('tells the agent which rules to keep small, and nothing with none', () => {
    expect(carefulLine([{ key: 'faq', accepted: 2, rejected: 8 }])).toBe(
      "People at this brand reject most of the changes suggested for these rules: faq (8 of 10 rejected). For them, suggest a change only where the rule can't be met without it, and keep it as small as the rule allows: the fewest words, no new section.",
    );
    expect(carefulLine([])).toBe('');
  });
});
