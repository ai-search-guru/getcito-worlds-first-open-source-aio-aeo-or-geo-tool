import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { IMPROVE_PRESETS, IMPROVE_PROMPTS, suggestionRows, suggestions } =
  await import('./suggestions.js');
const { DEMO_MAX_AGE_MS } = await import('./index.js');
const { coreRows } = await import('./core.js');
const { ACTIONABLE_STATES, isKnownSource } = await import('../promptImprove.js');

/**
 * The demo brand's suggestions (demo-workflows): prompts and topics to add,
 * and Improve suggestions built from the demo's own answers.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-28T12:00:00Z');
const core = coreRows({ brandId: BRAND_ID, now: NOW });
const rows = suggestionRows({ brandId: BRAND_ID, now: NOW });

describe('suggestionRows', () => {
  it('suggests new prompts and topics under the brand’s own topics', () => {
    expect(rows.prompts).toHaveLength(8);
    expect(rows.topics).toHaveLength(3);
    const topicIds = new Set(core.topics.map((t) => t.id));
    const tracked = new Set(core.prompts.map((p) => p.text));
    for (const s of rows.prompts) {
      expect(topicIds.has(s.topic_id)).toBe(true);
      expect(tracked.has(s.suggested_text)).toBe(false);
      expect(s).toMatchObject({ brand_id: BRAND_ID, status: 'new', source: 'llm' });
      expect(s.relevance).toBeGreaterThan(0);
      expect(s.relevance).toBeLessThanOrEqual(1);
    }
    for (const t of rows.topics) {
      expect(core.topics.some((x) => x.name === t.name)).toBe(false);
    }
  });

  it('stays new until the demo is rebuilt, generated after its latest run', () => {
    for (const s of rows.prompts) {
      expect(Date.parse(s.generated_at)).toBeLessThanOrEqual(NOW.getTime());
      expect(Date.parse(s.expires_at)).toBeGreaterThan(NOW.getTime() + DEMO_MAX_AGE_MS);
    }
  });

  it('builds the Improve tab for its weakest prompts from their answers', () => {
    expect(rows.improve).toHaveLength(IMPROVE_PROMPTS.length * Object.keys(IMPROVE_PRESETS).length);
    for (const set of rows.improve) {
      const answers = core.results.filter((r) => r.prompt_id === set.prompt_id);
      expect(answers.length).toBeGreaterThan(0);
      // Not stale: built from the prompt's newest answer.
      expect(set.latest_result_at).toBe(
        answers
          .map((r) => r.created_at)
          .sort()
          .at(-1),
      );
      expect(set.region).toBe('');
      expect(set.platform_states).toHaveLength(6);
      expect(set.suggestions.length).toBeGreaterThan(0);
      for (const s of set.suggestions) {
        const state = set.platform_states.find((p) => p.id === s.platform);
        expect(ACTIONABLE_STATES).toContain(state.state);
        expect(s.sources.length).toBeGreaterThan(0);
        expect(s.title).not.toMatch(/undefined/);
      }
    }
  });

  it('cites only evidence the engine’s answers hold', () => {
    const set = rows.improve[0];
    expect(
      set.suggestions.every((s) =>
        s.sources.every((src) => typeof src.ref === 'string' && src.ref.length > 0),
      ),
    ).toBe(true);
    // Shape check on the helper the route trusts.
    expect(isKnownSource({ type: 'fanout', ref: 'x' }, { fanouts: [{ query: 'x' }] })).toBe(true);
  });
});

describe('suggestions.build', () => {
  it('writes the three tables it owns', async () => {
    const written = [];
    const db = {
      from: (table) => ({
        upsert: async (list) => {
          written.push([table, list.length]);
          return { error: null };
        },
      }),
    };
    await suggestions.build({ brandId: BRAND_ID, now: NOW, db });
    expect(written.map(([t]) => t)).toEqual(suggestions.tables);
  });
});
