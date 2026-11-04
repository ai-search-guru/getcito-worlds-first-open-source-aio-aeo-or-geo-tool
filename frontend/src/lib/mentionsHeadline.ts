import { PLATFORM_LABELS } from '@/config/platformLabels';
import { POSITION_PLATFORMS } from '@/lib/promptPositions';
import {
  changeBasis,
  isLowSample,
  LOW_SAMPLE_MENTIONS,
  netSentiment,
  type MentionPlatformRow,
  type MentionsOverview,
} from '@/lib/mentionsOverview';

/** A platform id as the filter bar names it ("gemini-web" → "Gemini"). */
export function mentionPlatformLabel(platform: string): string {
  return (
    POSITION_PLATFORMS.find((p) => p.id === platform)?.label ??
    PLATFORM_LABELS[platform] ??
    platform
  );
}

/** Net sentiment in whole points, as the page shows it; null with no mentions. */
export function wholeNet(t: Parameters<typeof netSentiment>[0]): number | null {
  const net = netSentiment(t);
  return net === null ? null : Math.round(net);
}

/**
 * What the Overview's summary line (MS-06) says, chosen from the aggregates by
 * a fixed template, never an LLM: the net sentiment and its change, the
 * platform that moved it most, and the brands AI names you beside most often.
 * The page words it; this picks the facts.
 */
export interface MentionsHeadline {
  /** The window's net sentiment in whole points; null with no mentions. */
  net: number | null;
  /** Fewer than 20 mentions: the net is shown as a low sample, without a change. */
  lowSample: boolean;
  /** Against the window before; null when either is a low sample. */
  netChange: number | null;
  /** The platform whose net moved most the same way, when both windows have enough mentions. */
  mover: { platform: string; change: number } | null;
  /** Up to two competitors AI names in the same answers as you, most often first. */
  companions: string[];
}

export function mentionsHeadline(o: MentionsOverview): MentionsHeadline {
  const net = wholeNet(o.current);
  const lowSample = isLowSample(o.current);
  // Like the KPI cards: taken on the prompts both windows answered, and no
  // change from or to a low sample.
  const basis = changeBasis(o);
  const now = wholeNet(basis.current);
  const previous = wholeNet(basis.previous);
  const netChange =
    net !== null &&
    now !== null &&
    previous !== null &&
    !lowSample &&
    !isLowSample(basis.current) &&
    !isLowSample(basis.previous)
      ? now - previous
      : null;

  let mover: MentionsHeadline['mover'] = null;
  if (netChange !== null && netChange !== 0) {
    for (const row of o.platforms) {
      const change = platformNetChange(row);
      if (change === null || Math.sign(change) !== Math.sign(netChange)) continue;
      if (!mover || Math.abs(change) > Math.abs(mover.change)) {
        mover = { platform: row.platform, change };
      }
    }
  }

  // Named beside you only when you were named at all.
  const companions =
    o.current.mentions > 0
      ? o.competitors
          .filter((c) => c.coMentions > 0)
          .sort((a, b) => b.coMentions - a.coMentions)
          .slice(0, 2)
          .map((c) => c.name)
      : [];

  return { net, lowSample, netChange, mover, companions };
}

/**
 * A platform's net sentiment change against the window before, on the prompts
 * both windows answered (00195; all of them before it), only when both have
 * enough mentions to say so (fewer than 20 is a low sample).
 */
export function platformNetChange(row: MentionPlatformRow): number | null {
  const current = row.same?.current ?? row;
  const previous = row.same?.previous ?? row.previous;
  if (current.mentions < LOW_SAMPLE_MENTIONS || previous.mentions < LOW_SAMPLE_MENTIONS) {
    return null;
  }
  const now = wholeNet(current);
  const before = wholeNet(previous);
  return now !== null && before !== null ? now - before : null;
}

/** Platforms whose net sentiment differs by at least this many points disagree. */
export const PLATFORM_DISAGREEMENT_POINTS = 40;

/**
 * The most and least favourable platforms when they disagree (spec §6:
 * "ChatGPT is +54 but Gemini is −6"); null when they don't, or when fewer
 * than two have enough mentions to compare.
 */
export function platformDisagreement(
  rows: MentionPlatformRow[],
): { high: { platform: string; net: number }; low: { platform: string; net: number } } | null {
  const nets = rows
    .filter((r) => r.mentions >= LOW_SAMPLE_MENTIONS)
    .map((r) => ({ platform: r.platform, net: wholeNet(r) as number }));
  if (nets.length < 2) return null;
  const high = nets.reduce((a, b) => (b.net > a.net ? b : a));
  const low = nets.reduce((a, b) => (b.net < a.net ? b : a));
  return high.net - low.net >= PLATFORM_DISAGREEMENT_POINTS ? { high, low } : null;
}
