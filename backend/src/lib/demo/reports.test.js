import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { reportRows, reports } = await import('./reports.js');
const { coreRows } = await import('./core.js');

/**
 * The demo brand's saved reports (demo-workflows): a weekly visibility
 * summary and a competitor benchmark, counted from the demo's answers.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-28T12:00:00Z');
const DAY = 86_400_000;
const core = coreRows({ brandId: BRAND_ID, now: NOW });
const [benchmark, weekly] = reportRows({ brandId: BRAND_ID, now: NOW });

describe('reportRows', () => {
  it('saves the two reports with their templates’ sections', () => {
    expect(weekly.template).toBe('weekly_visibility');
    expect(Object.keys(weekly.payload).sort()).toEqual(
      [
        'brandName',
        'insights',
        'shareOfVoice',
        'summaryText',
        'visibilityRate',
        'visibilityTrend',
      ].sort(),
    );
    expect(benchmark.template).toBe('competitor_benchmark');
    expect(benchmark.payload).toHaveProperty('competitors');
    expect(benchmark.payload).toHaveProperty('topicPerformance');
    for (const r of [weekly, benchmark]) {
      expect(r.title).toMatch(/^Brewline Coffee — .+ \(\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}\)$/);
      expect(r.payload.summaryText.length).toBeGreaterThan(80);
      expect(JSON.stringify(r.payload)).not.toMatch(/undefined|NaN/);
    }
  });

  it('spans its window, ending before now', () => {
    expect(Date.parse(weekly.date_to) - Date.parse(weekly.date_from)).toBe(7 * DAY);
    expect(Date.parse(benchmark.date_to) - Date.parse(benchmark.date_from)).toBe(30 * DAY);
    for (const r of [weekly, benchmark]) {
      expect(Date.parse(r.created_at)).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it('counts what the demo’s answers say over the window', () => {
    const inWeek = core.results.filter(
      (r) => r.created_at >= weekly.date_from && r.created_at < weekly.date_to,
    );
    expect(weekly.payload.insights.totalResults).toBe(inWeek.length);
    expect(weekly.payload.visibilityRate.promptCount).toBe(12);
    expect(weekly.payload.visibilityTrend.length).toBeGreaterThan(1);

    const [own, ...rivals] = benchmark.payload.competitors;
    expect(own).toMatchObject({ name: 'Brewline Coffee', isOwnBrand: true });
    expect(rivals.map((r) => r.competitorId).sort()).toEqual(
      core.competitors.map((c) => c.id).sort(),
    );
    expect(benchmark.payload.topicPerformance.map((t) => t.name)).toEqual(
      core.topics.map((t) => t.name),
    );
  });
});

describe('reports.build', () => {
  it('writes both reports', async () => {
    let written = null;
    const db = {
      from: (table) => ({
        upsert: async (list) => {
          written = [table, list.length];
          return { error: null };
        },
      }),
    };
    expect(await reports.build({ brandId: BRAND_ID, now: NOW, db })).toEqual({ reports: 2 });
    expect(written).toEqual(['reports', 2]);
  });
});
