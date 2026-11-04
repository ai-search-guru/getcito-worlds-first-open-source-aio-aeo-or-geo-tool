import { describe, expect, it } from 'vitest';
import type { PromptVolume } from '@/types';
import { aggregatePromptVolumeClusters } from './promptVolumeClusters';

const prompt = (
  id: string,
  keywords: string[],
  googleVolumes: Record<string, number>,
  totalGoogleVolume: number,
): PromptVolume => ({
  id: `v-${id}`,
  promptId: id,
  promptText: `prompt ${id}`,
  promptCategory: '',
  intent: 'how-to',
  keywords,
  googleVolumes,
  totalGoogleVolume,
  aiVolumeMultiplier: 0.15,
  estAiVolume: Math.round(totalGoogleVolume * 0.15),
  competitionIndex: null,
  competition: null,
  fetchedAt: '2026-10-16T00:00:00Z',
});

describe('aggregatePromptVolumeClusters', () => {
  it("counts a keyword's volume once however many prompts share it", () => {
    const clusters = aggregatePromptVolumeClusters([
      prompt('a', ['seo tools', 'ai seo'], { 'seo tools': 110000, 'ai seo': 8100 }, 59050),
      prompt(
        'b',
        ['seo tools', 'rank checker'],
        { 'seo tools': 110000, 'rank checker': 1900 },
        55950,
      ),
    ]);

    const seoTools = clusters.find((c) => c.keyword === 'seo tools')!;
    expect(seoTools.volume).toBe(110000);
    expect(seoTools.estimatedAiVolume).toBe(16500);
    expect(seoTools.occurrences).toBe(2);
    // Biggest search first.
    expect(clusters.map((c) => c.keyword)).toEqual(['seo tools', 'ai seo', 'rank checker']);
  });

  it("finds a keyword's volume whatever its case", () => {
    const [cluster] = aggregatePromptVolumeClusters([
      prompt('a', ['Best CRM Software'], { 'best crm software': 500 }, 500),
    ]);
    expect(cluster.volume).toBe(500);
  });

  it('counts a prompt that lists a keyword twice once', () => {
    const [cluster] = aggregatePromptVolumeClusters([
      prompt('a', ['CRM', 'crm'], { crm: 100 }, 100),
    ]);
    expect(cluster.occurrences).toBe(1);
    expect(cluster.prompts).toHaveLength(1);
  });

  it("lists each prompt with the prompt's own volumes", () => {
    const [cluster] = aggregatePromptVolumeClusters([
      prompt(
        'a',
        ['seo tools', 'ai seo', 'serp tracker'],
        { 'seo tools': 110000, 'ai seo': 8100, 'serp tracker': 1300 },
        8100,
      ),
    ]);
    expect(cluster.prompts[0]).toMatchObject({ id: 'a', volume: 8100, estimatedAiVolume: 1215 });
  });

  it('carries the rate and the latest fetch, for the estimate shown beside it', () => {
    const [cluster] = aggregatePromptVolumeClusters([
      prompt('a', ['seo tools'], { 'seo tools': 110000 }, 110000),
      {
        ...prompt('b', ['SEO tools'], { 'SEO tools': 110000 }, 110000),
        fetchedAt: '2026-10-20T00:00:00Z',
      },
    ]);
    expect(cluster).toMatchObject({ aiVolumeMultiplier: 0.15, fetchedAt: '2026-10-20T00:00:00Z' });
  });
});
