import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditedPage } from '@/lib/actions/audits';

const getAuditPages = vi.fn();
vi.mock('@/lib/actions/audits', () => ({
  getAuditPages: (...args: unknown[]) => getAuditPages(...args),
}));

const { readAllPages } = await import('./_usePagesExport');

const page = (key: string) => ({ key }) as AuditedPage;
const keys = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => page(`p${from + i}`));

beforeEach(() => getAuditPages.mockReset());

describe('readAllPages', () => {
  it('reads the list 100 pages at a time and keeps a page repeated at a boundary once', async () => {
    getAuditPages
      .mockResolvedValueOnce({ pages: keys(0, 100), total: 230 })
      // A page audited meanwhile moved to the top: p99 comes again.
      .mockResolvedValueOnce({ pages: keys(99, 199), total: 230 })
      .mockResolvedValueOnce({ pages: keys(199, 230), total: 230 });

    const all = await readAllPages('b1');

    expect(getAuditPages.mock.calls.map((c) => c[1])).toEqual([0, 100, 200]);
    expect(all).toHaveLength(230);
    expect(new Set(all.map((p) => p.key)).size).toBe(230);
  });

  it('moves on even when a whole page repeats', async () => {
    getAuditPages
      .mockResolvedValueOnce({ pages: keys(0, 100), total: 300 })
      .mockResolvedValueOnce({ pages: keys(0, 100), total: 300 })
      .mockResolvedValueOnce({ pages: keys(100, 150), total: 300 });

    const all = await readAllPages('b1');
    expect(getAuditPages).toHaveBeenCalledTimes(3);
    expect(all).toHaveLength(150);
  });
});
