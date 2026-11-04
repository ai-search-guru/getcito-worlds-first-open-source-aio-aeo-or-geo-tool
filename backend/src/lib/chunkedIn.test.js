import { describe, expect, it, vi } from 'vitest';
import { IN_FILTER_CHUNK, chunkIds, selectInChunks } from './chunkedIn.js';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (count) => Array.from({ length: count }, (_, i) => uuid(i));

/** What PostgREST puts on the wire for `.in(column, chunk)`. */
function inFilterLength(chunk) {
  return `prompt_id=in.%28${chunk.map(encodeURIComponent).join('%2C')}%29`.length;
}

describe('chunkIds', () => {
  it('splits at the chunk boundary', () => {
    expect(chunkIds(ids(250), 100).map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it('returns no chunks for an empty list', () => {
    expect(chunkIds([])).toEqual([]);
  });

  it('keeps a list that already fits in one chunk', () => {
    expect(chunkIds(ids(4), 100)).toEqual([ids(4)]);
  });

  it('drops duplicates so a repeated id is not queried twice', () => {
    expect(chunkIds([uuid(1), uuid(2), uuid(1)], 100)).toEqual([[uuid(1), uuid(2)]]);
  });
});

describe('IN_FILTER_CHUNK', () => {
  /**
   * The regression this whole module exists for: 402 ids in one filter built a
   * 15,792-character request that the edge rejected about a quarter of the
   * time. A chunk has to stay far enough under that to be uncontroversial.
   */
  it('keeps one request well under the size that was being rejected', () => {
    expect(inFilterLength(ids(IN_FILTER_CHUNK))).toBeLessThan(8_000);
  });

  it('would have split the request that failed', () => {
    expect(chunkIds(ids(402)).length).toBeGreaterThan(1);
  });
});

describe('selectInChunks', () => {
  it('issues one query per chunk and concatenates the rows', async () => {
    const buildQuery = vi.fn(async (chunk) => ({
      data: chunk.map((id) => ({ id })),
      error: null,
    }));

    const { data, error } = await selectInChunks(ids(250), buildQuery, 100);

    expect(error).toBeNull();
    expect(buildQuery).toHaveBeenCalledTimes(3);
    expect(data).toHaveLength(250);
    expect(data[0]).toEqual({ id: uuid(0) });
    expect(data[249]).toEqual({ id: uuid(249) });
  });

  it('never queries for an empty id list', async () => {
    const buildQuery = vi.fn();

    const { data, error } = await selectInChunks([], buildQuery);

    expect(buildQuery).not.toHaveBeenCalled();
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it('reports the first failing chunk instead of returning partial rows', async () => {
    const buildQuery = vi.fn(async (chunk) =>
      chunk.includes(uuid(150))
        ? { data: null, error: { message: 'boom' } }
        : { data: chunk.map((id) => ({ id })), error: null },
    );

    const { data, error } = await selectInChunks(ids(250), buildQuery, 100);

    expect(data).toBeNull();
    expect(error).toEqual({ message: 'boom' });
  });

  it('keeps each id and the rows belonging to it in one chunk', async () => {
    // Callers group by id and rely on `.order(...)` holding within a group.
    // That only works because an id is never split across two requests.
    const seen = [];
    const buildQuery = async (chunk) => {
      seen.push(chunk);
      return {
        data: chunk.flatMap((id) => [
          { id, at: 'newer' },
          { id, at: 'older' },
        ]),
        error: null,
      };
    };

    const { data } = await selectInChunks(ids(250), buildQuery, 100);

    const chunksHolding = (id) => seen.filter((chunk) => chunk.includes(id)).length;
    expect(chunksHolding(uuid(99))).toBe(1);
    expect(chunksHolding(uuid(100))).toBe(1);

    const rowsFor = data.filter((row) => row.id === uuid(100));
    expect(rowsFor.map((row) => row.at)).toEqual(['newer', 'older']);
  });
});
