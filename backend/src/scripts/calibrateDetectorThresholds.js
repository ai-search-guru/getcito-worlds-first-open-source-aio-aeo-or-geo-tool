/**
 * Detector thresholds against outcomes (learning C6): reads one brand's
 * closed actions, exported by src/scripts/export-detector-outcomes.sql, and
 * prints, per signal kind, how its actions turned out and were dismissed,
 * by the strength of the signals that opened them in quarters, with a
 * suggested threshold, in its own unit, where the weakest quarter rarely
 * leads anywhere. See src/lib/detectorCalibration.js for how strength is
 * read per kind and how a suggestion is made: it is a starting point for the
 * maintainer, never applied by itself.
 *
 * Run it on one brand (GetCito's own, or your own self-hosted data).
 * Running it across customers' brands is not supported; it waits on the
 * cross-brand learning decision (C5) and a privacy policy update.
 *
 * Run from backend/, with the export kept outside the repository:
 *   node src/scripts/calibrateDetectorThresholds.js ~/outcomes.jsonl [--min 20] [--out ~/report.json]
 *
 *   --min  the fewest closed actions a signal kind is judged on (20; 5 at least)
 *   --out  also write the report as JSON
 *
 * Reads no database and no network, and prints and writes aggregates only:
 * no action's id. Exits 1 when the file can't be read or no row could be.
 * Isn't run in CI.
 */
import { readFileSync, writeFileSync } from 'fs';
import { MIN_ACTIONS, calibrate, parseRows, renderReport } from '../lib/detectorCalibration.js';

const USAGE =
  'Usage: node src/scripts/calibrateDetectorThresholds.js <outcomes.jsonl> [--min 20] [--out <report.json>]';
const args = process.argv.slice(2);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
/** An option's value; a flag given with none, or with another flag after it, is an error. */
const option = (name) => {
  const at = args.indexOf(name);
  if (at === -1) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} takes a value.\n${USAGE}`);
  return value;
};
const file = args[0] && !args[0].startsWith('--') ? args[0] : null;
if (!file) fail(USAGE);
const minArg = option('--min');
const min = minArg === null ? MIN_ACTIONS : Number(minArg);
if (!Number.isInteger(min) || min < 5) fail('--min takes a whole number of actions, 5 at least.');
const out = option('--out');

let text;
try {
  text = readFileSync(file, 'utf8');
} catch (err) {
  fail(`Can't read ${file}: ${err.code === 'ENOENT' ? 'no such file' : err.message}.`);
}
const { rows, skipped, withoutBaseline } = parseRows(text);
if (!rows.length) {
  fail(
    withoutBaseline
      ? `No row could be read: the ${withoutBaseline} closed action(s) had no baseline of their signals.`
      : 'No row could be read.',
  );
}
const report = calibrate(rows, { min });
console.log(renderReport(report, { skipped, min, withoutBaseline }));
if (out) {
  writeFileSync(out, `${JSON.stringify({ ...report, skipped, withoutBaseline }, null, 2)}\n`);
  console.log(`Report written to ${out}.`);
}
