/**
 * The AC-004 review set: what the task writer would write for recent
 * actions, as one Markdown file product can read before any brand gets
 * written tasks (ACTION_TASKS_AI stays off until then).
 *
 * A dry run: nothing is written to an action and nothing is charged to an
 * organization's budget. The model calls are real, so the run costs what the
 * report's total says.
 *
 * Run: node src/scripts/reviewActionTasks.js [--limit 20] [--brand <brandId>] [--out file.md]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import supabaseAdmin from '../config/supabase.js';
import { IMPROVE_ACTION_KIND } from '../lib/action-center/fromPromptImprove.js';
import { OPPORTUNITY_ACTION_KIND } from '../lib/action-center/fromOpportunity.js';
import { taskWriterModelId, writeTasksForAction } from '../lib/action-center/task-writer/index.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const limit = Number(arg('limit') ?? 20);
const brandId = arg('brand');
const out = arg('out') ?? `action-task-review-${new Date().toISOString().slice(0, 10)}.md`;

let query = supabaseAdmin
  .from('actions')
  .select('id, action_no, kind, category, brands!inner(name)')
  .not('status', 'in', '("completed","dismissed")')
  .not('kind', 'in', `("${IMPROVE_ACTION_KIND}","${OPPORTUNITY_ACTION_KIND}")`)
  .order('created_at', { ascending: false })
  .limit(limit);
if (brandId) query = query.eq('brand_id', brandId);
const { data: actions, error } = await query;
if (error) throw new Error(error.message);

const lines = [
  `# AC-004 review set`,
  '',
  `Model: ${taskWriterModelId()} · ${actions.length} actions · ${new Date().toISOString()}`,
  '',
];
let total = 0;

for (const action of actions) {
  process.stdout.write(`AC-${action.action_no} ${action.kind} … `);
  lines.push(`## AC-${action.action_no} · ${action.brands.name} · ${action.kind}`, '');
  try {
    const result = await writeTasksForAction(action.id, { dryRun: true, trigger: 'review' });
    total += result.costUsd;
    if (result.status === 'skipped') {
      lines.push(`_Nothing written: ${result.reason}._`, '');
      console.log(result.reason);
      continue;
    }
    console.log(
      `${result.tasks.length} tasks, ${result.reviews.length} for review, ${result.refused.length} refused`,
    );
    const e = result.evidence;
    lines.push(
      `Evidence: ${e.pages.length} pages, ${e.prompts.length} prompts, ${e.domains.length} domains, ${e.competitors.length} competitors · $${result.costUsd.toFixed(4)}`,
      '',
    );
    // The earlier rounds it was shown (learning B5), so a reviewer can tell
    // whether the tasks built on them.
    if (result.history?.length) {
      lines.push(
        `Earlier rounds: ${result.history
          .map((round) =>
            round.dismissed
              ? `${round.closed} dismissed (${round.reason ?? 'no reason'})`
              : `${round.closed} ${round.result}${round.final ? '' : ' so far'}, ${round.done.length} done`,
          )
          .join(' · ')}`,
        '',
      );
    }
    result.tasks.forEach((task, i) => {
      lines.push(
        `${i + 1}. **${task.title}** · ${task.type}`,
        `   - URL: ${task.url}`,
        `   - Where: ${task.where}`,
        `   - Why: ${task.why}`,
        `   - Change: ${task.change.before ? `${task.change.before} → ` : ''}${task.change.after}`,
        `   - How: ${task.how.map((step, n) => `${n + 1}) ${step}`).join(' ')}`,
        `   - Done when: ${task.doneWhen} (check: ${task.check})`,
        `   - Effort: ${[task.effort, task.role].filter(Boolean).join(' · ')}`,
        `   - Refs: ${task.refs.join(', ')}`,
      );
    });
    if (result.reviews.length) {
      lines.push('', 'Waiting for review (AC-010):');
      for (const task of result.reviews) lines.push(`- ${task.title}`);
    }
    if (result.refused.length) {
      lines.push('', 'Refused:');
      for (const { task, problems } of result.refused) {
        lines.push(`- ~~${task.title}~~: ${problems.join('; ')}`);
      }
    }
    lines.push('');
  } catch (err) {
    console.log(`failed: ${err.message}`);
    lines.push(`_Failed: ${err.message}_`, '');
  }
}

lines.splice(3, 0, `Total model cost: $${total.toFixed(4)}`, '');
writeFileSync(out, lines.join('\n'));
console.log(`\nWrote ${out} · $${total.toFixed(4)}`);
process.exit(0);
