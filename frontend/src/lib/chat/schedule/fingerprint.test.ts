// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Json } from '@/types/supabase';
import type { RunProgress } from '../engineStore';
import { readFingerprint, readUnchanged } from './fingerprint';

/**
 * "Notify only if the answer changed" (CHAT-12 item 20; W3-04a): what a
 * scheduled run read, fingerprinted with its times left out, so two runs
 * that read the same numbers on different days match, and a change-only
 * job stops before writing when they do. The first run always delivers.
 */

const read = (rows: Json, at = '2026-10-26T08:00:00.000Z') => ({
  tool: 'read_citations',
  input: { brand_id: 'b1', date_from: at.slice(0, 10), days: 7 },
  result: { rows, data_as_of: at, generatedAt: at, period: { start: '2026-10-19' } },
});

describe('readFingerprint', () => {
  it('matches the same numbers read on another day, and tells new numbers apart', () => {
    const monday = readFingerprint([read([{ page: '/pricing', citations: 12 }])]);
    const nextMonday = readFingerprint([
      read([{ page: '/pricing', citations: 12, seen: '2026-11-02' }], '2026-11-02T08:00:00.000Z'),
    ]);
    expect(monday).toMatch(/^[0-9a-f]{64}$/);
    expect(nextMonday).toBe(monday);
    expect(readFingerprint([read([{ page: '/pricing', citations: 13 }])])).not.toBe(monday);
  });

  it('reads keys in any order the same, and nothing as no fingerprint', () => {
    const a = readFingerprint([{ tool: 't', input: { x: 1, y: 2 }, result: { a: 1, b: 2 } }]);
    const b = readFingerprint([{ tool: 't', input: { y: 2, x: 1 }, result: { b: 2, a: 1 } }]);
    expect(a).toBe(b);
    expect(readFingerprint([])).toBeNull();
  });
});

describe('readUnchanged', () => {
  const progress = (over: Partial<RunProgress>): RunProgress =>
    ({
      phase: 'read',
      readLog: [read([{ page: '/pricing', citations: 12 }])],
      ...over,
    }) as RunProgress;

  it('stops a change-only job’s run that read what its last delivered run read', () => {
    const first = progress({ scheduled: true, changeOnly: { last: null } });
    expect(readUnchanged(first)).toBe(false);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.unchanged).toBeUndefined();

    const same = progress({ scheduled: true, changeOnly: { last: first.fingerprint ?? null } });
    expect(readUnchanged(same)).toBe(true);
    expect(same.unchanged).toBe(true);
  });

  it('keeps a fingerprint for every scheduled run, and goes on unless the job is change-only', () => {
    const plain = progress({ scheduled: true });
    expect(readUnchanged(plain)).toBe(false);
    expect(plain.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const chat = progress({});
    expect(readUnchanged(chat)).toBe(false);
    expect(chat.fingerprint).toBeUndefined();
  });
});
