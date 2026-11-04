import { beforeEach, describe, expect, it, vi } from 'vitest';

// PROMPT-006 "Suggest content": a prompt gets a new content opportunity only
// when nothing open answers it already.

const calls = [];
const results = {};
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, ops: [] };
      calls.push(call);
      const b = new Proxy(
        {},
        {
          get: (_t, op) => {
            if (op === 'then') return (resolve) => resolve(results[table]);
            if (op === 'maybeSingle') return () => Promise.resolve(results[table]);
            return (...args) => {
              call.ops.push([op, ...args]);
              return b;
            };
          },
        },
      );
      return b;
    },
  },
}));

const { openOpportunityForPrompt, promptSuggestionRequest, runningSuggestionJob } =
  await import('./promptContentSuggestion.js');
const { OPEN_OPPORTUNITY_STATUSES } = await import('./opportunityLimits.js');

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
});

describe('openOpportunityForPrompt', () => {
  it("finds an open opportunity on the prompt's cluster or for the prompt itself", async () => {
    results.prompt_cluster_members = { data: { cluster_id: 'c1' }, error: null };
    results.content_opportunities = { data: [{ id: 'o1' }], error: null };
    expect(await openOpportunityForPrompt('b1', 'p1')).toBe('o1');
    const opps = calls.find((c) => c.table === 'content_opportunities');
    expect(opps.ops).toContainEqual(['in', 'status', OPEN_OPPORTUNITY_STATUSES]);
    expect(opps.ops).toContainEqual([
      'or',
      'prompt_id.eq.p1,cluster_id.eq.c1,related_cluster_ids.cs.{c1}',
    ]);
  });

  it('looks only at the prompt itself before it is grouped', async () => {
    results.prompt_cluster_members = { data: null, error: null };
    results.content_opportunities = { data: [], error: null };
    expect(await openOpportunityForPrompt('b1', 'p1')).toBeNull();
    const opps = calls.find((c) => c.table === 'content_opportunities');
    expect(opps.ops).toContainEqual(['eq', 'prompt_id', 'p1']);
  });
});

describe('runningSuggestionJob', () => {
  it('finds a job for the prompt that is still queued or running', async () => {
    results.jobs = { data: [{ id: 'j1' }], error: null };
    expect(await runningSuggestionJob('b1', 'p1')).toBe('j1');
    const jobs = calls.find((c) => c.table === 'jobs');
    expect(jobs.ops).toContainEqual(['in', 'status', ['waiting', 'active']]);
    expect(jobs.ops).toContainEqual(['eq', 'data->request->>promptId', 'p1']);
    // "+ New" focused on the prompt counts too, not only earlier suggestions.
    expect(jobs.ops.some(([, column]) => column === 'data->request->>source')).toBe(false);
  });

  it('is null when nothing is being written for the prompt', async () => {
    results.jobs = { data: [], error: null };
    expect(await runningSuggestionJob('b1', 'p1')).toBeNull();
  });
});

describe('promptSuggestionRequest', () => {
  it('asks for exactly one opportunity on the prompt, tagged prompt', () => {
    expect(promptSuggestionRequest('p1', 'key-123456')).toEqual({
      count: 1,
      promptId: 'p1',
      explicit: true,
      source: 'prompt',
      idempotencyKey: 'key-123456',
    });
  });
});
