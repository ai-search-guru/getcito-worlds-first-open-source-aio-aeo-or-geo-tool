// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PLANS } from '@/config/plans';
import type { Json } from '@/types/supabase';

/**
 * Chat's scope decisions (W1-17; CHAT-04 items 2–6, Rule 1; CHAT-20 §7): the
 * default 30 days and the all-time ask, the plan's platforms (refused when
 * asked for, held to when not), the row limits and what a cut list says.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: vi.fn() } }));

const {
  DEFAULT_RANGE_DAYS,
  ROW_CAP,
  ROW_LIMITS,
  asksAllTime,
  capRows,
  planPlatforms,
  resolveDates,
  scopeRead,
} = await import('./scope');
const { CHAT_TOOLS } = await import('./registry/tools');

const NOW = new Date('2026-10-30T12:00:00.000Z');
const BRAND = '11111111-1111-4111-8111-111111111111';

const readTool = (shape: z.ZodRawShape, planGate: { platforms?: true } | null = null) => ({
  name: 'test_read',
  inputSchema: z.object({ brand_id: z.string(), ...shape }),
  planGate,
});

const facts = (over: Partial<Parameters<typeof scopeRead>[2]> = {}) => ({
  question: 'How are we doing?',
  limits: PLANS.growth.limits,
  planName: 'Growth',
  now: NOW,
  ...over,
});

describe('dates', () => {
  it('reads the last 30 days when none are given', () => {
    expect(resolveDates(undefined, undefined, false, NOW)).toEqual({
      dateFrom: '2026-09-30',
      dateTo: '2026-10-30',
      dates: 'default',
      values: { date_from: '2026-09-30', date_to: '2026-10-30' },
    });
    expect(DEFAULT_RANGE_DAYS).toBe(30);
  });

  it('reads all time only on an all-time ask', () => {
    expect(resolveDates(null, null, true, NOW)).toMatchObject({ dates: 'all_time', values: {} });
    for (const question of [
      'Citations of all time',
      'all-time best prompts',
      'How have we done since we started?',
      'Başından beri en iyi promptlarımız',
      'Tüm zamanların en çok atıf alan sayfası',
      'Şimdiye kadar kaç kez anıldık?',
    ]) {
      expect(asksAllTime(question)).toBe(true);
    }
    for (const question of ['How are we doing?', 'Bu hafta Perplexity’de neden düştük?', null]) {
      expect(asksAllTime(question)).toBe(false);
    }
  });

  it("keeps the model's dates, ends today at the latest and puts them in order", () => {
    expect(resolveDates('2026-10-01', '2026-10-15', false, NOW).values).toEqual({
      date_from: '2026-10-01',
      date_to: '2026-10-15',
    });
    expect(resolveDates('2026-10-20', '2027-01-01', false, NOW).values).toEqual({
      date_from: '2026-10-20',
      date_to: '2026-10-30',
    });
    expect(resolveDates('2026-10-15', '2026-10-01', false, NOW).values).toEqual({
      date_from: '2026-10-01',
      date_to: '2026-10-15',
    });
    // Only an end: the 30 days before it. Only a start: until today.
    expect(resolveDates(undefined, '2026-10-10', false, NOW).values).toEqual({
      date_from: '2026-09-10',
      date_to: '2026-10-10',
    });
    expect(resolveDates('2026-10-01', undefined, false, NOW).values).toEqual({
      date_from: '2026-10-01',
      date_to: '2026-10-30',
    });
    // Not a date: as if none were given.
    expect(resolveDates('last week', undefined, false, NOW).dates).toBe('default');
    // A start after today: neither date passes today.
    expect(resolveDates('2027-02-01', '2027-03-01', false, NOW).values).toEqual({
      date_from: '2026-10-30',
      date_to: '2026-10-30',
    });
    expect(resolveDates('2027-02-01', undefined, false, NOW).values).toEqual({
      date_from: '2026-10-30',
      date_to: '2026-10-30',
    });
  });

  it('gives a `days` read its default, or the most it reaches on an all-time ask', async () => {
    const tool = { ...readTool({ days: z.number().int().min(1).max(90).optional() }) };
    const plain = await scopeRead(tool, { brand_id: BRAND }, facts());
    expect(plain).toMatchObject({ input: { days: 30 }, used: { dates: 'days', days: 30 } });
    const google = await scopeRead(
      { ...tool, name: 'get_gsc_summary' },
      { brand_id: BRAND },
      facts(),
    );
    expect(google).toMatchObject({ input: { days: 28 } });
    const all = await scopeRead(tool, { brand_id: BRAND }, facts({ question: 'all time please' }));
    expect(all).toMatchObject({ input: { days: 90 }, used: { dates: 'all_time', days: 90 } });
  });
});

describe('platforms', () => {
  const visibility = readTool(
    { model: z.string().optional(), date_from: z.string().optional() },
    { platforms: true },
  );

  it('knows what each plan tracks', () => {
    expect(planPlatforms(PLANS.starter.limits)).toMatchObject({
      scrapers: ['chatgpt-web', 'copilot-web'],
      models: [],
      someScrapers: true,
    });
    // Growth: every scraped app, no Claude.
    const growth = planPlatforms(PLANS.growth.limits)!;
    expect(growth.someScrapers).toBe(false);
    expect(growth.families.has('anthropic')).toBe(false);
    expect(planPlatforms(null)).toBeNull();
  });

  it('refuses a platform the plan does not track, naming what it does', async () => {
    const starter = facts({ limits: PLANS.starter.limits, planName: 'Starter' });
    const scoped = await scopeRead(
      readTool({ platform: z.string().optional() }),
      { brand_id: BRAND, platform: 'perplexity-web' },
      starter,
    );
    expect(scoped).toEqual({
      kind: 'not_on_plan',
      result: {
        code: 'not_on_plan',
        plan: 'Starter',
        asked: ['Perplexity'],
        on_plan: expect.arrayContaining(['ChatGPT']),
      },
    });
    // Claude on Growth (CHAT-04 item 2).
    const claude = await scopeRead(
      visibility,
      { brand_id: BRAND, model: 'claude-sonnet-5' },
      facts(),
    );
    expect(claude.kind).toBe('not_on_plan');
  });

  it('keeps the asked platforms the plan tracks and drops the rest', async () => {
    const scoped = await scopeRead(
      visibility,
      { brand_id: BRAND, model: 'gpt-5-3-mini,sonar-pro' },
      facts({ limits: PLANS.starter.limits, planName: 'Starter' }),
    );
    expect(scoped).toMatchObject({
      kind: 'read',
      input: { model: 'gpt-5-3-mini' },
      used: { platforms: ['gpt-5-3-mini'] },
    });
  });

  it("holds a read with no platform to the plan's, on a plan that tracks some", async () => {
    const modelsOf = vi.fn(async () => ['gpt-5-3-mini', 'sonar-pro', 'google-aio', 'copilot-web']);
    const scoped = await scopeRead(
      visibility,
      { brand_id: BRAND },
      facts({ limits: PLANS.starter.limits, planName: 'Starter', modelsOf }),
    );
    expect(modelsOf).toHaveBeenCalledWith(BRAND);
    expect(scoped).toMatchObject({
      input: { model: 'gpt-5-3-mini,copilot-web' },
      platformNames: expect.arrayContaining(['ChatGPT']),
    });
    // None of the plan's seen yet: its own ids, which match its rows or none.
    const unseen = await scopeRead(
      visibility,
      { brand_id: BRAND },
      facts({ limits: PLANS.starter.limits, modelsOf: async () => ['sonar-pro'] }),
    );
    expect(unseen).toMatchObject({ input: { model: 'chatgpt-web,copilot-web' } });
    // The brand's models couldn't be read: not read, rather than held to ids that read empty.
    const failed = await scopeRead(
      visibility,
      { brand_id: BRAND },
      facts({ limits: PLANS.starter.limits, modelsOf: async () => null }),
    );
    expect(failed).toEqual({ kind: 'failed' });
  });

  it('leaves a plan that tracks every app alone when no platform is named', async () => {
    const modelsOf = vi.fn(async () => []);
    const scoped = await scopeRead(visibility, { brand_id: BRAND }, facts({ modelsOf }));
    expect(modelsOf).not.toHaveBeenCalled();
    expect(scoped).toMatchObject({ input: { brand_id: BRAND }, used: { platforms: null } });
    expect((scoped as { input: Record<string, unknown> }).input.model).toBeUndefined();
  });
});

describe('rows', () => {
  const listed = readTool({ limit: z.number().int().min(1).max(100).optional() });

  it("reads the tool's default, the model's count up to the max, and one more to see if there are more", async () => {
    const named = { ...listed, name: 'list_signals' };
    expect(await scopeRead(named, { brand_id: BRAND }, facts())).toMatchObject({
      input: { limit: 11 },
      cap: { rows: 10, probe: 11 },
    });
    expect(await scopeRead(named, { brand_id: BRAND, limit: 500 }, facts())).toMatchObject({
      input: { limit: ROW_CAP + 1 },
      cap: { rows: ROW_CAP, probe: ROW_CAP + 1 },
    });
    // A schema that can't take one more: no probe.
    const tight = readTool({ limit: z.number().int().min(1).max(10).optional() });
    expect(
      await scopeRead({ ...tight, name: 'x' }, { brand_id: BRAND, limit: 10 }, facts()),
    ).toMatchObject({ input: { limit: 10 }, cap: { rows: 10, probe: null } });
  });

  it('cuts every list to its rows and says how many were left out', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i })) as Json[];
    const exact = capRows(
      { items: rows(60), totals: { n: 60, pages: rows(55) }, ok: true },
      {
        rows: 50,
        probe: null,
      },
    );
    expect(exact.cut).toBe(true);
    expect(exact.value).toMatchObject({
      items_more: 10,
      totals: { pages_more: 5 },
      truncated: true,
      ok: true,
    });
    expect((exact.value as { items: Json[] }).items).toHaveLength(50);
    // A probe's extra row: more exist, the count isn't known.
    expect(capRows({ items: rows(11) }, { rows: 10, probe: 11 }).value).toMatchObject({
      items_more: null,
      truncated: true,
    });
    expect(capRows(rows(3), { rows: 50, probe: null })).toEqual({ value: rows(3), cut: false });
    expect(capRows(rows(52), { rows: 50, probe: null }).value).toMatchObject({
      more: 2,
      truncated: true,
    });
    // A series oldest first (a trend's days) keeps its latest rows.
    const days = Array.from({ length: 91 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 7, 1) + i * 86_400_000).toISOString().slice(0, 10),
    })) as Json[];
    const trend = capRows({ granularity: 'day', buckets: days }, { rows: 50, probe: null });
    const kept = (trend.value as { buckets: { date: string }[] }).buckets;
    expect(kept).toHaveLength(50);
    expect(kept[kept.length - 1].date).toBe('2026-10-30');
    expect(trend.value).toMatchObject({ buckets_more: 41, truncated: true });
    // Newest first: its first rows are its latest.
    const newest = capRows([...days].reverse(), { rows: 50, probe: null }).value;
    expect((newest as { items: { date: string }[] }).items[0].date).toBe('2026-10-30');
    // Lists inside rows stay as they are.
    const nested = capRows({ items: [{ tags: rows(80) }] as Json[] }, { rows: 50, probe: null });
    expect(nested.cut).toBe(false);
  });

  it('has a limit for every registry read that takes one, within its schema', () => {
    for (const tool of CHAT_TOOLS.filter((t) => t.class === 'read')) {
      const shape = tool.inputSchema.shape as Record<string, unknown>;
      const limits = ROW_LIMITS[tool.name];
      if ('limit' in shape) {
        expect(limits, tool.name).toBeDefined();
        const input = { ...tool.fixture.input, limit: limits.max + 1 };
        expect(tool.inputSchema.safeParse(input).success, tool.name).toBe(true);
      }
      expect(limits ? limits.max <= ROW_CAP : true, tool.name).toBe(true);
    }
    for (const name of Object.keys(ROW_LIMITS)) {
      expect(
        CHAT_TOOLS.some((tool) => tool.name === name),
        name,
      ).toBe(true);
    }
  });
});
