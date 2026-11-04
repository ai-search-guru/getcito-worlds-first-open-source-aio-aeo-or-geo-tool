import { PLAN_ORDER, PLANS, type PlanId } from '@/config/plans';
import index from './entries.json';

/**
 * What's new (CHAT-11, Chat Wave 4 W4-20): short, benefit-only notes on
 * what GetCito added, written by the team and approved by GetCito maintainers in the
 * pull request (owner decision 13), kept in the repo's /whats-new folder as
 * Help articles are. Chat picks, orders and may translate them; it never
 * writes or changes one. Pure: the approved ones are copied into
 * entries.json (entries.test.ts keeps it in step with the folder).
 *
 * An entry is `whats-new/{slug}.md`: front matter, then three or four
 * lines in order — why we built it, what it does, how you benefit, what
 * you can do (two may share a line). See whats-new/README.md.
 */

/** How an entry shows to a workspace whose plan doesn't include it (CHAT-11 item 15). */
export const PLAN_MODES = ['hide', 'show_upgrade'] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

export interface WhatsNewEntry {
  slug: string;
  /** "Agent Center" */
  feature: string;
  /** The one sentence Chat Home's New line shows. */
  homeLine: string;
  /** The page Try it opens, with the brand open now. */
  route: `/dashboard/${string}`;
  /** The plans that include it. */
  plans: PlanId[];
  planMode: PlanMode;
  /** YYYY-MM-DD: it shows from this day on. */
  published: string;
  /** Three or four lines, one sentence each. */
  lines: string[];
}

/** Lines an entry has at least and at most, and the longest a line may be. */
export const MIN_LINES = 3;
export const MAX_LINES = 4;
export const MAX_LINE_CHARS = 120;
export const MAX_FEATURE_CHARS = 40;

/**
 * Words an entry never uses (CHAT-11 item 3): model names, API terms,
 * versions and internal codes. Benefit only, in the app's own words.
 */
export const BLOCKED_WORDS: readonly RegExp[] = [
  /\b(claude|anthropic|sonnet|haiku|opus|llama|mistral|deepseek|grok|nano banana)\b/i,
  /\bgpt-?\d/i,
  /\b(api|apis|sdk|endpoints?|backend|back-end|frontend|front-end|server|servers|database|sql|migrations?|json|tokens?|refactor(ed)?|rebuilt|codebase)\b/i,
  /\b(release notes?|version)\b/i,
  // A version number: v2, 0.3.0, 2.5.
  /\bv\d+(\.\d+)*\b|\b\d+\.\d+(\.\d+)?\b/i,
  // An internal code: CHAT-11, AC-010, W4-20, #1234.
  /\b[A-Z]{1,6}\d?-\d+\b|#\d+\b/,
];

/** A price (CHAT-11 item 4): plans and prices come from Billing. */
export const PRICE = /[$€£]|\/\s?mo\b|\/\s?month\b|\bper month\b|\b(usd|eur|gbp)\b/i;

/** A plan named in an entry's text: the plans come from Billing, never from the words. */
export const PLAN_NAME = /\b(Starter|Growth|Enterprise|Self-Hosted|Free trial)\b/;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An entry's file read: its front matter's fields as written, and its lines. */
export interface ParsedEntry {
  slug: string;
  meta: Record<string, unknown>;
  lines: string[];
}

