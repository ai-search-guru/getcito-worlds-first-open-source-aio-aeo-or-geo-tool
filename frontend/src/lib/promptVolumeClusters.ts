import type { PromptVolume } from '@/types';

export interface PromptVolumeCluster {
  keyword: string;
  /** The keyword's monthly Google volume, counted once. */
  volume: number;
  estimatedAiVolume: number;
  /** The AI adoption rate behind estimatedAiVolume, and when the volume was fetched (PROMPT-013). */
  aiVolumeMultiplier: number;
  fetchedAt: string | null;
  /** How many prompts use the keyword. */
  occurrences: number;
  /** Those prompts, each with its own volumes (the prompt's, not the keyword's). */
  prompts: {
    id: string;
    text: string;
    intent: string;
    volume: number;
    estimatedAiVolume: number;
  }[];
}

/**
 * A row per keyword (case-folded) across the brand's analyzed prompts.
 *
 * A keyword's volume is the demand for that one search, so it counts once
 * however many prompts share it. It used to be added again for every prompt,
 * so "seo tools" (110k a month) in 121 prompts read 13.1M. A prompt that lists
 * a keyword twice counts once, and a keyword's volume is found whatever its
 * case: google_volumes keeps the provider's spelling of each keyword.
 */
export function aggregatePromptVolumeClusters(volumes: PromptVolume[]): PromptVolumeCluster[] {
  const merged = new Map<string, PromptVolumeCluster>();

  for (const v of volumes) {
    const volumeOf = new Map(
      Object.entries(v.googleVolumes).map(([kw, n]) => [kw.trim().toLowerCase(), n]),
    );
    const prompt = {
      id: v.promptId,
      text: v.promptText,
      intent: v.intent,
      volume: v.totalGoogleVolume,
      estimatedAiVolume: v.estAiVolume,
    };
    const seen = new Set<string>();

    for (const kw of v.keywords) {
      const normalized = kw.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);

      const volume = volumeOf.get(normalized) ?? 0;
      const existing = merged.get(normalized);
      if (existing) {
        // The same search has one volume; a prompt that missed it reads 0.
        if (volume > existing.volume) {
          existing.volume = volume;
          existing.estimatedAiVolume = Math.round(volume * v.aiVolumeMultiplier);
          existing.aiVolumeMultiplier = v.aiVolumeMultiplier;
        }
        // Dated by its latest fetch.
        if (v.fetchedAt && (!existing.fetchedAt || v.fetchedAt > existing.fetchedAt)) {
          existing.fetchedAt = v.fetchedAt;
        }
        existing.occurrences += 1;
        existing.prompts.push(prompt);
      } else {
        merged.set(normalized, {
          keyword: kw,
          volume,
          estimatedAiVolume: Math.round(volume * v.aiVolumeMultiplier),
          aiVolumeMultiplier: v.aiVolumeMultiplier,
          fetchedAt: v.fetchedAt ?? null,
          occurrences: 1,
          prompts: [prompt],
        });
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.volume - a.volume);
}
