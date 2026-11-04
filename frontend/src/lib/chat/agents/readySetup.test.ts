// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The person's work areas Agent Center's Ready to use puts first (Settings ›
 * Menu access, 00374): read from their own profile, only the work areas
 * there are, and none when they can't be read.
 */

const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  row: { work_areas: ['content', 'nope', 'growth'] } as { work_areas: unknown } | null,
  error: null as { message: string } | null,
  asked: [] as string[],
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => {
          db.asked.push(`${table}.${columns} ${column}=${value}`);
          return { maybeSingle: async () => ({ data: db.row, error: db.error }) };
        },
      }),
    }),
  }),
}));
vi.mock('../runApi', () => ({ chatActor: vi.fn() }));
vi.mock('../agents', () => ({ readAgentContext: vi.fn() }));

const { readMyWorkAreas } = await import('./readySetup');

beforeEach(() => {
  db.user = { id: 'user-1' };
  db.row = { work_areas: ['content', 'nope', 'growth'] };
  db.error = null;
  db.asked = [];
});

describe('readMyWorkAreas', () => {
  it('reads the person’s own work areas, the known ones in their order', async () => {
    expect(await readMyWorkAreas()).toEqual(['content', 'growth']);
    expect(db.asked).toEqual(['profiles.work_areas id=user-1']);
  });

  it('is none when skipped, signed out or unreadable', async () => {
    db.row = { work_areas: null };
    expect(await readMyWorkAreas()).toEqual([]);
    db.user = null;
    expect(await readMyWorkAreas()).toEqual([]);
    db.user = { id: 'user-1' };
    db.error = { message: 'down' };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readMyWorkAreas()).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
