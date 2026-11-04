// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '../testing/fakeSupabase';
import type { WhatsNewEntry } from './entries';

const db = vi.hoisted(() => ({ fake: null as FakeSupabase | null }));
vi.mock('@/lib/supabase/admin', async () => {
  const { createFakeSupabase } = await import('../testing/fakeSupabase');
  db.fake = createFakeSupabase();
  return { supabaseAdmin: db.fake };
});
const facts = vi.hoisted(() => ({ planId: 'starter', planName: 'Starter', selfHosted: false }));
vi.mock('@/lib/mcp/chatFacts', () => ({ planFactsOf: async () => facts }));
// Two approved entries, as entries.json would hold them.
vi.mock('./entries.json', () => ({
  default: {
    entries: [
      {
        slug: 'agent-center',
        feature: 'Agent Center',
        homeLine: 'Agent Center runs routine work for you.',
        route: '/dashboard/agents',
        plans: ['starter', 'growth', 'enterprise'],
        planMode: 'show_upgrade',
        published: '2026-11-03',
        lines: ['One.', 'Two.', 'Three.'],
      },
      {
        slug: 'full-auto',
        feature: 'Full auto',
        homeLine: 'Full auto runs a whole job without stopping.',
        route: '/dashboard/chat',
        plans: ['growth', 'enterprise'],
        planMode: 'hide',
        published: '2026-11-01',
        lines: ['One.', 'Two.', 'Three.'],
      },
    ],
  },
}));

const { HOME_LINE_DAYS, markWhatsNewRead, pickWhatsNew, readWhatsNew, readWhatsNewReads } =
  await import('./reads');

/**
 * What's new for a person (W4-20, CHAT-11 §B–E): the plan's entries, the
 * named one first, then unread, then newest; `hide` never shown off its
 * plans and `show_upgrade` with the plans that include it; read state per
 * person.
 */

const fake = () => db.fake!;
const day = (published: string, slug: string, extra: Partial<WhatsNewEntry> = {}) =>
  ({
    slug,
    feature: slug,
    homeLine: `${slug}.`,
    route: '/dashboard/chat',
    plans: ['starter', 'growth', 'enterprise'],
    planMode: 'hide',
    published,
    lines: ['One.', 'Two.', 'Three.'],
    ...extra,
  }) as WhatsNewEntry;

const ENTRIES = [
  day('2026-11-10', 'future'),
  day('2026-11-05', 'newest'),
  day('2026-11-04', 'growth-only', { plans: ['growth', 'enterprise'] }),
  day('2026-11-03', 'upgrade', { plans: ['growth', 'enterprise'], planMode: 'show_upgrade' }),
  day('2026-10-20', 'older'),
  day('2026-06-01', 'months-ago'),
];
const now = new Date('2026-11-06T12:00:00Z');
const starter = { planId: 'starter' as const, selfHosted: false };

beforeEach(() => {
  fake().tables = {};
  fake().failures = {};
});

