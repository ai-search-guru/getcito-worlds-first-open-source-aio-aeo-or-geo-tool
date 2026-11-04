/**
 * One-off clean-up: open content opportunities on the same question.
 *
 * New opportunities join the open one on their question
 * (opportunitySameQuestion.js); this merges the ones made before that, as
 * lib/opportunitySameQuestionMerge.js describes: one kept per question,
 * the others archived, pointing at it.
 *
 * A dry run unless `--apply` is given: it prints, per brand, the opportunity
 * kept and the ones that would be merged into it. Safe to re-run: a merged
 * group is one open opportunity afterwards.
 *
 * Run: node src/scripts/mergeSameQuestionOpportunities.js <brandId|--all> [--apply]
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { mergeBrandSameQuestion } from '../lib/opportunitySameQuestionMerge.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const target = args.find((a) => a !== '--apply');
if (!target) {
  console.error(
    'Usage: node src/scripts/mergeSameQuestionOpportunities.js <brandId|--all> [--apply]',
  );
  process.exit(1);
}

let brandIds;
if (target === '--all') {
  const { data, error } = await supabaseAdmin.from('brands').select('id').limit(1000);
  if (error) throw new Error(error.message);
  brandIds = (data ?? []).map((b) => b.id);
} else {
  brandIds = [target];
}

const line = (r) =>
  `${r.id} [${r.status}, ${r.source}, score ${r.score}${r.hasDraft ? ', draft' : ''}] ${r.title}`;

let groups = 0;
let merged = 0;
for (const brandId of brandIds) {
  try {
    const result = await mergeBrandSameQuestion(brandId, { apply });
    if (!result.groups.length) continue;
    console.log(`\n${brandId}: ${result.groups.length} question(s) with more than one open`);
    for (const group of result.groups) {
      console.log(`  keep   ${line(group.keep)}`);
      for (const row of group.merge) console.log(`  merge  ${line(row)}`);
      if (group.skipped) console.log('  skipped: changed while running; run again');
    }
    groups += result.groups.length;
    merged += apply ? result.merged : result.groups.reduce((s, g) => s + g.merge.length, 0);
  } catch (err) {
    console.error(brandId, 'FAILED:', err.message);
  }
}
console.log(
  `\n${apply ? 'Merged' : 'Dry run: would merge'} ${merged} opportunit${merged === 1 ? 'y' : 'ies'} in ${groups} question group(s).${apply ? '' : ' Run with --apply to write.'}`,
);
process.exit(0);
