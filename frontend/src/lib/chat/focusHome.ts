import type { FocusArea } from './focus';
import type { ShortcutId } from './shortcuts';

/**
 * Chat Home by the person's focus (CHAT-24 §4; mockup DEPTS): each area's
 * shortcuts and starter questions, merged in turn so every picked area
 * shows (1st of each, then the 2nd of each…), its greeting line when the
 * workspace's data has something true to say, and which skills come first
 * in the / menu. Focus only changes suggestions: what a shortcut may do is
 * still the person's role's.
 */

/** Each area's shortcuts, in the order they come (mockup DEPTS `sc`). */
export const FOCUS_SHORTCUTS = {
  lead: ['boardSummary', 'whatChanged', 'competitorMoves'],
  comp: ['competitorMoves', 'promptsLost', 'citedForRivals', 'platformShare'],
  growth: ['trafficReport', 'promptsConvert', 'landingPages'],
  seo: ['winBack', 'tasks', 'auditFixes', 'weeklyReport'],
  content: ['writeNext', 'qualityPass', 'publish'],
  brand: ['factCheck', 'howAiDescribes', 'sentimentByPlatform', 'storySources'],
  pd: ['buyerQuestions', 'howAiCompares', 'unmetNeeds', 'productDigest'],
  bd: ['marketGaps', 'listingGaps', 'publisherSites', 'marketSnapshot'],
} as const satisfies Record<FocusArea, readonly string[]>;
export type FocusShortcut = (typeof FOCUS_SHORTCUTS)[FocusArea][number];

/**
 * The GetCito skill a shortcut asks with, where it has one (skills/): its
 * message starts with the skill's /name, so the skill loads. The focus
 * areas' seven skills (W2-23) take their chips' jobs too (W2-09).
 */
export const SHORTCUT_SKILL: Partial<Record<FocusShortcut, string>> = {
  tasks: 'tasks',
  winBack: 'winback',
  publish: 'publish',
  qualityPass: 'quality',
  weeklyReport: 'report',
  factCheck: 'wrongclaim',
  auditFixes: 'audit-fix',
  buyerQuestions: 'questions',
  howAiCompares: 'features',
  unmetNeeds: 'gaps',
  listingGaps: 'listings',
  marketSnapshot: 'markets',
};

/**
 * The shortcut playbook (CHAT-08, lib/chat/shortcuts.ts) a chip without a
 * skill runs with (W2-09): its message goes with the shortcut's id, so the
 * run reads that shortcut's data plan. The server takes the id only with
 * the chip's own words (shortcutPlaybooks.ts). Chips whose job is no
 * shortcut's (a board summary, a product digest) go as plain questions.
 */
export const SHORTCUT_PLAYBOOK: Partial<Record<FocusShortcut, ShortcutId>> = {
  whatChanged: 'analyze',
  competitorMoves: 'analyze',
  promptsLost: 'analyze',
  platformShare: 'analyze',
  promptsConvert: 'analyze',
  landingPages: 'analyze',
  howAiDescribes: 'analyze',
  sentimentByPlatform: 'analyze',
  storySources: 'analyze',
  citedForRivals: 'opportunities',
  writeNext: 'opportunities',
  publisherSites: 'opportunities',
  trafficReport: 'new-report',
};

/** Each area's starter questions (mockup DEPTS `st`). */
export const FOCUS_STARTERS = {
  lead: ['winning', 'recommendedInstead', 'lastMonthWork'],
  comp: ['gainedMost', 'whyRival', 'lostThisWeek', 'rivalSources'],
  growth: ['answersSignups', 'landingLoss', 'risingPrompts'],
  seo: ['citationChange', 'shouldCite', 'lostToRival'],
  content: ['writeNextQuestion', 'noGoodAnswer', 'briefTopic'],
  brand: ['describe', 'factCheckPricing', 'sentimentChange', 'shapeSources'],
  pd: ['buyersAsk', 'rivalFeatures', 'noWinner', 'launch'],
  bd: ['rivalsInMarket', 'trustedSites', 'segments', 'marketAsk'],
} as const satisfies Record<FocusArea, readonly string[]>;
export type FocusStarter = (typeof FOCUS_STARTERS)[FocusArea][number];

/**
 * The workspace's own words a starter question is filled with (CHAT-24 §4):
 * its most mentioned competitor, its topic with the most prompts, and a
 * second market when it tracks more than one country. Null: unknown, and
 * the question takes its general wording.
 */
export interface FocusFill {
  rival: string | null;
  topic: string | null;
  market: string | null;
}

/** Nothing known yet, or nothing that could be read: every question in its general wording. */
export const NO_FILL: FocusFill = { rival: null, topic: null, market: null };

/** The questions filled with a value, and the one each needs. */
const STARTER_NEEDS = {
  whyRival: 'rival',
  lostToRival: 'rival',
  rivalFeatures: 'rival',
  briefTopic: 'topic',
  buyersAsk: 'topic',
  rivalsInMarket: 'market',
  marketAsk: 'market',
} as const satisfies Partial<Record<FocusStarter, keyof FocusFill>>;
type FilledStarter = keyof typeof STARTER_NEEDS;

