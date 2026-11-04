import * as cheerio from 'cheerio';
import { draftPassages, keepSuggestions } from '../../contentAgent.js';
import { inputSources } from '../../contentInputs.js';
import { NAME, isKnown, knownPeople } from '../../contentPeople.js';
import {
  htmlText,
  knownNumbers,
  numberSources,
  sourceWords,
  todayText,
} from '../../contentSources.js';
import { renderPage, sourcedPage } from '../../contentWriter.js';

/**
 * The no-fabrication test set's answers as the Content Agent's runs keep
 * them (Quality spec §9), for noFabrication.test.js and
 * evalNoFabrication.js alike.
 */

/** What a run gives the guards, as fixWithRun and writeWithRun build it. */
export function sourcing(c) {
  const numbered = numberSources({
    prompts: c.prompts,
    fanouts: c.fanouts,
    inputs: inputSources(c.inputs, c.brand.name),
  });
  const given = [htmlText(c.html), c.title, c.brand.name, c.brand.industry, c.brand.description];
  const known = knownNumbers(...given, todayText());
  const people = knownPeople(
    ...given,
    ...numbered.map(sourceWords),
    // As authorWords reads Settings › Authors.
    ...c.authors.flatMap((a) => [a.name, a.title]),
  );
  const knownInPage = new Set([...known, ...knownNumbers(...numbered.map(sourceWords))]);
  return { numbered, known, people, knownInPage };
}

/** A suggestion's sources as the agent names them: the person's data by its number. */
export const resolve = (numbered) => (s) => ({
  ...s,
  sources: s.sources.map((ref) =>
    ref.startsWith('@') ? (numbered.find((n) => n.ref === ref.slice(1))?.id ?? ref) : ref,
  ),
});

/** Text of HTML, a line for each block: a heading's words never run into the next paragraph's. */
const textOf = (html) =>
  cheerio
    .load(String(html).replace(/<\/(?:h[1-6]|p|li|blockquote|td|th)>/gi, '$&\n'), null, false)
    .root()
    .text();

/** What suggestions leave on the page once kept: each one's words. */
export function guardedFix(c, suggestions, open = new Set(['dated'])) {
  const { numbered, known, people } = sourcing(c);
  return keepSuggestions(
    suggestions.map(resolve(numbered)),
    draftPassages(c.html),
    new Set(),
    open,
    null,
    { numbered, known, people },
  ).map((row) => (row.kind === 'replace' ? row.after_text : textOf(row.after_text)));
}

/**
 * What a page written whole says once the guards have read it. The facts
 * pass after them (contentResearch.js: a fact looked up, or its sentence
 * written without it) needs the web, so it isn't run here: its own tests
 * hold it to the same rule.
 */
export function guardedPage(c, page) {
  const { people, knownInPage } = sourcing(c);
  return textOf(renderPage(sourcedPage(page, knownInPage, people)));
}

/** Text as compared: lower case, one kind of quote mark, single spaces. */
export const plain = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[“”„«»"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** A name as the people guard reads one: capitalised words, initials, particles. */
const NAMES = new RegExp(NAME, 'gu');
/** A quoted span, each pair of marks apart: an apostrophe inside ("don’t") ends none. */
const QUOTED = [
  /“([^“”]{1,800})”/g,
  /„([^„“”]{1,800})[“”]/g,
  /‚([^‚‘’]{1,800})[‘’]/g,
  /«([^«»]{1,800})»/g,
  /»(?=\S)([^»«]{1,800})(?<=\S)«/g,
  /(?<![\p{L}\p{N}])"([^"\n]{1,800})"(?![\p{L}\p{N}])/gu,
  /(?<!\p{L})‘([^‘]{1,800}?)’(?!\p{L})/gu,
];

/**
 * What a person should look over in a kept text, without the guards' cues:
 * every name (as the people guard reads one, a possessive's "’s" off) and
 * every quoted span of four words or more that the agent wasn't given, as
 * whole words. The guards read cues ("says", "CEO", "Dr."): this reads
 * none, so it shows what they miss.
 */
export function toReview(c, text) {
  const { people } = sourcing(c);
  const spans = [
    // A line at a time: a name doesn't run from a heading into its paragraph.
    ...text
      .split('\n')
      .flatMap((line) => [...line.matchAll(NAMES)])
      .map((m) => m[0].replace(/['’]s$/u, '')),
    ...QUOTED.flatMap((re) => [...text.matchAll(re)])
      // Its words, not the comma or stop kept inside the marks.
      .map((m) => m[1].trim().replace(/[\s,.;:!?…]+$/u, ''))
      .filter((inner) => inner.split(/\s+/).length >= 4),
  ];
  return [...new Set(spans.filter((span) => !isKnown(span, people)))];
}
