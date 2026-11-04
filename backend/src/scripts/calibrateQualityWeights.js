/**
 * Quality's weights against AI citations (Content Editor Quality spec §11,
 * CE-055): reads a JSON-lines file of pages a maintainer exported, one page
 * a line, and prints, per profile and score, how the score goes with the AI
 * citations the pages got, and per check, its pages, rank correlation and
 * 95% interval; given the weights in use, the ones the correlations suggest.
 * See src/lib/qualityCalibration.js for what a row holds and how a
 * suggestion is made: they are a starting point for the maintainer, never
 * applied by themselves.
 *
 * Export the pages over one window, live for all of it, each with a group
 * (a salted hash of its brand: correlations are read within each brand).
 * weights.json is frontend/src/lib/content/qualityProfiles.ts's PROFILE_WEIGHTS
 * as JSON (JSON.stringify(PROFILE_WEIGHTS), logged from a test, say).
 *
 * Run from backend/:
 *   node src/scripts/calibrateQualityWeights.js <pages.jsonl> [--weights <weights.json>] [--min 30] [--out <report.json>]
 *
 *   --weights  the weights in use (profile → score → check → points)
 *   --min      the fewest pages a check's correlation is read from (30; 3 at least)
 *   --out      also write the report as JSON
 *
 * Reads no database and no network, and prints and writes aggregates only:
 * a row's fields other than its profile, checks, citations and group are
 * dropped, the group is never printed, and a line that isn't a row is
 * counted, never printed. Exits 1 when no row could be read. Isn't run in CI.
 */
import { readFileSync, writeFileSync } from 'fs';
import {
  MIN_PAGES,
  QUALITY_SCORES,
  calibrate,
  calibrationWeights,
  parseRows,
  withoutBom,
} from '../lib/qualityCalibration.js';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const file = args[0] && !args[0].startsWith('--') ? args[0] : null;
if (!file) {
  fail(
    'Usage: node src/scripts/calibrateQualityWeights.js <pages.jsonl> [--weights <weights.json>] [--min 30] [--out <report.json>]',
  );
}
const minArg = option('--min');
const minPages = minArg === null ? MIN_PAGES : Number(minArg);
if (!Number.isInteger(minPages) || minPages < 3)
  fail('--min takes a whole number of pages, 3 at least.');
const out = option('--out');

let weights = null;
const weightsFile = option('--weights');
if (weightsFile) {
  let raw;
  try {
    raw = JSON.parse(withoutBom(readFileSync(weightsFile, 'utf8')));
  } catch {
    fail(`${weightsFile} isn't JSON.`);
  }
  const parsed = calibrationWeights.safeParse(raw);
  if (!parsed.success || !Object.keys(parsed.data).length) {
    fail(
      `${weightsFile} isn't PROFILE_WEIGHTS: profile → { eeat, trust, readability } → check → whole points.`,
    );
  }
  weights = parsed.data;
  for (const [profile, scores] of Object.entries(weights)) {
    for (const score of QUALITY_SCORES) {
      const total = Object.values(scores[score]).reduce((a, b) => a + b, 0);
      if (total !== 100) console.warn(`Warning: ${profile} ${score} adds up to ${total}, not 100.`);
    }
  }
}

const { rows, invalid } = parseRows(readFileSync(file, 'utf8'));
console.log(
  `${rows.length} pages read${invalid ? `, ${invalid} ${invalid === 1 ? 'line' : 'lines'} skipped` : ''}.`,
);
if (!rows.length) fail('No page could be read.');
const report = calibrate(rows, { minPages, weights });

const show = (rho) => (rho === null || rho === undefined ? '—' : rho.toFixed(3));
for (const [profile, { pages, scores }] of Object.entries(report.profiles)) {
  console.log(`\n${profile} · ${pages} pages`);
  for (const score of QUALITY_SCORES) {
    const { checks, rho, suggested, rhoSuggestedInSample } = scores[score];
    if (weights?.[profile]) {
      console.log(
        `  ${score} score: rho ${show(rho)} with the weights in use, ${show(rhoSuggestedInSample)} with the suggested (in-sample)`,
      );
    }
    for (const [check, stat] of Object.entries(checks)) {
      const now = weights?.[profile]?.[score]?.[check];
      const next = suggested?.[check];
      const range = stat.interval
        ? `[${stat.interval.low.toFixed(2)}, ${stat.interval.high.toFixed(2)}]${stat.interval.read ? ' *' : ''}`
        : '';
      console.log(
        `  ${score}.${check}`.padEnd(32),
        `${stat.pages} pages`.padEnd(11),
        `rho ${show(stat.rho)}`.padEnd(11),
        range.padEnd(18),
        now === undefined ? '' : `${now} → ${next}`,
      );
    }
  }
}
console.log(
  '\n* the 95% interval leaves 0 out: only these checks move a suggestion. Suggestions keep half the weights in use and never take a weighed check to 0: weigh them with judgment before changing PROFILE_WEIGHTS.',
);
if (out) {
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nReport written to ${out}.`);
}