describe('pickWhatsNew', () => {
  it('shows the plan’s entries whose day has come, unread first, then newest, three at most', () => {
    const pick = pickWhatsNew({ entries: ENTRIES, plan: starter, read: new Set(['newest']), now });
    expect(pick.items.map((i) => [i.slug, i.read])).toEqual([
      ['upgrade', false],
      ['older', false],
      ['months-ago', false],
    ]);
    // On another plan with show_upgrade: the plans that include it, by Billing's names.
    expect(pick.items[0].onPlans).toBe('Growth and Enterprise');
    expect(pick.items[1].onPlans).toBeNull();
    expect(pick.more).toBe(true);
    expect(pick.hasUnread).toBe(true);
  });

  it('puts the entry the person named first, read or not', () => {
    const pick = pickWhatsNew({
      entries: ENTRIES,
      plan: starter,
      read: new Set(['newest']),
      now,
      feature: 'What’s new: how can Newest help me?',
      limit: 2,
    });
    expect(pick.items.map((i) => i.slug)).toEqual(['newest', 'upgrade']);
  });

  it('pages through entries of one day and a read/unread mix, each once, until none are left', () => {
    const sameDay = [
      day('2026-10-31', 'a'),
      day('2026-10-31', 'b'),
      day('2026-10-31', 'c'),
      day('2026-10-31', 'd'),
      day('2026-10-31', 'e'),
      day('2026-10-20', 'f'),
      day('2026-10-01', 'g'),
    ];
    // An unread entry ranks before newer read ones: paging must still reach them.
    const read = new Set(['a', 'b', 'c']);
    const shown: string[] = [];
    const pages: string[][] = [];
    for (let more = true; more;) {
      const pick = pickWhatsNew({ entries: sameDay, plan: starter, read, now, shown });
      pages.push(pick.items.map((i) => i.slug));
      shown.push(...pick.items.map((i) => i.feature));
      more = pick.more;
      expect(pages.length).toBeLessThan(5);
    }
    expect(pages).toEqual([['d', 'e', 'f'], ['g', 'a', 'b'], ['c']]);
    // With everything shown, nothing is left and older_updates goes false.
    expect(pickWhatsNew({ entries: sameDay, plan: starter, read, now, shown })).toMatchObject({
      items: [],
      more: false,
    });
  });

  it('says more only for entries the filters leave', () => {
    const pick = pickWhatsNew({
      entries: ENTRIES,
      plan: starter,
      read: new Set(['newest']),
      now,
      unreadOnly: true,
      days: HOME_LINE_DAYS,
      limit: 1,
    });
    expect(pick.items.map((i) => i.slug)).toEqual(['upgrade']);
    expect(pick.more).toBe(false);
  });

  it('gives Home the newest unread entry of the last 14 days, and no line once it is read', () => {
    const home = (read: string[]) =>
      pickWhatsNew({
        entries: ENTRIES,
        plan: starter,
        read: new Set(read),
        now,
        unreadOnly: true,
        days: HOME_LINE_DAYS,
        limit: 1,
      }).items.map((i) => i.slug);
    expect(home([])).toEqual(['newest']);
    expect(home(['newest'])).toEqual(['upgrade']);
    expect(home(['newest', 'upgrade', 'older'])).toEqual([]);
    // 14 days after its day, the line goes, read or not.
    expect(
      pickWhatsNew({
        entries: ENTRIES,
        plan: starter,
        read: new Set(),
        now: new Date('2026-11-20T12:00:00Z'),
        unreadOnly: true,
        days: HOME_LINE_DAYS,
        limit: 1,
      }).items.map((i) => i.slug),
    ).toEqual(['future']);
  });

  it('dots the chip only for unread entries of the last 90 days', () => {
    const all = ENTRIES.map((e) => e.slug).filter((s) => s !== 'months-ago');
    expect(
      pickWhatsNew({ entries: ENTRIES, plan: starter, read: new Set(all), now }).hasUnread,
    ).toBe(false);
  });

  it('reads the ones not shown yet, by feature or slug, and shows a Growth workspace its own', () => {
    const next = pickWhatsNew({
      entries: ENTRIES,
      plan: starter,
      read: new Set(),
      now,
      shown: ['Newest', ' upgrade '],
    });
    expect(next.items.map((i) => i.slug)).toEqual(['older', 'months-ago']);
    expect(next.more).toBe(false);
    const growth = pickWhatsNew({
      entries: ENTRIES,
      plan: { planId: 'growth', selfHosted: false },
      read: new Set(),
      now,
      limit: 10,
    });
    expect(growth.items.map((i) => [i.slug, i.onPlans])).toEqual([
      ['newest', null],
      ['growth-only', null],
      ['upgrade', null],
      ['older', null],
      ['months-ago', null],
    ]);
  });
});

describe('read state', () => {
  it('reads the person’s own reads, and marks approved entries read once', async () => {
    fake().unique.chat_whats_new_reads = [['user_id', 'entry_slug']];
    fake().tables.chat_whats_new_reads = [
      { user_id: 'u1', entry_slug: 'agent-center' },
      { user_id: 'u2', entry_slug: 'full-auto' },
    ];
    expect(await readWhatsNewReads('u1')).toEqual(new Set(['agent-center']));
    expect(
      await markWhatsNewRead('u1', ['agent-center', 'full-auto', 'made-up', 'full-auto']),
    ).toBe(true);
    expect(
      fake()
        .tables.chat_whats_new_reads.filter((r) => r.user_id === 'u1')
        .map((r) => r.entry_slug)
        .sort(),
    ).toEqual(['agent-center', 'full-auto']);
    expect(await markWhatsNewRead('u1', ['made-up'])).toBe(true);
  });

  it('counts nothing read when the read fails, and says when marking fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake().failures.chat_whats_new_reads = { message: 'down' };
    expect(await readWhatsNewReads('u1')).toEqual(new Set());
    expect(await markWhatsNewRead('u1', ['agent-center'])).toBe(false);
  });

  it('reads What’s new for the person’s plan, with the plan’s name', async () => {
    fake().tables.chat_whats_new_reads = [{ user_id: 'u1', entry_slug: 'agent-center' }];
    const read = await readWhatsNew({
      userId: 'u1',
      organizationId: 'org-1',
      now: new Date('2026-11-06T00:00:00Z'),
    });
    // Full auto is Growth's, hidden on Starter.
    expect(read.items.map((i) => [i.slug, i.read])).toEqual([['agent-center', true]]);
    expect(read.planName).toBe('Starter');
    expect(read.hasUnread).toBe(false);
  });
});
