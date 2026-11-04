import { existsSync, readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { CASES } from './__fixtures__/no-fabrication/cases.js';

/**
 * No invented people, quotes or numbers (Content Editor Quality spec §9):
 * the Content Agent's answers on every draft in cases.js go through the guards
 * as its runs put them (keepSuggestions for its suggestions, sourcedPage
 * for a page it writes whole), with what it was given: the page, the
 * brand, the authors, the Sources tab's data and Brief › Your input. None
 * of what it made up may survive, and none of what it was given may be
 * taken out. Answers recorded from the model (evalNoFabrication.js) are
 * read the same way: the guards must find nothing left to take out of what
 * they let through (they are stable), and what they let through that the
 * agent wasn't given must be what a person has looked over (toReview, kept
 * in recorded.json as `reviewed`): the guards' cues can't vouch for
 * themselves.
 */

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { draftPassages, keepSuggestions } = await import('./contentAgent.js');
const { peopleEdits } = await import('./contentPeople.js');
const { addedNumbers } = await import('./contentSources.js');
const { guardedFix, guardedPage, plain, resolve, sourcing, toReview } =
  await import('./__fixtures__/no-fabrication/guarded.js');

/** What the agent's suggestions leave on the page, and what a page it writes says. */
function outputs(c) {
  return { fix: guardedFix(c, c.fix).join('\n'), page: guardedPage(c, c.page) };
}

describe('the no-fabrication test set', () => {
  it('holds 50 drafts at least, of each site type and language', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(CASES.map((c) => c.siteType))).toEqual(new Set(['b2b', 'b2c', 'ecommerce']));
    expect(new Set(CASES.map((c) => c.language))).toEqual(new Set(['en', 'tr', 'de']));
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it('drops a suggestion only for a figure it made up: the rest reach the guards', () => {
    const dropped = [];
    for (const c of CASES) {
      const { numbered, known, people } = sourcing(c);
      for (const s of c.fix.map(resolve(numbered))) {
        const kept = keepSuggestions(
          [s],
          draftPassages(c.html),
          new Set(),
          new Set(['dated']),
          null,
          {
            numbered,
            known,
            people,
          },
        );
        const madeUpFigure = c.invented.some((item) => /\d/.test(item) && s.after.includes(item));
        if (!kept.length && !madeUpFigure) dropped.push(`${c.id}: ${s.kind} on ${s.passage}`);
      }
    }
    expect(dropped).toEqual([]);
  });

  it('lets nothing the agent made up through, and takes out nothing it was given', () => {
    const survivors = [];
    const lost = [];
    for (const c of CASES) {
      const out = outputs(c);
      for (const [path, text] of Object.entries(out)) {
        for (const item of c.invented) {
          if (plain(text).includes(plain(item))) survivors.push(`${c.id} (${path}): ${item}`);
        }
        for (const item of c.kept[path]) {
          if (!plain(text).includes(plain(item))) lost.push(`${c.id} (${path}): ${item}`);
        }
      }
    }
    expect(survivors).toEqual([]);
    expect(lost).toEqual([]);
  });

  it('lists for review, without the cues, the names and quotes it wasn’t given', () => {
    const [c] = CASES.filter((x) => x.id === 'b2b-en-given_input');
    // What the set's own answers keep: names it was given only.
    const listed = CASES.flatMap((x) =>
      [...guardedFix(x, x.fix), guardedPage(x, x.page)].flatMap((text) =>
        toReview(x, text).map((span) => `${x.id}: ${span}`),
      ),
    );
    expect([...new Set(listed)]).toEqual([
      'b2b-tr-given_input: Northwind Ada Lovelace',
      'b2b-de-invented_story: Unsere Kundin',
      'b2c-tr-given_input: Bean Lab Grace',
      'b2c-tr-given_input: Baş Kavurmacı Mert',
      'b2c-de-invented_story: Unsere Kundin',
      'ecommerce-tr-given_input: Velo Studio Margaret',
      'ecommerce-tr-given_input: Atölye Sorumlusu Lena',
      'ecommerce-de-invented_story: Unsere Kundin',
    ]);
    // A quote with an apostrophe in it, a name after a heading, a name in a
    // given word ("parking" isn't "Park").
    expect(toReview(c, '“We don’t invent numbers or people, ever,” says the team.')).toEqual([
      'We don’t invent numbers or people, ever',
    ]);
    expect(
      toReview(c, guardedPage(c, { ...c.page, intro: ['Melanie Ross recommends it.'] })),
    ).toContain('Melanie Ross');
    expect(toReview(c, 'We asked Ed Park.')).toEqual(['Ed Park']);
    // What it wasn't given, unguarded: every made-up name and quote is listed.
    for (const x of CASES) {
      const spans = toReview(x, [...x.fix.map((s) => s.after), ...x.page.intro].join('\n')).join(
        '\n',
      );
      for (const item of x.invented.filter((i) => !/\d/.test(i))) {
        expect(spans, `${x.id}: ${item}`).toContain(item.split(/\s+/).slice(0, 3).join(' '));
      }
    }
  });

  // The model's own answers, once recorded (not in CI: it needs a model's key).
  const recordedPath = new URL('./__fixtures__/no-fabrication/recorded.json', import.meta.url);
  it.skipIf(!existsSync(recordedPath))(
    "leaves in the model's own answers no figure, and no name or quote it wasn't given that a person hasn't looked over",
    () => {
      const recorded = JSON.parse(readFileSync(recordedPath, 'utf8'));
      const survivors = [];
      let read = 0;
      for (const c of CASES) {
        const answer = recorded[c.id];
        if (!answer) continue;
        read += 1;
        const { people, knownInPage } = sourcing(c);
        const fix = guardedFix(c, answer.fix ?? [], new Set(['dated', 'expert', 'example']));
        const page = answer.page ? guardedPage(c, answer.page) : '';
        const reviewed = new Set(recorded.reviewed?.[c.id] ?? []);
        for (const text of [...fix, page]) {
          // What the guards would still take out of what they let through:
          // nothing, or they aren't stable.
          for (const n of addedNumbers(text, knownInPage)) {
            survivors.push(`${c.id}: figure ${text.slice(n.start, n.end)}`);
          }
          for (const e of peopleEdits(text, people)) {
            survivors.push(`${c.id}: ${text.slice(e.start, e.end)}`);
          }
          // Names and quotes it wasn't given, read without the guards' cues:
          // each one a person has looked over.
          for (const span of toReview(c, text)) {
            if (!reviewed.has(span)) survivors.push(`${c.id}: not reviewed: ${span}`);
          }
        }
      }
      expect(read).toBeGreaterThan(0);
      expect(survivors).toEqual([]);
    },
  );
});