/** A starter question's message: its own, or its general wording (`…Any`). */
export type StarterKey = FocusStarter | `${FilledStarter}Any`;

/**
 * A starter question's words: its message key and values, or the key of its
 * general wording (`…Any`) when the value it needs is unknown.
 */
export function starterWords(
  starter: FocusStarter,
  fill: FocusFill,
): { key: StarterKey; values: Record<string, string> } {
  if (!(starter in STARTER_NEEDS)) return { key: starter, values: {} };
  const need = STARTER_NEEDS[starter as FilledStarter];
  const value = fill[need];
  return value
    ? { key: starter, values: { [need]: value } }
    : { key: `${starter as FilledStarter}Any`, values: {} };
}

/**
 * Lists merged in turn: the 1st of each, then the 2nd of each…, each item
 * once (by its id), at most `max`.
 */
export function inTurn<T>(
  lists: readonly (readonly T[])[],
  max: number,
  id: (item: T) => string = String,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest && out.length < max; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item === undefined || out.length >= max || seen.has(id(item))) continue;
      seen.add(id(item));
      out.push(item);
    }
  }
  return out;
}

/** A starter question with the area it came from (CHAT-24 §8 `chat_starter_clicked`). */
export interface StarterPick {
  area: FocusArea;
  starter: FocusStarter;
}

/** Home's starter questions: four, every picked area in turn. */
export function focusStarters(focus: readonly FocusArea[], max = 4): StarterPick[] {
  return inTurn(
    focus.map((area) => FOCUS_STARTERS[area].map((starter) => ({ area, starter }))),
    max,
    (pick) => pick.starter,
  );
}

/** A competitor whose mention rate moved this week against the one before, in points. */
export interface RivalMove {
  name: string;
  points: number;
}

/** The smallest move a greeting line names: the impact report's minimum change. */
export const MIN_GREETING_POINTS = 3;

/**
 * The line under the greeting (CHAT-24 §4): from the first picked area with
 * something true to say, or null for the default line. Only Competitors has
 * data to say it with today: a competitor whose mention rate rose.
 */
export function focusGreeting(
  focus: readonly FocusArea[],
  facts: { rivalMove: RivalMove | null },
): { key: 'rivalRose'; values: { rival: string; points: number } } | null {
  for (const area of focus) {
    if (area === 'comp' && facts.rivalMove && facts.rivalMove.points >= MIN_GREETING_POINTS) {
      return {
        key: 'rivalRose',
        values: { rival: facts.rivalMove.name, points: facts.rivalMove.points },
      };
    }
  }
  return null;
}

/**
 * The new skills "New for you" offers for each area (CHAT-24 §4f, §5;
 * mockup NEWS): its seven, and Fix wrong claims about us for Brand (the
 * mockup's /factcheck). Only what Chat has: the mockup's agents and
 * integrations join once they exist.
 */
export const FOCUS_NEW: Record<FocusArea, readonly string[]> = {
  lead: [],
  comp: ['rivals'],
  growth: [],
  seo: ['audit-fix'],
  content: [],
  brand: ['wrongclaim'],
  pd: ['questions', 'features', 'gaps'],
  bd: ['listings', 'markets', 'gaps'],
};

/** A new skill for the picked areas, with the area it came from. */
export interface NewPick {
  area: FocusArea;
  skill: string;
}

/** "New for you": four at most, every picked area in turn; none when nothing matches. */
export function focusNews(focus: readonly FocusArea[], max = 4): NewPick[] {
  return inTurn(
    focus.map((area) => FOCUS_NEW[area].map((skill) => ({ area, skill }))),
    max,
    (pick) => pick.skill,
  );
}

/** The skills each area brings first in the / menu (CHAT-24 §1). */
export const FOCUS_SKILLS: Record<FocusArea, readonly string[]> = {
  lead: ['report'],
  comp: ['beat'],
  growth: [],
  seo: ['winback', 'tasks', 'answerfirst', 'refresh'],
  content: ['quality', 'faq', 'publish', 'refresh', 'compare', 'translate'],
  brand: ['wrongclaim', 'facts'],
  pd: ['compare', 'faq'],
  bd: [],
};

/**
 * The skills with the picked areas' first, in the order picked, each area's
 * new skills (CHAT-24 §5) after its own; the rest as they were.
 */
export function skillsByFocus<T extends { name: string }>(
  skills: readonly T[],
  focus: readonly FocusArea[],
): T[] {
  const first = inTurn(
    focus.map((area) => [...FOCUS_SKILLS[area], ...FOCUS_NEW[area]]),
    Infinity,
  );
  const rank = (skill: T) => {
    const at = first.indexOf(skill.name);
    return at === -1 ? first.length : at;
  };
  return [...skills].sort((a, b) => rank(a) - rank(b));
}
