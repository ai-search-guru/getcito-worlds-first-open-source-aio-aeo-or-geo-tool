// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_SHARES_TTL_MS, clearAgentShares, readAgentShares } from './agentShares';

/**
 * Each agent's share of the AI limit comes from the server, which keeps the
 * budget: one read per workspace and window, kept 5 minutes; a read that
 * fails is no figure, never a thrown error.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const AGENT = 'eeeeeeee-0000-4000-8000-000000000001';

const fetchMock = vi.fn();

beforeEach(() => {
  clearAgentShares();
  vi.stubEnv('CRON_SECRET', 'shh');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        unlimited: false,
        since: '2026-10-20T09:00:00.000Z',
        shares: [
          { agentId: AGENT, share: 0.032, ownKeyShare: 0.01, runs: 4 },
          { agentId: null, share: 0.5, ownKeyShare: 0, runs: 9 },
        ],
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('readAgentShares', () => {
  it('asks the server with its secret, for the period or the last 30 days', async () => {
    const shares = await readAgentShares(ORG, 'days30');
    expect(shares?.unlimited).toBe(false);
    expect([...(shares?.byAgent ?? [])]).toEqual([
      [AGENT, { share: 0.032, ownKeyShare: 0.01, runs: 4 }],
    ]);
    const [address, init] = fetchMock.mock.calls[0];
    expect(String(address)).toMatch(
      /\/api\/internal\/chat\/budget\/agent-shares\?orgId=11111111-1111-4111-8111-111111111111&days=30$/,
    );
    expect(init.headers).toEqual({ Authorization: 'Bearer shh' });
    await readAgentShares(ORG, 'period');
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('days=');
  });

  it('keeps a read for 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await readAgentShares(ORG, 'period');
    await readAgentShares(ORG, 'period');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + AGENT_SHARES_TTL_MS + 1);
    await readAgentShares(ORG, 'period');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is null when the server refuses, doesn’t answer, or there is no secret', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 402 }));
    expect(await readAgentShares(ORG, 'period')).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await readAgentShares(ORG, 'period')).toBeNull();
    vi.stubEnv('CRON_SECRET', '');
    expect(await readAgentShares(ORG, 'days30')).toBeNull();
  });
});
