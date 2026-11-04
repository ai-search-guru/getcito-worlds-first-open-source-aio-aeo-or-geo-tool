import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBotConnections,
  getTrafficPageCounts,
  getTrafficPages,
  getUntrackedGoogleQueries,
  getUntrackedQueryCount,
} from './trafficReads';

/** The AI Traffic page's reads from the browser: one POST each, run side by side. */

const BRAND = '33333333-3333-3333-3333-333333333333';
const WEEK = { dateFrom: '2026-10-12T00:00:00.000Z', dateTo: '2026-10-19T00:00:00.000Z' };
const fetchMock = vi.fn();
const answer = (status: number, body: unknown) => ({ ok: status < 300, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('traffic reads', () => {
  it('posts the read and its arguments, and returns its data', async () => {
    fetchMock.mockResolvedValue(answer(200, { data: { counts: { all: 3 }, rows: [] } }));
    expect(await getTrafficPages(BRAND, WEEK, { tab: 'all', limit: 10 })).toEqual({
      counts: { all: 3 },
      rows: [],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/traffic/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: 'pages', args: [BRAND, WEEK, { tab: 'all', limit: 10 }] }),
    });
  });

  it("doesn't wait for one read before sending the next", async () => {
    let release = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(answer(200, { data: 1 })))),
    );
    fetchMock.mockResolvedValueOnce(answer(200, { data: { connections: [] } }));
    const first = getTrafficPages(BRAND, WEEK, { tab: 'all' });
    const second = getBotConnections(BRAND);
    expect(await second).toEqual({ connections: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release();
    expect(await first).toBe(1);
  });

  it('throws when the read failed', async () => {
    fetchMock.mockResolvedValue(answer(500, { error: 'Failed to load' }));
    await expect(getTrafficPages(BRAND, WEEK, { tab: 'all' })).rejects.toThrow('Failed to load');
  });
});

// gkhngyk on #1216: the summary line's counts repeated the Pages card's and
// the Google section's reads on every range change.
describe('counts another read carries', () => {
  const pages = { counts: { noAiTraffic: 1, citedNotClicked: 4, trafficNoPrompt: 0, all: 5 } };
  const MONTH = { dateFrom: '2026-09-19T00:00:00.000Z', dateTo: '2026-10-19T00:00:00.000Z' };

  it("takes the Pages card's read for the same range, sent in the same turn", async () => {
    fetchMock.mockResolvedValue(answer(200, { data: { ...pages, rows: [] } }));
    const count = getTrafficPageCounts(BRAND, MONTH);
    void getTrafficPages(BRAND, MONTH, { tab: 'all', limit: 10 });
    expect(await count).toEqual(pages.counts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the count on its own when no section read the range', async () => {
    fetchMock.mockResolvedValue(answer(200, { data: { ...pages, rows: [] } }));
    const range = { dateFrom: '2026-08-01T00:00:00.000Z', dateTo: '2026-08-08T00:00:00.000Z' };
    expect(await getTrafficPageCounts(BRAND, range)).toEqual(pages.counts);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/traffic/read',
      expect.objectContaining({
        body: JSON.stringify({
          read: 'pages',
          args: [BRAND, range, { tab: 'citedNotClicked', limit: 0 }],
        }),
      }),
    );
  });

  it("takes the untracked total from the Google section's list, not a failed one", async () => {
    const range = { dateFrom: '2026-07-01T00:00:00.000Z', dateTo: '2026-07-08T00:00:00.000Z' };
    fetchMock.mockResolvedValueOnce(answer(500, { error: 'boom' }));
    await getUntrackedGoogleQueries(BRAND, range).catch(() => null);
    fetchMock.mockResolvedValue(answer(200, { data: { count: 7, capped: true, rows: [] } }));
    // The failed list isn't shared: the count reads on its own.
    expect(await getUntrackedQueryCount(BRAND, range)).toEqual({ count: 7, capped: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockClear();
    const count = getUntrackedQueryCount(BRAND, MONTH);
    void getUntrackedGoogleQueries(BRAND, MONTH);
    expect(await count).toEqual({ count: 7, capped: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
