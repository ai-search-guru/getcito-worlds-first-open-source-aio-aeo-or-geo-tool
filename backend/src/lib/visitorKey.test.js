import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The tracking snippet's visitor key (GDPR, 00250): a one-way key in place
 * of the IP address, the same for a visitor all day, new the next.
 */

const rpc = vi.fn();
vi.mock('../config/supabase.js', () => ({ default: { rpc: (...args) => rpc(...args) } }));

const { visitorKey, resetDailySalt } = await import('./visitorKey.js');

const TODAY = new Date('2026-10-23T09:00:00.000Z');
const LATER_TODAY = new Date('2026-10-23T23:59:00.000Z');
const TOMORROW = new Date('2026-10-24T00:01:00.000Z');

beforeEach(() => {
  resetDailySalt();
  rpc.mockReset();
  rpc.mockImplementation(async (_, { p_day }) => ({ data: `salt-${p_day}`, error: null }));
});

describe('visitorKey', () => {
  it('gives a visitor one key all day, and never contains the address', async () => {
    const morning = await visitorKey({ brandId: 'b1', ip: '203.0.113.7', now: TODAY });
    const night = await visitorKey({ brandId: 'b1', ip: '203.0.113.7', now: LATER_TODAY });
    expect(morning).toMatch(/^[0-9a-f]{64}$/);
    expect(night).toBe(morning);
    expect(morning).not.toContain('203.0.113.7');
  });

  it('reads the salt once a day', async () => {
    await visitorKey({ brandId: 'b1', ip: '203.0.113.7', now: TODAY });
    await visitorKey({ brandId: 'b2', ip: '198.51.100.4', now: LATER_TODAY });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('traffic_salt', { p_day: '2026-10-23' });
  });

  it('gives a new key the next day, for another brand and for another address', async () => {
    const key = await visitorKey({ brandId: 'b1', ip: '203.0.113.7', now: TODAY });
    expect(await visitorKey({ brandId: 'b1', ip: '203.0.113.7', now: TOMORROW })).not.toBe(key);
    expect(await visitorKey({ brandId: 'b2', ip: '203.0.113.7', now: TODAY })).not.toBe(key);
    expect(await visitorKey({ brandId: 'b1', ip: '203.0.113.8', now: TODAY })).not.toBe(key);
  });

  it('has no key without an address, and fails when there is no salt', async () => {
    expect(await visitorKey({ brandId: 'b1', ip: null, now: TODAY })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(visitorKey({ brandId: 'b1', ip: '203.0.113.7', now: TODAY })).rejects.toThrow(
      'permission denied',
    );
  });
});
