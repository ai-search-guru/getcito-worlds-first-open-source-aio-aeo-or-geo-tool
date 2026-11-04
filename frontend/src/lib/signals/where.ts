/**
 * Where a signal happened: the AI platforms and tracked locations it is about
 * (AC-002).
 *
 * Signal rows have no platform or location columns. A few kinds name theirs
 * in the payload: a platform whose visibility fell, the weakest country. The
 * prompt and topic kinds are about prompts, and a prompt's own platforms and
 * locations are where it was measured, so those are read from the prompts.
 * That is where a prompt is tracked, which can be wider than where the change
 * itself happened; the list says "Tracked on" for that reason. Kinds about a
 * competitor, a source domain or the whole brand have no place of their own
 * and stay empty.
 */

export interface SignalWhere {
  /** Platform or model slugs as stored (`gemini-web`, `gpt-5-6`), most common first. */
  platforms: readonly string[];
  /** Location codes (`US`, `US-CA`), most common first. Empty when untargeted. */
  regions: readonly string[];
  /** The topics of the prompts it is about, by name; what tells copies of one prompt apart. */
  topics: readonly string[];
}

/** Where one prompt is tracked, the topic it belongs to, and whether it still runs. */
export interface PromptPlace {
  platforms: string[];
  regions: string[];
  topicId: string | null;
  topic: string | null;
  isActive: boolean;
}

// Shared by every signal without a place; readonly, so no caller can fill it in.
export const NO_WHERE: SignalWhere = { platforms: [], regions: [], topics: [] };

// Shopping answers never feed a signal (the detectors skip them), so the
// platform would only be noise beside the engines that did.
const IGNORED_PLATFORMS = new Set(['chatgpt-shopping']);

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function targetIds(payload: Record<string, unknown>): string[] {
  const targets = Array.isArray(payload.targets) ? (payload.targets as { id?: unknown }[]) : [];
  return targets.map((target) => str(target?.id)).filter((id): id is string => id !== null);
}

/** Values ordered by how many of the counted items carry them, then by name. */
function byFrequency(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([value]) => value);
}

/** The prompts a signal is about, by id: its own prompt, its list, or its prompt targets. */
function promptIdsOf(payload: Record<string, unknown>): string[] {
  const own = str(payload.promptId);
  if (own) return [own];
  if (Array.isArray(payload.promptIds)) {
    return payload.promptIds.map(str).filter((id): id is string => id !== null);
  }
  return payload.entity === 'prompts' ? targetIds(payload) : [];
}

export function signalWhere(
  payload: Record<string, unknown>,
  prompts: ReadonlyMap<string, PromptPlace>,
): SignalWhere {
  const platform = str(payload.platform);
  const region = str(payload.region);
  if (platform || region) {
    return { platforms: platform ? [platform] : [], regions: region ? [region] : [], topics: [] };
  }

  let places: PromptPlace[] = [];
  if (payload.entity === 'topics') {
    // A topic is measured over its tracked prompts; a paused one ran nowhere.
    const topics = new Set(targetIds(payload));
    places = [...prompts.values()].filter(
      (p) => p.isActive && p.topicId !== null && topics.has(p.topicId),
    );
  } else {
    places = promptIdsOf(payload)
      .map((id) => prompts.get(id))
      .filter((p): p is PromptPlace => p !== undefined);
  }
  const tracked =
    places.length === 0
      ? NO_WHERE
      : mergeWhere(
          places.map((p) => ({
            platforms: p.platforms.filter((x) => !IGNORED_PLATFORMS.has(x)),
            regions: p.regions,
            topics: p.topic ? [p.topic] : [],
          })),
        );

  // A lost citation records the platforms and locations it was lost on
  // (server signals/lostCitationEvidence.js): where it happened, which
  // beats where its prompt is tracked.
  const lostOn = strings(payload.platforms);
  if (lostOn.length === 0) return tracked;
  return { platforms: lostOn, regions: strings(payload.regions), topics: tracked.topics };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v !== '')
    : [];
}

/**
 * Several places as one: every platform, location and topic, the ones most
 * of them share first. Each place counts a value once, so "most common"
 * means most prompts, or most signals of a group.
 */
export function mergeWhere(wheres: SignalWhere[]): SignalWhere {
  if (wheres.length === 0) return NO_WHERE;
  return {
    platforms: byFrequency(wheres.flatMap((w) => [...new Set(w.platforms)])),
    regions: byFrequency(wheres.flatMap((w) => [...new Set(w.regions)])),
    topics: byFrequency(wheres.flatMap((w) => [...new Set(w.topics)])),
  };
}
