import { z } from 'zod';
import { fixDraftRules, fixRulesInput } from './contentAgent.js';

/**
 * Quality's hand-off (Content Editor Quality spec §5, CE-051): the Content
 * Agent fixes every fixable Quality suggestion in one run, as suggestions
 * the person reviews; what only the person can give stays a to-do. The
 * editor reads the checks (they're computed in the browser) and sends each
 * fixable one by its key, with what it names on the page (its sentences,
 * links, the disclosure line); the server says what each asks, in its own
 * words. One run, on the workspace's AI budget, as Fix open rules is.
 */

/** Each fixable check, by the editor's suggestion key: what the agent is asked. */
export const HANDOFF_CHECKS = {
  'readability:avgSentence':
    'Average sentence 15–20 words: split the longest sentences, saying the same thing',
  'readability:longSentences': 'No sentence over 35 words: split each into two or three',
  'readability:readingLevel':
    'Easier to read: shorter sentences and words, plain words for jargon, the meaning kept',
  'readability:answerFirst':
    'Answer first: the first paragraph under the H1 answers what the H1 asks, in 60 words or fewer',
  'readability:shortParagraphs': 'Short paragraphs: 4 sentences at most; split longer ones',
  'readability:headingSpacing':
    'A heading every 200–300 words: add an H2 or H3 where a section runs long, named for what it covers',
  'readability:passiveJargon': 'Active voice and plain words: rewrite passive sentences and jargon',
  'readability:typeRules':
    "The page type's own rules named here, each with its aim and how the page reads now (a specs table, a side-by-side table, an intro, a buying FAQ, how-to steps): meet each aim from the page and your data only; a table of facts (specs, sizes) gets only the facts given, {{ask: …}} in a cell you can't fill, never one made up; an answer the page and your data don't give (fit, sizes, shipping, returns, prices) is {{ask: …}} too, never one made up",
  'trust:claimsSourced':
    'Every figure or claim has a source in its paragraph: link one from your data; where you have none, ask for it to be looked up with {{find: …}} or soften the claim, never make one up',
  'trust:brandFacts':
    "Match the brand's approved facts named here (prices, trial length, founding year) where the page differs",
  'trust:freshSources':
    'Sources from the last 24 months: where your data has a newer source for the same point, link it instead',
  'trust:noWeakSources':
    "No forum, social post or competitor's page as a source: link a study, an official page or data from your data instead, where you have one",
  'trust:primarySources':
    'At least one primary source (an official page, research, a standard) from your data, linked where it supports the page',
  'trust:disclosure':
    "The page recommends the brand's own product: add the disclosure line given here, as it is, under the page's opening paragraph",
  'trust:balanced':
    "Balance: say where the brand's own product falls short, or where another option is the better pick, from the page and your data only; where you don't know, leave it out",
  'trust:noBrokenLinks':
    "Links that don't answer: link a working source from your data for the same point instead, or soften the claim",
};

export const HANDOFF_KEYS = Object.keys(HANDOFF_CHECKS);

export const handOffInput = fixRulesInput.omit({ rules: true }).extend({
  /** The fixable checks open on the page, each with what it names there. */
  items: z
    .array(
      z.object({
        key: z.enum(HANDOFF_KEYS),
        detail: z.string().trim().max(500).default(''),
      }),
    )
    .min(1)
    .max(HANDOFF_KEYS.length),
  /** A person's Hand off, or the editor's on its own (Settings › Content). */
  origin: z.enum(['person', 'auto']).default('person'),
});

/**
 * Hands the draft's open Quality checks to the Content Agent: one run of
 * Fix open rules' kind 'handoff', the checks as its rules in the server's
 * words (each key once), and the same answers and errors (fixDraftRules).
 */
export async function handOffDraft({ draftId, brandId, input }) {
  const seen = new Set();
  const rules = input.items.flatMap(({ key, detail }) => {
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, name: HANDOFF_CHECKS[key], detail }];
  });
  return fixDraftRules({
    draftId,
    brandId,
    input: {
      rules,
      textRules: input.textRules,
      locked: input.locked,
      ...(input.sources ? { sources: input.sources } : {}),
      // Its checks add text too (an FAQ, a specs table, headings).
      ...(input.overLength ? { overLength: input.overLength } : {}),
    },
    handoff: { origin: input.origin },
  });
}
