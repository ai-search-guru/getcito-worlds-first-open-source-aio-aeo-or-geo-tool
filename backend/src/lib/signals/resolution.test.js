import { describe, expect, it, vi } from 'vitest';

// record.js and detect.js reach the admin client at import time, whose config
// hard-exits without SUPABASE_* env (as in CI). Nothing here reads it.
vi.mock('../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../pulse/metrics.js', () => ({
  computePulseMetrics: vi.fn(),
  isTransientDbError: () => false,
}));

import { KIND_META, overflowRefreshes, signalsToResolve } from './record.js';
import { EXCLUSIVE_KIND_GROUPS } from './library/kinds.js';
import { cap } from './library/detect.js';
import { ENGINE_THRESHOLDS } from '../../config/actionEngine.js';

const max = ENGINE_THRESHOLDS.library.maxSignalsPerKind;
const KIND = 'competitor_cited_source';

const finding = (i) => ({ kind: KIND, dedupKey: `${KIND}:d${i}`, currentValue: 100 - i });
const NOW = new Date('2026-09-29T03:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
const GRACE = ENGINE_THRESHOLDS.library.resolveAfterHours;
// Last seen two nights ago by default: past the grace window, so a test about
// something else is not quietly passing because of it.
const row = (i, status = 'new', over = {}) => ({
  id: `s${i}`,
  kind: KIND,
  dedup_key: `${KIND}:d${i}`,
  status,
  last_detected_at: hoursAgo(48),
  ...over,
});
const closing = (existing, detected, unread = new Set()) =>
  signalsToResolve(existing, detected, unread, { now: NOW, graceHours: GRACE });
const resolvedIds = (result) => result.resolved.map((r) => r.id);

describe('the per-kind cap', () => {
  const found = Array.from({ length: max + 2 }, (_, i) => finding(i));
  const capped = cap(found, (x) => x.currentValue);

  it('keeps the strongest findings as signals', () => {
    expect(capped.filter((x) => !x.overflow).map((x) => x.dedupKey)).toEqual(
      found.slice(0, max).map((x) => x.dedupKey),
    );
  });

  /** Dropping them would make "not in the top five" read as "not there". */
  it('marks the rest instead of dropping them', () => {
    expect(capped.filter((x) => x.overflow).map((x) => x.dedupKey)).toEqual(
      found.slice(max).map((x) => x.dedupKey),
    );
  });
});

describe('which signals a night closes', () => {
  /**
   * The failure this guards: a second pass the same night reranked sources,
   * and every signal that slipped from fifth to sixth was closed as solved
   * while the problem it described was still there.
   */
  it('does not close a signal whose finding only moved down the ranking', () => {
    const existing = [row(0), row(5)];
    const result = closing(existing, [finding(0), finding(5)]);
    expect(result).toEqual({ superseded: [], resolved: [] });
  });

  it('closes one whose finding has been gone past the grace window', () => {
    const existing = [row(0), row(9)];
    expect(resolvedIds(closing(existing, [finding(0)]))).toEqual(['s9']);
  });

  /**
   * The second failure: a source at 21 results against a threshold of 20
   * dipped to 19 for a night, was closed, and reopened the next morning — 64
   * of one night's 74 closures had lived a single night.
   */
  it('keeps a signal open through one quiet night', () => {
    const existing = [row(9, 'new', { last_detected_at: hoursAgo(24) })];
    expect(closing(existing, [])).toEqual({ superseded: [], resolved: [] });
  });

  it('closes it once the grace window has passed', () => {
    const existing = [row(9, 'new', { last_detected_at: hoursAgo(GRACE + 1) })];
    expect(resolvedIds(closing(existing, []))).toEqual(['s9']);
  });

  it('does not close a kind whose detector failed tonight', () => {
    expect(closing([row(9)], [], new Set([KIND]))).toEqual({ superseded: [], resolved: [] });
  });

  it('leaves signals someone already closed alone', () => {
    expect(closing([row(9, 'dismissed'), row(8, 'resolved')], [])).toEqual({
      superseded: [],
      resolved: [],
    });
  });
});

describe('a subject that changed kind', () => {
  const topic = (kind, over = {}) => ({
    id: kind,
    kind,
    dedup_key: `${kind}:topic-1`,
    status: 'new',
    last_detected_at: hoursAgo(24),
    ...over,
  });
  const found = (kind, subject = 'topic-1') => ({ kind, dedupKey: `${kind}:${subject}` });

  /** A worsening is not a resolution, and one topic should not be listed
   *  twice. Closed at once — no grace — naming its successor. */
  it('is superseded by its successor, straight away', () => {
    const result = closing([topic('topic_slipping')], [found('topic_drop')]);
    expect(result.superseded).toEqual([{ row: topic('topic_slipping'), by: 'topic_drop' }]);
    expect(result.resolved).toEqual([]);
  });

  it('is not superseded by the same kind on another subject', () => {
    const result = closing([topic('topic_slipping')], [found('topic_drop', 'topic-2')]);
    expect(result).toEqual({ superseded: [], resolved: [] });
  });

  /** A competitor can lead and gain at once; one appearing is not the other
   *  ending. */
  it('is not superseded by a kind outside its exclusive group', () => {
    const lead = {
      id: 'm',
      kind: 'competitor_momentum',
      dedup_key: 'competitor_momentum:c1',
      status: 'new',
      last_detected_at: hoursAgo(24),
    };
    const result = closing([lead], [{ kind: 'competitor_leads', dedupKey: 'competitor_leads:c1' }]);
    expect(result).toEqual({ superseded: [], resolved: [] });
  });

  it('applies to the source classes too', () => {
    const source = {
      id: 'x',
      kind: 'third_party_presence_gap',
      dedup_key: 'third_party_presence_gap:example.com',
      status: 'acknowledged',
      last_detected_at: hoursAgo(24),
    };
    const result = closing(
      [source],
      [{ kind: 'competitor_cited_source', dedupKey: 'competitor_cited_source:example.com' }],
    );
    expect(result.superseded.map((s) => s.by)).toEqual(['competitor_cited_source']);
  });
});

describe('the exclusive kind groups', () => {
  it('name only kinds that exist, each in one group', () => {
    const seen = new Set();
    for (const group of EXCLUSIVE_KIND_GROUPS) {
      for (const kind of group) {
        expect({ kind, known: Boolean(KIND_META[kind]) }).toEqual({ kind, known: true });
        expect({ kind, repeated: seen.has(kind) }).toEqual({ kind, repeated: false });
        seen.add(kind);
      }
    }
  });
});

describe('what an over-cap finding writes', () => {
  const existing = (rows) => new Map(rows.map((r) => [r.dedup_key, r]));

  it('refreshes the open signal it keeps open', () => {
    const refreshes = overflowRefreshes([finding(5)], existing([row(5, 'acknowledged')]));
    expect(refreshes.map((r) => r.current.id)).toEqual(['s5']);
  });

  /** The cap bounds what a night writes; the overflow must not get around it. */
  it('raises nothing new', () => {
    expect(overflowRefreshes([finding(5)], existing([]))).toEqual([]);
  });

  /** It comes back when it ranks again, as a new observation. */
  it('does not reopen a closed one', () => {
    expect(overflowRefreshes([finding(5)], existing([row(5, 'resolved')]))).toEqual([]);
    expect(overflowRefreshes([finding(5)], existing([row(5, 'dismissed')]))).toEqual([]);
  });
});
