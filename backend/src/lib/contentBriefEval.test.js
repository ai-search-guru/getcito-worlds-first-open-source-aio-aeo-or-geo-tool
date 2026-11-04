import { existsSync, readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { CASES } from './__fixtures__/brief-eval/cases.js';
import { BAD, GOOD, GOOD_JUDGED } from './__fixtures__/brief-eval/samples.js';

/**
 * The brief eval (CE-EVAL-001): its cases, its checks, how a judge's answer
 * is kept, and, once recorded (node src/scripts/evalBrief.js, with a
 * provider key: never in CI), the models' own briefs read for free.
 */

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { PAGE_TYPE_FORMATS, SITE_PAGE_TYPES } = await import('./contentPageTypes.js');
const { shapeBrief } = await import('./contentBrief.js');
const {
  BRIEF_CRITERIA,
  briefChecks,
  buildJudgePrompt,
  passesGate,
  promptVersion,
  readJudged,
  summarize,
} = await import('./contentBriefEval.js');
const { NAME_PLACEHOLDER } = await import('./contentPeople.js');
const { NUMBER_PLACEHOLDER } = await import('./contentSources.js');

const [FIRST] = CASES;

describe('the brief eval’s cases', () => {
  it('holds 30 pages: ten per site type, in English, Turkish and German, new and live', () => {
    expect(CASES).toHaveLength(30);
    for (const site of ['b2b', 'b2c', 'ecommerce']) {
      expect(CASES.filter((c) => c.siteType === site)).toHaveLength(10);
    }
    expect(new Set(CASES.map((c) => c.language))).toEqual(new Set(['en', 'tr', 'de']));
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    expect(new Set(CASES.map((c) => c.draft.method))).toEqual(new Set(['create', 'optimize']));
  });

  it('gives each what Rebuild outline is given: a page type, prompts and fan-outs', () => {
    for (const c of CASES) {
      expect(PAGE_TYPE_FORMATS[c.draft.page_type], c.id).toBeTruthy();
      // One the editor offers its site type.
      expect(SITE_PAGE_TYPES[c.siteType], c.id).toContain(c.draft.page_type);
      expect(c.prompts.length, c.id).toBeGreaterThan(0);
      expect(c.sources.fanouts.length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.brand.language).toBe(c.language);
      // A live page says where it is and what its headings are.
      if (c.draft.method === 'optimize') expect(c.sources.headings.length, c.id).toBeGreaterThan(0);
    }
  });
});

describe('the rubric', () => {
  it('reads the nine brief rules, each once', () => {
    expect(BRIEF_CRITERIA.map((k) => k.key)).toEqual([
      'answerFirst',
      'uniqueAngle',
      'sourcedFacts',
      'entities',
      'topEssentials',
      'freshness',
      'format',
      'naturalLanguage',
      'links',
    ]);
  });

  it('tells the judge the case, the brief and each criterion', () => {
    const brief = shapeBrief(GOOD, FIRST);
    const prompt = buildJudgePrompt(FIRST, brief);
    expect(prompt).toContain('Rolling cash forecasts (feature_page, a new page), for Ledgerly');
    expect(prompt).toContain('- rolling cash forecast vs static budget');
    // The brief as plain lines: what a quote is read in.
    expect(prompt).toContain('H2: What a rolling 13-week cash forecast is');
    expect(prompt).toContain('Keywords: rolling cash forecast, 13 week cash flow model');
    for (const { key } of BRIEF_CRITERIA) expect(prompt).toContain(`- ${key}: `);
  });
});

describe('the checks anyone can repeat', () => {
  it('pass a brief that answers every fan-out with nothing it wasn’t given', () => {
    const checks = briefChecks(shapeBrief(GOOD, FIRST), FIRST);
    expect(checks).toMatchObject({
      sections: 5,
      sectionsInRange: true,
      emptySections: 0,
      longHeadings: 0,
      extraKeywords: 0,
      fanoutCoverage: 1,
      // A fact to find, named in words: no placeholder.
      placeholders: 0,
      invented: { figures: [], people: [], urls: [] },
    });
    expect(passesGate(checks)).toBe(true);
  });

  it('find what the guard put as placeholders, an address no one gave, and a thin outline', () => {
    const brief = shapeBrief(BAD, FIRST);
    // A figure it wasn't given goes with its sentence; a person is the brand's to name.
    expect(brief.outline[0].keyPoints).toEqual([
      'Read the CFO survey at https://made-up.example/report.',
      `${NAME_PLACEHOLDER} recommends Ledgerly.`,
    ]);
    expect(JSON.stringify(brief)).not.toContain(NUMBER_PLACEHOLDER);
    const checks = briefChecks(brief, FIRST);
    expect(checks).toMatchObject({
      sections: 2,
      sectionsInRange: false,
      emptySections: 1,
      fanoutCoverage: 0.25,
      placeholders: 1,
      invented: { figures: [], people: [], urls: ['https://made-up.example/report'] },
    });
    expect(passesGate(checks)).toBe(false);
  });

  it('fail the gate on what a guard let through: a figure or a person it wasn’t given', () => {
    // The brief as the model wrote it, before the guard.
    const checks = briefChecks(BAD, FIRST);
    expect(checks.invented.figures).toContain('73');
    expect(checks.invented.people.join(' ')).toContain('Jane Doe');
    expect(passesGate(checks)).toBe(false);
  });

  it('read each line as the guard does: a heading as one, a question in quotes kept', () => {
    const brief = shapeBrief(
      {
        ...GOOD,
        outline: [
          {
            heading: 'What Every CFO Should Know About Cash Forecasts',
            keyPoints: ['Answer "Can Ledgerly replace Excel for a cash forecast?" first.'],
            fanout: null,
            platform: null,
          },
          ...GOOD.outline.slice(1),
        ],
      },
      FIRST,
    );
    expect(briefChecks(brief, FIRST).invented).toEqual({ figures: [], people: [], urls: [] });
  });

  it('read an address as its host and path: a given one however written, one without a scheme too', () => {
    const brief = shapeBrief(
      {
        ...GOOD,
        audience: 'Read https://WWW.Reddit.com/r/FPandA/comments/abc/ and www.made-up.example/x.',
      },
      FIRST,
    );
    expect(briefChecks(brief, FIRST).invented.urls).toEqual(['www.made-up.example/x']);
  });

  it('read version 2’s answers and facts too: the judge sees them, the gate reads them', () => {
    const page = FIRST.sources.pages[0].url;
    const section = {
      ...GOOD.outline[0],
      answer: 'Say what a rolling forecast is, as https://made-up.example/answer does.',
      format: 'paragraphs',
      facts: [
        { claim: 'How often teams re-forecast', sourceType: 'study', source: 'S1' },
        { claim: 'What www.made-up.example/claim found', sourceType: 'statistic', source: null },
      ],
    };
    const brief = shapeBrief({ ...GOOD, outline: [section, ...GOOD.outline.slice(1)] }, FIRST);
    const prompt = buildJudgePrompt(FIRST, brief);
    expect(prompt).toContain('Answer: Say what a rolling forecast is');
    expect(prompt).toContain('Format: paragraphs');
    expect(prompt).toContain(`Fact (study, check against ${page}): How often teams re-forecast`);
    expect(prompt).toContain('Fact (statistic): What www.made-up.example/claim found');
    expect(briefChecks(brief, FIRST).invented.urls).toEqual([
      'https://made-up.example/answer',
      'www.made-up.example/claim',
    ]);
    // A figure the model wrote in a fact, before the guard.
    const raw = {
      ...brief,
      outline: [
        {
          ...brief.outline[0],
          facts: [{ claim: '73% re-forecast', sourceType: 'study', source: null }],
        },
      ],
    };
    expect(briefChecks(raw, FIRST).invented.figures).toEqual(['73']);
  });

  it('read the page’s plan too: essentials, angle, proof, fan-outs left out, freshness', () => {
    const brief = shapeBrief(
      {
        ...GOOD,
        tldr: 'A rolling forecast keeps cash visible, per www.made-up.example/tldr.',
        angle: 'Ledgerly’s own variance data across customers',
        proof: [{ kind: 'data', what: 'Average error before and after switching' }],
        leftOut: [FIRST.sources.fanouts.at(-1).query],
        datedPoint: 'The error figure, with its month',
      },
      FIRST,
    );
    const prompt = buildJudgePrompt(FIRST, brief);
    expect(prompt).toContain('TL;DR: A rolling forecast keeps cash visible');
    expect(prompt).toContain('Angle: Ledgerly’s own variance data across customers');
    expect(prompt).toContain('Proof to gather (data): Average error before and after switching');
    expect(prompt).toContain('Freshness: date The error figure, with its month');
    expect(prompt).toContain('Names as written: Ledgerly');
    expect(briefChecks(brief, FIRST).invented.urls).toEqual(['www.made-up.example/tldr']);
  });

  it('count coverage over the fan-outs the brief keeps: one left for another page isn’t missed', () => {
    // GOOD answers all four of the case's fan-outs; without the first one's H2:
    const [first] = FIRST.sources.fanouts;
    const outline = GOOD.outline.filter((s) => s.fanout !== first.query);
    const missed = briefChecks(shapeBrief({ ...GOOD, outline }, FIRST), FIRST);
    expect(missed).toMatchObject({ fanoutCoverage: 0.75, leftOut: 0 });
    // Left for another page, it isn't missed.
    const left = briefChecks(
      shapeBrief({ ...GOOD, outline, tldr: null, proof: [], leftOut: [first.query] }, FIRST),
      FIRST,
    );
    expect(left).toMatchObject({ fanoutCoverage: 1, leftOut: 1 });
  });

  it('take the pages a case may link to as given, and tell the judge its competitors', () => {
    const c = CASES.find((k) => k.competitors.length && k.targets.own.length);
    const brief = {
      ...shapeBrief(GOOD, c),
      links: {
        internal: [{ url: c.targets.own[0].url, anchor: 'see the page', section: null }],
        outbound: [],
      },
    };
    expect(briefChecks(brief, c).invented.urls).toEqual([]);
    const prompt = buildJudgePrompt(c, brief);
    expect(prompt).toContain(`Competitors it was given: ${c.competitors.join(', ')}`);
    expect(prompt).toContain(`Link (internal): see the page → ${c.targets.own[0].url}`);
  });

  it('take an address the case gave: a cited page, or the live page', () => {
    const live = CASES.find((c) => c.draft.method === 'optimize');
    const brief = shapeBrief(
      {
        ...GOOD,
        goal: `Improve ${live.draft.source_url} for AI answers.`,
      },
      live,
    );
    expect(briefChecks(brief, live).invented.urls).toEqual([]);
  });
});

describe('a judge’s answer as kept', () => {
  it('keeps a score only with the brief’s own words, every criterion once', () => {
    const judged = readJudged(GOOD_JUDGED, shapeBrief(GOOD, FIRST));
    expect(Object.keys(judged)).toEqual(BRIEF_CRITERIA.map((k) => k.key));
    expect(judged.answerFirst).toMatchObject({ score: 2 });
    expect(judged.sourcedFacts).toMatchObject({ score: 1 });
    expect(judged.format).toMatchObject({ score: 2 });
    // Words the brief doesn't have earn nothing.
    expect(judged.links).toMatchObject({ score: 0, unquoted: true });
    // Left out: 0.
    expect(judged.freshness).toMatchObject({ score: 0, quote: '' });
  });

  it('reads a quote as written in any quotes or apostrophes, shortened, but three words at least', () => {
    const brief = shapeBrief(GOOD, FIRST);
    const read = (quote) =>
      readJudged({ scores: [{ key: 'uniqueAngle', score: 2, quote, why: '' }] }, brief).uniqueAngle;
    expect(read("Proof to gather: Ledgerly's own variance data").score).toBe(2);
    expect(read('“Proof to gather: Ledgerly’s own variance data”').score).toBe(2);
    expect(read('Proof to gather … variance data from customers').score).toBe(2);
    expect(read('Ledgerly')).toMatchObject({ score: 0, unquoted: true });
    // Across two lines: not the brief's words.
    expect(read('three key takeaways for the reader. A table comparing')).toMatchObject({
      score: 0,
      unquoted: true,
    });
  });

  it('reads a score as a whole number from 0 to 2', () => {
    const brief = shapeBrief(GOOD, FIRST);
    const quote = 'TL;DR at the top: three key takeaways for the reader.';
    const read = (score) =>
      readJudged({ scores: [{ key: 'topEssentials', score, quote, why: '' }] }, brief).topEssentials
        .score;
    expect(read(7)).toBe(2);
    expect(read(-1)).toBe(0);
    expect(read(1.4)).toBe(1);
    expect(read('2')).toBe(2);
  });

  it('sums a record: means per criterion, the gate, the checks and the tokens', () => {
    const brief = shapeBrief(GOOD, FIRST);
    const good = {
      checks: briefChecks(brief, FIRST),
      judged: readJudged(GOOD_JUDGED, brief),
      usage: { inputTokens: 2000, outputTokens: 1000 },
    };
    const badBrief = shapeBrief(BAD, FIRST);
    const bad = {
      checks: briefChecks(badBrief, FIRST),
      judged: readJudged({ scores: [] }, badBrief),
      usage: { inputTokens: 1500, outputTokens: 500 },
    };
    expect(summarize({ good, bad })).toMatchObject({
      cases: 2,
      criteria: { answerFirst: 1, sourcedFacts: 0.5, format: 1, links: 0 },
      total: 2.5,
      gateFailures: 1,
      sectionsInRange: 1,
      fanoutCoverage: 0.63,
      placeholders: 1,
      unquoted: 1,
      tokens: { input: 3500, output: 1500 },
    });
  });

  it('names the brief’s prompt by a short hash of every case’s, under Quality’s phase', () => {
    expect(promptVersion(CASES)).toMatch(/^[0-9a-f]{12}$/);
    expect(promptVersion(CASES)).toBe(promptVersion(CASES));
    expect(promptVersion(CASES.slice(1))).not.toBe(promptVersion(CASES));
    // From phase 2 the prompt names the site type; the brief rules change it too.
    expect(promptVersion(CASES, { phase: 2 })).not.toBe(promptVersion(CASES, { phase: 0 }));
    expect(promptVersion(CASES, { rules: true })).not.toBe(promptVersion(CASES, { rules: false }));
    // Both are read for it, and left as they were.
    const before = [process.env.CONTENT_QUALITY_PHASE, process.env.CONTENT_BRIEF_RULES];
    promptVersion(CASES, { phase: 3, rules: true });
    expect([process.env.CONTENT_QUALITY_PHASE, process.env.CONTENT_BRIEF_RULES]).toEqual(before);
  });

  it('asks as version 1 always has with the brief rules off: the baseline’s hashes', () => {
    // Changed on purpose? Record the version 1 baseline again, then these.
    expect(promptVersion(CASES, { phase: 0, rules: false })).toBe('245d727b9091');
    expect(promptVersion(CASES, { phase: 2, rules: false })).toBe('bfa5ca4994bf');
  });
});

// The models' own briefs, once recorded: read only while the brief's prompt
// (under the Quality phase they were recorded with) is the one they were
// written under. Their checks are made again here, for free.
const recordedPath = new URL('./__fixtures__/brief-eval/recorded.json', import.meta.url);
const recorded = existsSync(recordedPath) ? JSON.parse(readFileSync(recordedPath, 'utf8')) : null;
const recordedUnder = {
  phase: recorded?.qualityPhase ?? 0,
  rules: recorded?.briefRules ?? false,
};
const current = recorded && recorded.promptVersion === promptVersion(CASES, recordedUnder);

describe('the recorded briefs', () => {
  it.skipIf(!current)(
    'answer every case, leave nothing in any brief it wasn’t given, and plan 3 to 10 sections',
    () => {
      const results = CASES.map((c) => [c, recorded.cases[c.id]]);
      expect(results.filter(([, r]) => !r || r.error).map(([c]) => c.id)).toEqual([]);
      const checked = results.map(([c, r]) => [c.id, briefChecks(shapeBrief(r.object, c), c), r]);
      expect(checked.filter(([, checks]) => !passesGate(checks)).map(([id]) => id)).toEqual([]);
      const inRange = checked.filter(([, checks]) => checks.sectionsInRange).length;
      expect(inRange / checked.length).toBeGreaterThanOrEqual(0.9);
      for (const [id, , r] of checked) {
        expect(Object.keys(r.judged), id).toEqual(BRIEF_CRITERIA.map((k) => k.key));
      }
    },
  );

  it.skipIf(!recorded || current)(
    'waits for a new record: the brief’s prompt changed since',
    () => {
      // A stale record is said, not failed: the maintainer records again.
      expect(recorded.promptVersion).not.toBe(promptVersion(CASES, recordedUnder));
    },
  );
});
