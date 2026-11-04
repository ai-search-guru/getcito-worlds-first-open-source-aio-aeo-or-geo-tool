/**
 * The task writer's quality rule (AC-004).
 *
 * A written task is kept only when it is concrete: it names a target the
 * action's evidence has, says where, how and when it is done, and is work a
 * person does. A task that fails comes back with its reasons, so the model
 * can be asked once more for a replacement (task-writer/index.js).
 */

import { promptWords } from './evidence.js';

/** The most tasks an action gets. */
export const MAX_TASKS = 6;

export const TASK_TYPES = Object.freeze([
  'content',
  'on_page',
  'technical',
  'outreach',
  'pr',
  'product',
]);

/**
 * How we check a task is done (AC-010): the page fetched again (or a Site
 * Audit), the prompts run again, or the person confirms it.
 */
export const TASK_CHECKS = Object.freeze(['auto', 'rerun', 'manual']);

/** "… for 7 prompts", "across 3 pages": a count where a target should be. */
const COUNT_IN_TITLE =
  /\b(?:for|across|on|in|to)\s+\d+\s+(?:prompts?|pages?|topics?|platforms?|competitors?|domains?|queries)\b/i;

/**
 * A page's address: a full URL, a path on the brand's site, or a host and
 * path as the evidence shows them (pageAddress adds the https://).
 */
const PAGE_ADDRESS = /^(?:https?:\/\/\S+|\/\S*|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?)$/i;

/** A task's URL as stored: a host and path gets its https://; null when it's no page address. */
export function pageAddress(url) {
  const value = text(url);
  if (!PAGE_ADDRESS.test(value)) return null;
  return /^(?:https?:\/\/|\/)/i.test(value) ? value : `https://${value}`;
}

/**
 * What a task missing one of AC-010's fields is refused for. A task refused
 * for these alone waits for review (00293) rather than going.
 */
const GAP = Object.freeze({
  urlEmpty: 'URL is empty',
  urlNotPage: 'URL is not a page address (https://… or /…)',
  change: 'the change has no after text',
  doneWhen: 'Done when is empty',
  check: 'check is not auto, rerun or manual',
});

/** Whether a task's problems are only AC-010 fields it misses. */
export function onlyGaps(problems) {
  const gaps = new Set(Object.values(GAP));
  return problems.length > 0 && problems.every((problem) => gaps.has(problem));
}

/** The AC-010 fields a task misses, as action_task_reviews.missing names them. */
export function taskGaps(task) {
  const gaps = [];
  if (!pageAddress(task?.url)) gaps.push('url');
  if (!text(task?.change?.after)) gaps.push('change');
  if (!text(task?.doneWhen)) gaps.push('doneWhen');
  if (!TASK_CHECKS.includes(text(task?.check).toLowerCase())) gaps.push('check');
  return gaps;
}

/** Analysis the product does itself and shows in the Affected tab. */
const ANALYSIS_VERB =
  /^(?:analy[sz]e|identify|validate|measure|monitor|review|investigate|assess|audit|evaluate|research|track|determine|look into)\b/i;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Why a task is not kept; empty when it is.
 *
 * @param {object} task as the model wrote it
 * @param {{ byRef: Map<string, { labels: string[] }> }} evidence
 * @returns {string[]}
 */
export function taskProblems(task, evidence) {
  const problems = [];
  const title = text(task?.title);
  const url = text(task?.url);
  const where = text(task?.where);
  const steps = (Array.isArray(task?.how) ? task.how : []).map(text).filter(Boolean);

  if (!title) problems.push('it has no title');
  // AC-010: the exact page, the change, Done when and how it's checked.
  if (!url) problems.push(GAP.urlEmpty);
  else if (!PAGE_ADDRESS.test(url)) problems.push(GAP.urlNotPage);
  if (!where) problems.push('Where is empty');
  if (!text(task?.change?.after)) problems.push(GAP.change);
  if (steps.length < 2 || steps.length > 5) problems.push('How needs 2 to 5 steps');
  if (!text(task?.doneWhen)) problems.push(GAP.doneWhen);
  if (!TASK_CHECKS.includes(text(task?.check).toLowerCase())) problems.push(GAP.check);
  if (!TASK_TYPES.includes(task?.type)) problems.push('its type is not one of the six');
  if (COUNT_IN_TITLE.test(title)) {
    problems.push('the title counts prompts or pages instead of naming one');
  }
  if (ANALYSIS_VERB.test(title)) {
    problems.push('it is analysis, which the product does itself; write the change to make');
  }

  const refs = (Array.isArray(task?.refs) ? task.refs : []).map(text);
  const known = refs.filter((ref) => evidence.byRef.has(ref));
  if (known.length === 0) {
    problems.push('it cites none of the evidence refs');
  } else if (known.length < refs.length) {
    problems.push(
      `it cites refs the evidence does not have (${refs.filter((r) => !evidence.byRef.has(r)).join(', ')})`,
    );
  } else if (!known.some((ref) => names(`${title} ${where} ${url}`, evidence.byRef.get(ref)))) {
    problems.push('neither the title, Where nor URL names its target');
  }
  return problems;
}

/**
 * Whether a text names an entity: a page by its URL or path, a domain or a
 * competitor by name, a prompt by its first words in order (quoted or not,
 * whatever the punctuation).
 */
function names(text, entity) {
  if (entity.words?.length) {
    return ` ${promptWords(text).join(' ')} `.includes(` ${entity.words.join(' ')} `);
  }
  const lower = text.toLowerCase();
  return (entity.labels ?? []).some((label) => label && lower.includes(label.toLowerCase()));
}

/** Tasks that say the same thing twice are one task. */
export function sameTask(a, b) {
  const norm = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');
  return norm(a.title) === norm(b.title);
}
