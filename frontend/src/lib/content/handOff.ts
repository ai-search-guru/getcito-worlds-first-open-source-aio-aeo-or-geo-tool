/**
 * Hand it off to Content Agent (Quality spec §5, CE-051): what of Quality's
 * suggestions the agent fixes in one run. Every suggestion is fixable; the
 * to-dos (what only the person can give: their input, an author, proof, a
 * placeholder) stay the person's. The server says what each asks
 * (contentHandoff.js, HANDOFF_CHECKS); the editor sends what each names on
 * the page.
 */

/** The fixable checks, by Quality's suggestion key, as the API takes them. */
export const HANDOFF_KEYS: ReadonlySet<string> = new Set([
  'readability:avgSentence',
  'readability:longSentences',
  'readability:readingLevel',
  'readability:answerFirst',
  'readability:shortParagraphs',
  'readability:headingSpacing',
  'readability:passiveJargon',
  // Phase 3 (CE-052): the page type's own rules, as the Rules tab reads them.
  'readability:typeRules',
  'trust:claimsSourced',
  'trust:brandFacts',
  'trust:freshSources',
  'trust:noWeakSources',
  'trust:primarySources',
  'trust:disclosure',
  'trust:balanced',
  'trust:noBrokenLinks',
]);

/** What the API takes of a check's detail. */
const MAX_DETAIL = 500;

/**
 * The checks to hand off: the suggestions with a gain, each once, with its
 * line, its detail and the passage it shows (cut short to fit, never the
 * rest). One that asks the other way to its check stays the person's. The
 * disclosure goes only with the line to add, in the page's language
 * (disclosureText): the agent writes it as given, never one of its own.
 */
export function handOffItems(
  suggestions: readonly {
    key: string;
    gain: number;
    line: string;
    detail: string;
    show: string | null;
    handOff?: false;
  }[],
  { disclosureLine = null }: { disclosureLine?: string | null } = {},
): { key: string; detail: string }[] {
  const seen = new Set<string>();
  return suggestions.flatMap((s) => {
    if (s.gain <= 0 || s.handOff === false || !HANDOFF_KEYS.has(s.key) || seen.has(s.key)) {
      return [];
    }
    if (s.key === 'trust:disclosure' && !disclosureLine) return [];
    seen.add(s.key);
    const head = [
      s.line,
      s.detail,
      s.key === 'trust:disclosure' ? `The line: "${disclosureLine}"` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return [{ key: s.key, detail: withPassage(head, s.show) }];
  });
}

/** The detail, then the passage it shows as far as the API takes it. */
function withPassage(head: string, show: string | null): string {
  const room = MAX_DETAIL - head.length - ' · Where: "…"'.length;
  if (!show || room < 20) return head.slice(0, MAX_DETAIL);
  const passage = show.length <= room + 1 ? show : `${show.slice(0, room).trimEnd()}…`;
  return `${head} · Where: "${passage}"`;
}
