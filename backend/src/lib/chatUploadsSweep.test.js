import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { logger } from './logger.js';
import { CHAT_UPLOAD_BUCKET, SWEEP_BATCH, sweepExpiredChatUploads } from './chatUploadsSweep.js';

/** Chat's attachments past their 90 days (00409): each file, then its row. */

const NOW = new Date('2026-10-30T06:00:00.000Z');

/** A fake db: the rows' expiry, the bucket's removals, and an error to answer. */
function fakeDb(rows, { removeError = null } = {}) {
  const removed = [];
  const deleted = [];
  const db = {
    removed,
    deleted,
    from: () => {
      const q = {
        before: null,
        size: Infinity,
        select: () => q,
        lt: (_col, value) => ((q.before = value), q),
        limit: (n) => ((q.size = n), q),
        delete: () => ({
          in: async (_col, ids) => {
            deleted.push(...ids);
            for (const id of ids)
              rows.splice(
                rows.findIndex((r) => r.id === id),
                1,
              );
            return { error: null };
          },
        }),
        then: (resolve) =>
          resolve({
            data: rows.filter((r) => r.expires_at < q.before).slice(0, q.size),
            error: null,
          }),
      };
      return q;
    },
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          if (removeError) return { error: { message: removeError } };
          removed.push(...paths.map((p) => `${bucket}:${p}`));
          return { error: null };
        },
      }),
    },
  };
  return db;
}

const row = (id, expiresAt) => ({ id, storage_path: `org-1/${id}`, expires_at: expiresAt });

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('sweepExpiredChatUploads', () => {
  it('deletes each expired file, then its row, and keeps the rest', async () => {
    const rows = [
      row('a', '2026-10-29T00:00:00.000Z'),
      row('b', '2026-11-30T00:00:00.000Z'),
      row('c', '2026-10-01T00:00:00.000Z'),
    ];
    const db = fakeDb(rows);
    expect(await sweepExpiredChatUploads({ db, now: NOW })).toBe(2);
    expect(db.removed).toEqual([`${CHAT_UPLOAD_BUCKET}:org-1/a`, `${CHAT_UPLOAD_BUCKET}:org-1/c`]);
    expect(db.deleted).toEqual(['a', 'c']);
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });

  it('goes a batch at a time', async () => {
    const rows = Array.from({ length: SWEEP_BATCH + 3 }, (_, i) =>
      row(`r${i}`, '2026-10-01T00:00:00.000Z'),
    );
    const db = fakeDb(rows);
    expect(await sweepExpiredChatUploads({ db, now: NOW })).toBe(SWEEP_BATCH + 3);
    expect(rows).toHaveLength(0);
  });

  it('keeps a row whose file the bucket couldn’t delete, for tomorrow, and never throws', async () => {
    const rows = [row('a', '2026-10-01T00:00:00.000Z')];
    const db = fakeDb(rows, { removeError: 'storage down' });
    expect(await sweepExpiredChatUploads({ db, now: NOW })).toBe(0);
    expect(rows).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });
});
