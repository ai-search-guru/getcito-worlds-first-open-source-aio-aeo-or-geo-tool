// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Getting started explore page opened (AC-ALT2 §4): recorded through
 * getting_started_page_opened, answered as a value and never thrown
 * (#1777). The demo brand keeps no steps: nothing is recorded or logged.
 */

const db = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown }[],
  data: true as unknown,
  error: null as { message: string } | null,
  throws: false,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (db.throws) throw new Error('down');
    return {
      rpc: async (fn: string, args: unknown) => {
        db.calls.push({ fn, args });
        return { data: db.data, error: db.error };
      },
    };
  },
}));
vi.mock('@/lib/subscriptionGuard', () => ({ assertWritable: vi.fn() }));

const { markGettingStartedPageOpened } = await import('./gettingStarted');

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.calls = [];
  db.data = true;
  db.error = null;
  db.throws = false;
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorLog.mockRestore());

describe('markGettingStartedPageOpened', () => {
  it('records the page and says whether the step counts', async () => {
    expect(await markGettingStartedPageOpened('brand-1', 'mentions')).toEqual({
      ok: true,
      recorded: true,
    });
    expect(db.calls).toEqual([
      { fn: 'getting_started_page_opened', args: { p_brand_id: 'brand-1', p_step: 'mentions' } },
    ]);
    db.data = false;
    expect(await markGettingStartedPageOpened('brand-1', 'mentions')).toEqual({
      ok: true,
      recorded: false,
    });
  });

  it('answers the demo brand quietly: nothing recorded, nothing logged', async () => {
    db.error = { message: 'demo_brand' };
    expect(await markGettingStartedPageOpened('demo-brand', 'mentions')).toEqual({
      ok: true,
      recorded: false,
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('answers any other failure as a value, never a thrown error', async () => {
    db.error = { message: 'permission denied' };
    expect(await markGettingStartedPageOpened('brand-1', 'mentions')).toEqual({
      ok: false,
      failure: 'failed',
    });
    db.throws = true;
    expect(await markGettingStartedPageOpened('brand-1', 'mentions')).toEqual({
      ok: false,
      failure: 'failed',
    });
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it('asks nothing for a step that is not an explore page', async () => {
    expect(await markGettingStartedPageOpened('brand-1', 'connect_gsc')).toEqual({
      ok: false,
      failure: 'step',
    });
    expect(db.calls).toEqual([]);
  });
});
