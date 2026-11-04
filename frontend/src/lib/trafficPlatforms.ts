import type { TrafficEngagement, TrafficSummary } from '@/lib/actions/traffic';
import { largestMove } from '@/lib/chat/pageContext';

/**
 * AI referrers by the name their platform goes by. Keys are the AI source
 * list's (`backend/src/lib/ai-sources.json`), which the tracking snippet and
 * the Analytics sync both store (AT-004). The other ChatGPT hosts are kept
 * for rows from before the list, and `unknown` for historical rows that
 * predate #288 (null source_platform).
 */
const PLATFORM_NAMES: Record<string, string> = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'search.chatgpt.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'you.com': 'You.com',
  'phind.com': 'Phind',
  'meta.ai': 'Meta AI',
  'poe.com': 'Poe',
  'labs.google': 'Google Labs',
  'bing.com': 'Bing',
  'grok.com': 'Grok',
  'deepseek.com': 'DeepSeek',
  unknown: 'Unknown',
};

export function getPlatformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

/**
 * A platform the page can name. The snippet's beacon is public, so a source
 * key can be anything a caller sent. The weekly digest's isNamedPlatform
 * (platform-names.json, the same names) reads it the same way, so the two
 * name the same platform as the one that sent the most.
 */
export function isNamedPlatform(platform: string): boolean {
  return platform !== 'unknown' && Object.hasOwn(PLATFORM_NAMES, platform);
}

/**
 * The surfaces a platform's visits can come through, from the AI source
 * list's `surfaces`: ChatGPT Shopping's product cards (#1283). A surface's
 * visits are part of its platform's, never added to them. Each has a name
 * in en.json's traffic.platforms.surfaces.
 */
export const PLATFORM_SURFACES = ['shopping'] as const;

export type PlatformSurface = (typeof PLATFORM_SURFACES)[number];

export function isPlatformSurface(value: string): value is PlatformSurface {
  return (PLATFORM_SURFACES as readonly string[]).includes(value);
}

/** A Referrals by Platform row: a platform, or one of its surfaces. */
export interface PlatformTableRow {
  platform: string;
  /** Set on a surface's row, whose visits are part of its platform's. */
  surface: PlatformSurface | null;
  visits: number;
  visitsPrev: number;
  analytics: TrafficEngagement | null;
}

/**
 * The platforms as the table and its export list them: each platform, then
 * its surfaces right under it (ChatGPT, then ChatGPT Shopping), so a surface
 * reads as part of its platform rather than as one more.
 */
export function platformTableRows(
  breakdown: TrafficSummary['platformBreakdown'],
): PlatformTableRow[] {
  return breakdown.flatMap(({ surfaces, ...row }) => [
    { ...row, surface: null },
    ...surfaces.map((s) => ({ ...s, platform: row.platform })),
  ]);
}

/**
 * The platform whose visits moved most against the previous period, for
 * Chat's side panel (W1-08): only a platform the page can name, as the
 * summary line does, and nothing without a previous period (all time),
 * where every platform would read as a rise.
 */
export function movedPlatformOf(
  summary: Pick<TrafficSummary, 'hasPreviousPeriod' | 'platformBreakdown'> | null | undefined,
): { name: string; change: number } | null {
  if (!summary?.hasPreviousPeriod) return null;
  return largestMove(
    summary.platformBreakdown
      .filter((row) => isNamedPlatform(row.platform))
      .map((row) => ({ name: getPlatformName(row.platform), change: row.visits - row.visitsPrev })),
  );
}
