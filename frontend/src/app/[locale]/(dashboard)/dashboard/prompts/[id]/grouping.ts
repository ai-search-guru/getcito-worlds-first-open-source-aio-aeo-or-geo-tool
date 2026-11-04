import type { PromptResultWithText } from '@/lib/actions/tracking';

export interface PlatformGroup {
  key: string;
  platform: string;
  modelUsed?: string;
  region?: string;
  results: PromptResultWithText[];
  avgScore: number;
  totalMentions: number;
  totalCitations: number;
}

export function groupByPlatform(results: PromptResultWithText[]): PlatformGroup[] {
  const map = new Map<string, PromptResultWithText[]>();
  for (const result of results) {
    const key = result.platform;
    const items = map.get(key) ?? [];
    items.push(result);
    map.set(key, items);
  }

  return Array.from(map.entries())
    .map(([key, items]) => {
      const sorted = [...items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      const latest = sorted[0];
      return {
        key,
        platform: latest.platform,
        modelUsed: latest.modelUsed,
        region: latest.region,
        results: sorted,
        avgScore: Math.round(
          sorted.reduce((sum, row) => sum + row.visibilityScore, 0) / sorted.length,
        ),
        totalMentions: sorted.reduce((sum, row) => sum + row.mentionCount, 0),
        totalCitations: sorted.reduce((sum, row) => sum + row.citationCount, 0),
      } satisfies PlatformGroup;
    })
    .sort((a, b) => b.avgScore - a.avgScore);
}
