import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AC-007: when a signal starts or stops supporting its action, the server is
 * asked to score the action again, after the response has gone. Moves that
 * leave the signal open, and signals no action holds, ask for nothing; copies
 * of one finding that share an action ask once.
 */

let rows: { id: string; status: string; action_id: string | null }[];
let writes: Record<string, unknown>[];
const fetchMock = vi.fn();

vi.mock('next/server', () => ({ after: (task: () => unknown) => task() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token-1' } } }) },
    from: () => {
      let patch: Record<string, unknown> | null = null;
      let ids: string[] = [];
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: (_column: string, values: string[]) => {
          ids = values;
          return chain;
        },
        update: (values: Record<string, unknown>) => {
          patch = values;
          writes.push(values);
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) => {
          const matched = rows.filter((row) => ids.includes(row.id));
          return resolve(
            patch
              ? { data: matched.map(({ id, action_id }) => ({ id, action_id })), error: null }
              : { data: matched.map(({ id, status }) => ({ id, status })), error: null },
          );
        },
      };
      return chain;
    },
  })),
}));

const { updateSignalStatus } = await import('./signals');

beforeEach(() => {
  rows = [{ id: 's1', status: 'new', action_id: 'a1' }];
  writes = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
});

describe('updateSignalStatus', () => {
  it("asks the server to rescore the signal's actions when it is resolved", async () => {
    await updateSignalStatus('b1', ['s1'], 'resolved');

    expect(writes[0]).toMatchObject({ status: 'resolved' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/action-center\/signals\/s1\/rescore$/),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer token-1' },
      }),
    );
  });

  it('asks again when a dismissed signal is reopened', async () => {
    rows[0].status = 'dismissed';
    await updateSignalStatus('b1', ['s1'], 'new');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks once for copies of one finding that share an action', async () => {
    rows = [
      { id: 's1', status: 'new', action_id: 'a1' },
      { id: 's2', status: 'new', action_id: 'a1' },
      { id: 's3', status: 'new', action_id: 'a2' },
    ];
    await updateSignalStatus('b1', ['s1', 's2', 's3'], 'dismissed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks nothing when the signal stays open', async () => {
    await updateSignalStatus('b1', ['s1'], 'acknowledged');
    expect(writes).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks nothing for a signal no action holds', async () => {
    rows[0].action_id = null;
    await updateSignalStatus('b1', ['s1'], 'resolved');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the status change when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(updateSignalStatus('b1', ['s1'], 'dismissed')).resolves.toBeUndefined();
    expect(writes[0]).toMatchObject({ status: 'dismissed' });
    warn.mockRestore();
  });
});
