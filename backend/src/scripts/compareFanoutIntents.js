/**
 * Compare the decision model's fan-out intents with the cached ones (#988),
 * before FANOUT_INTENTS_DECIDER switches the Query Fan-out tab over to it.
 *
 * Run from backend/, with OPENROUTER_API_KEY and the Supabase keys in .env:
 *   node src/scripts/compareFanoutIntents.js [count]
 *   count defaults to 256: the newest cached queries, two decision requests
 *
 * Reads `fanout_query_intents` (labelled by the chat model) and asks the
 * decision model the same queries. Prints how often the two agree, overall
 * and per label, and the most common disagreements. Writes nothing, and never
 * prints a key.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { decide, isDeciderConfigured } from '../lib/decider.js';
import { classifyIntentsByDecider } from '../lib/intentExtraction.js';

const count = Math.max(1, Math.min(1024, Number.parseInt(process.argv[2] ?? '256', 10) || 256));

if (!isDeciderConfigured()) {
  console.error('OPENROUTER_API_KEY is not set (backend/.env).');
  process.exit(1);
}

const { data: rows, error } = await supabaseAdmin
  .from('fanout_query_intents')
  .select('query, intent')
  .order('created_at', { ascending: false })
  .limit(count);
if (error) {
  console.error('Reading fanout_query_intents failed:', error.message);
  process.exit(1);
}

const cached = Object.fromEntries(rows.map((row) => [row.query, row.intent]));
const started = Date.now();
const decided = await classifyIntentsByDecider(Object.keys(cached), decide);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const answered = Object.keys(decided);
const agree = answered.filter((query) => decided[query] === cached[query]);
const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');

console.log(`Queries compared: ${rows.length}, answered by the decision model: ${answered.length}`);
console.log(
  `Agreement: ${agree.length} of ${answered.length} (${pct(agree.length, answered.length)})`,
);
console.log(`Decision requests: ${Math.ceil(rows.length / 128)}, ${seconds} s`);

console.log('\nPer cached label (agree / total):');
const labels = [...new Set(answered.map((query) => cached[query]))].sort();
for (const label of labels) {
  const ofLabel = answered.filter((query) => cached[query] === label);
  const same = ofLabel.filter((query) => decided[query] === label).length;
  console.log(`  ${label.padEnd(16)} ${same} / ${ofLabel.length} (${pct(same, ofLabel.length)})`);
}

const pairs = new Map();
for (const query of answered) {
  if (decided[query] === cached[query]) continue;
  const key = `${cached[query]} → ${decided[query]}`;
  pairs.set(key, [...(pairs.get(key) ?? []), query]);
}
console.log('\nMost common disagreements (cached → decision model):');
for (const [pair, queries] of [...pairs].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
  console.log(`  ${pair}: ${queries.length}, e.g. "${queries[0]}"`);
}
