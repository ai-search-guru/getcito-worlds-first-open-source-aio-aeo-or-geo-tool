import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_BOTS,
  RANGES_RETRY_MS,
  RANGES_TTL_MS,
  clearRangeCache,
  inPrefixes,
  matchBot,
  parseIp,
  parsePrefix,
  rangesFor,
  readRangeFile,
  verifyBotRequest,
} from './aiBots.js';

/** AI bots (AT-010, spec §3.7): a user agent on the list and an IP in its operator's ranges. */

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

beforeEach(() => {
  clearRangeCache();
});

describe('matchBot', () => {
  it('reads each bot from its own token, never from a longer name', () => {
    const ua = (token) =>
      `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ${token}/1.2; +https://example.com/bot`;
    for (const bot of AI_BOTS) expect(matchBot(ua(bot.userAgent))?.key).toBe(bot.key);
    expect(matchBot('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')?.key).toBe(
      'claudebot',
    );
    expect(matchBot('gptbot/1.0')?.key).toBe('gptbot');
    expect(matchBot('Mozilla/5.0 (compatible; NotGPTBotX/1.0)')).toBeNull();
    expect(matchBot('Mozilla/5.0 Chrome/129')).toBeNull();
    expect(matchBot(undefined)).toBeNull();
  });

  it('has a type and a published range list for every bot', () => {
    for (const bot of AI_BOTS) {
      expect(['training', 'search', 'user']).toContain(bot.type);
      expect(bot.ranges).toMatch(/^https:\/\//);
    }
    expect(new Set(AI_BOTS.map((b) => b.key)).size).toBe(AI_BOTS.length);
  });
});

describe('addresses and prefixes', () => {
  it('reads IPv4, IPv6 and IPv4-mapped addresses, and refuses the rest', () => {
    expect(parseIp('20.171.206.7')).toEqual({ family: 4, value: 346803719n });
    expect(parseIp('2001:db8::1')?.family).toBe(6);
    expect(parseIp('::ffff:20.171.206.7')).toEqual(parseIp('20.171.206.7'));
    for (const bad of ['256.1.1.1', '1.2.3', 'abc', '1::2::3', '', null]) {
      expect(parseIp(bad)).toBeNull();
    }
  });

  it('tells an address inside a prefix from one outside', () => {
    const prefixes = readRangeFile({
      prefixes: [{ ipv4Prefix: '20.171.206.0/24' }, { ipv6Prefix: '2001:db8:10::/48' }, {}],
    });
    expect(prefixes).toHaveLength(2);
    expect(inPrefixes('20.171.206.255', prefixes)).toBe(true);
    expect(inPrefixes('20.171.207.1', prefixes)).toBe(false);
    expect(inPrefixes('2001:db8:10:ffff::1', prefixes)).toBe(true);
    expect(inPrefixes('2001:db8:11::1', prefixes)).toBe(false);
    expect(inPrefixes('not-an-ip', prefixes)).toBe(false);
    expect(parsePrefix('20.171.206.0/33')).toBeNull();
  });
});

describe('rangesFor', () => {
  it('reads a list once a day and keeps the last one when a refresh fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ prefixes: [{ ipv4Prefix: '1.2.3.0/24' }] }));
    const first = await rangesFor('https://x/a.json', { fetchImpl, now: 0 });
    await rangesFor('https://x/a.json', { fetchImpl, now: RANGES_TTL_MS - 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    fetchImpl.mockResolvedValue(json({}, false));
    const stale = await rangesFor('https://x/a.json', { fetchImpl, now: RANGES_TTL_MS + 1 });
    expect(stale).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('is null when a list was never read', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await rangesFor('https://x/b.json', { fetchImpl, now: 0 })).toBeNull();
  });

  // gkhngyk on #1179: a list that failed to load was fetched again for every
  // request with that bot's user agent, each waiting out the timeout.
  it('waits a few minutes after a failed first read before trying again', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'));
    for (const now of [0, 1_000, RANGES_RETRY_MS - 1]) {
      expect(await rangesFor('https://x/c.json', { fetchImpl, now })).toBeNull();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    fetchImpl.mockResolvedValue(json({ prefixes: [{ ipv4Prefix: '1.2.3.0/24' }] }));
    const later = await rangesFor('https://x/c.json', { fetchImpl, now: RANGES_RETRY_MS });
    expect(later).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // gkhngyk on #1251: once a day, requests waited for the refresh although
  // a usable list was still in memory.
  it('uses the list it has while it reads it again', async () => {
    const old = json({ prefixes: [{ ipv4Prefix: '1.2.3.0/24' }] });
    let answer;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(old)
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const first = await rangesFor('https://x/e.json', { fetchImpl, now: 0 });

    // Past its day: the old list at once, with one read under way.
    const during = await rangesFor('https://x/e.json', { fetchImpl, now: RANGES_TTL_MS + 1 });
    const again = await rangesFor('https://x/e.json', { fetchImpl, now: RANGES_TTL_MS + 2 });
    expect(during).toBe(first);
    expect(again).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Once read, the new list.
    answer(json({ prefixes: [{ ipv4Prefix: '5.6.7.0/24' }, { ipv4Prefix: '8.8.8.0/24' }] }));
    await vi.waitFor(async () => {
      const fresh = await rangesFor('https://x/e.json', { fetchImpl, now: RANGES_TTL_MS + 3 });
      expect(fresh).toHaveLength(2);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shares one read among the requests waiting for it', async () => {
    let answer;
    const fetchImpl = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const reads = [1, 2, 3].map(() => rangesFor('https://x/d.json', { fetchImpl, now: 0 }));
    answer(json({ prefixes: [{ ipv4Prefix: '1.2.3.0/24' }] }));
    const lists = await Promise.all(reads);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(lists[0]).toHaveLength(1);
    expect(lists[1]).toBe(lists[0]);
    expect(lists[2]).toBe(lists[0]);
  });
});

describe('verifyBotRequest', () => {
  const fetchImpl = vi.fn(async () => json({ prefixes: [{ ipv4Prefix: '20.171.206.0/24' }] }));

  it('counts a bot only from its operator ranges', async () => {
    const ua = 'Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot';
    expect(
      (await verifyBotRequest({ userAgent: ua, ip: '20.171.206.9' }, { fetchImpl })).bot.key,
    ).toBe('gptbot');
    expect(await verifyBotRequest({ userAgent: ua, ip: '8.8.8.8' }, { fetchImpl })).toEqual({
      reason: 'unverified_ip',
    });
    expect(
      await verifyBotRequest(
        { userAgent: 'Mozilla/5.0 Chrome/129', ip: '20.171.206.9' },
        { fetchImpl },
      ),
    ).toEqual({ reason: 'unknown_agent' });
  });
});