function parseValue(raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner === ''
      ? []
      : inner.split(',').map((item) => item.trim().replace(/^["']|["']$/g, ''));
  }
  if (value === 'true' || value === 'false') return value === 'true';
  return value.replace(/^["']|["']$/g, '');
}

/** An entry file (`whats-new/{slug}.md`) as written, front matter and lines. */
export function parseEntryFile(path: string, text: string): ParsedEntry {
  const slug = (path.replace(/\\/g, '/').split('/').at(-1) ?? '').replace(/\.md$/, '');
  const meta: Record<string, unknown> = {};
  let body = text;
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match) {
    for (const line of match[1].split('\n')) {
      const at = line.indexOf(':');
      if (at <= 0) continue;
      meta[line.slice(0, at).trim()] = parseValue(line.slice(at + 1));
    }
    body = text.slice(match[0].length);
  }
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { slug, meta, lines };
}

/** Whether `route` is a page of the app, by the page files it has (`pageExists`). */
export type PageCheck = (route: string) => boolean;

/** What's wrong with an entry, in words; empty when nothing is. */
export function entryProblems(entry: ParsedEntry, pageExists: PageCheck): string[] {
  const problems: string[] = [];
  const { meta, lines } = entry;
  const say = (problem: string) => problems.push(`${entry.slug}: ${problem}`);
  if (!SLUG.test(entry.slug)) say('the file name is not kebab-case');
  const feature = meta.feature;
  if (typeof feature !== 'string' || !feature.trim()) say('feature is missing');
  else if (feature.length > MAX_FEATURE_CHARS)
    say(`feature is over ${MAX_FEATURE_CHARS} characters`);
  const homeLine = meta.home_line;
  if (typeof homeLine !== 'string' || !homeLine.trim()) say('home_line is missing');
  else {
    if (homeLine.length > MAX_LINE_CHARS) say(`home_line is over ${MAX_LINE_CHARS} characters`);
    if (!/[.!?]$/.test(homeLine)) say('home_line is not one sentence');
  }
  const route = meta.route;
  if (
    typeof route !== 'string' ||
    !/^\/dashboard\/[a-z0-9\-/]*$/.test(route) ||
    route.includes('//')
  ) {
    say('route is not a page of the app (/dashboard/…, no query)');
  } else if (!pageExists(route)) {
    say(`route ${route} is not a page of the app`);
  }
  const plans = meta.plans;
  if (
    !Array.isArray(plans) ||
    plans.length === 0 ||
    plans.some((plan) => !PLAN_ORDER.includes(plan as PlanId))
  ) {
    say(`plans must list some of ${PLAN_ORDER.join(', ')}`);
  }
  if (!PLAN_MODES.includes(meta.plan_mode as PlanMode))
    say('plan_mode must be hide or show_upgrade');
  const published = meta.published;
  if (
    typeof published !== 'string' ||
    !DAY.test(published) ||
    Number.isNaN(Date.parse(`${published}T00:00:00Z`))
  ) {
    say('published is not a day (YYYY-MM-DD)');
  }
  if (typeof meta.approved !== 'boolean') say('approved must be true or false');
  if (lines.length < MIN_LINES || lines.length > MAX_LINES) {
    say(`has ${lines.length} lines; an entry has ${MIN_LINES} or ${MAX_LINES}`);
  }
  lines.forEach((line, i) => {
    if (line.length > MAX_LINE_CHARS) say(`line ${i + 1} is over ${MAX_LINE_CHARS} characters`);
    if (!/[.!?]$/.test(line)) say(`line ${i + 1} doesn't end a sentence`);
    if (/^[-*#>]|\[.*\]\(|<[a-z]/i.test(line)) say(`line ${i + 1} has Markdown or a link`);
  });
  const words = [feature, homeLine, ...lines].filter((w): w is string => typeof w === 'string');
  for (const text of words) {
    const blocked = BLOCKED_WORDS.map((word) => word.exec(text)?.[0]).find(Boolean);
    if (blocked) say(`uses "${blocked}": no model names, API terms, versions or internal codes`);
    if (PRICE.test(text)) say('names a price: prices come from Billing');
    const plan = PLAN_NAME.exec(text)?.[0];
    if (plan) say(`names the plan "${plan}": plans come from Billing (plans:)`);
  }
  return problems;
}

/** An approved entry as entries.json keeps it; null for one that isn't approved or valid. */
export function approvedEntry(entry: ParsedEntry, pageExists: PageCheck): WhatsNewEntry | null {
  if (entry.meta.approved !== true || entryProblems(entry, pageExists).length > 0) return null;
  const meta = entry.meta as Record<string, string & string[]>;
  return {
    slug: entry.slug,
    feature: meta.feature,
    homeLine: meta.home_line,
    route: meta.route as WhatsNewEntry['route'],
    plans: PLAN_ORDER.filter((plan) => meta.plans.includes(plan)),
    planMode: meta.plan_mode as PlanMode,
    published: meta.published,
    lines: entry.lines,
  };
}

/** Newest first, then by slug: the order entries.json keeps and Chat reads. */
export function byNewest(a: WhatsNewEntry, b: WhatsNewEntry): number {
  return b.published.localeCompare(a.published) || a.slug.localeCompare(b.slug);
}

/** The approved entries, newest first. */
export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  ...(index.entries as WhatsNewEntry[]),
].sort(byNewest);

/** The plan facts an entry's access needs. */
export interface EntryPlan {
  planId: PlanId;
  selfHosted: boolean;
}

/**
 * How an entry shows on a plan (CHAT-11 §D): `included`; `upgrade`, with
 * "On {plans}." and See plans; or hidden. A trial sees its plan's
 * (plan-facts' planId); self-hosted has every feature.
 */
export function entryAccess(
  entry: Pick<WhatsNewEntry, 'plans' | 'planMode'>,
  plan: EntryPlan,
): 'included' | 'upgrade' | 'hidden' {
  if (plan.selfHosted || entry.plans.includes(plan.planId)) return 'included';
  return entry.planMode === 'show_upgrade' ? 'upgrade' : 'hidden';
}

/** "Growth and Enterprise", the plans by the names Billing gives them. */
export function plansLine(plans: readonly PlanId[]): string {
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(
    plans.map((plan) => PLANS[plan].name),
  );
}

/** Whether an entry shows yet: its day has come, by UTC. */
export function isPublished(entry: Pick<WhatsNewEntry, 'published'>, now: Date): boolean {
  return entry.published <= now.toISOString().slice(0, 10);
}

/** Whole days from an entry's day to now. */
export function daysSince(entry: Pick<WhatsNewEntry, 'published'>, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(`${entry.published}T00:00:00Z`)) / 86_400_000);
}

/** The words a person may name an entry by: its feature or its slug. */
export function matchesFeature(entry: WhatsNewEntry, asked: string): boolean {
  const words = asked.trim().toLowerCase();
  if (!words) return false;
  const feature = entry.feature.toLowerCase();
  return (
    feature === words || entry.slug === words || words.includes(feature) || feature.includes(words)
  );
}
