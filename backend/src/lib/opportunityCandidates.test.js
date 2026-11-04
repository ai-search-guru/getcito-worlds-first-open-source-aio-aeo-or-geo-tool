import { describe, expect, it, vi } from 'vitest';

// The generator imports the supabase admin client, whose config exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { openCandidates } = await import('./opportunityGenerator.js');
const { openlyCoveredClusterIds } = await import('./opportunityLimits.js');

// Which clusters a run may write an opportunity for.

const cluster = (id, tested = 3) => ({ id, metrics: { tested } });
const candidates = [cluster('c1'), cluster('c2'), cluster('c3', 0)];
const covered = new Set(['c1']);
const everywhere = () => true;
const ids = (list) => list.map((c) => c.id);

describe('openCandidates', () => {
  it('skips covered clusters and clusters without answers', () => {
    expect(ids(openCandidates(candidates, { covered, inFocus: everywhere }))).toEqual(['c2']);
  });

  it("lets a prompt's own request revisit a cluster whose opportunity was dismissed (PROMPT-006)", () => {
    const inFocus = (c) => c.id === 'c1';
    const dismissed = [{ cluster_id: 'c1', related_cluster_ids: [], status: 'dismissed' }];
    const open = [{ cluster_id: 'c1', related_cluster_ids: [], status: 'new' }];
    expect(
      ids(openCandidates(candidates, { covered: openlyCoveredClusterIds(dismissed), inFocus })),
    ).toEqual(['c1']);
    expect(
      ids(openCandidates(candidates, { covered: openlyCoveredClusterIds(open), inFocus })),
    ).toEqual([]);
  });

  it("still needs answers for a prompt's own request", () => {
    const inFocus = (c) => c.id === 'c3';
    expect(ids(openCandidates(candidates, { covered: new Set(), inFocus }))).toEqual([]);
  });

  it('keeps another angle to its own cluster (CONTENT-006)', () => {
    expect(
      ids(
        openCandidates(candidates, {
          covered,
          inFocus: everywhere,
          alternativeOf: { clusterId: 'c1' },
        }),
      ),
    ).toEqual(['c1']);
  });
});
