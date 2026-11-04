/**
 * What the task writer asks the model for (AC-004), and the shape it must
 * answer in. The rules mirror the quality check (quality.js): the model is
 * told what will be refused, and refused tasks are asked for again with the
 * reasons.
 */

import { z } from 'zod';
import { SITE_PAGE_TYPES, SITE_TYPE_MEANINGS, SITE_TYPE_NAMES } from '../../contentPageTypes.js';
import { MAX_TASKS } from './quality.js';

/**
 * Looser than the quality rule on purpose: a schema miss throws and costs a
 * retry for the whole set, while a task that fails the rule is replaced on
 * its own.
 */
export const writtenTaskSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().max(500),
  where: z.string().max(300),
  why: z.string().max(600),
  change: z.object({ before: z.string().max(1000), after: z.string().max(1000) }),
  how: z.array(z.string().max(300)).max(8),
  doneWhen: z.string().max(300),
  // A string, not the enum, as type below.
  check: z.string().max(10),
  // A string, not the enum: one unknown type is one refused task (quality.js),
  // not a schema miss that throws the whole answer away.
  type: z.string().max(20),
  effort: z.string().max(40),
  role: z.string().max(60),
  refs: z.array(z.string()).max(8),
});

export const taskWriterSchema = z.object({
  tasks: z.array(writtenTaskSchema).max(MAX_TASKS + 2),
});

const SYSTEM = `You turn an AI-visibility action into a short list of concrete tasks a person can do this week.

Every task answers these questions:
- title (What): an imperative sentence naming its target, e.g. "Add a 2026 comparison table to /blog/best-tools". Never "… for 7 prompts" or "across 3 pages": one task, one target.
- url: the exact page the change is made on, as a full URL or a path starting with "/", from the evidence. For outreach or PR, the other site's page.
- where: the exact page URL, prompt, platform, domain or competitor, from the evidence.
- why: the evidence behind it, with its numbers (positions, dates, visits), from the evidence only.
- change: the change itself, written out. after: the new text, e.g. an H2 "How accurate is AI search tracking?" with its 50-word answer. before: the text it replaces, quoted from the evidence, or "" when it adds new text or the evidence doesn't show the page's text.
- how: 2 to 5 short steps, in order.
- doneWhen: a measurable check, e.g. "H2 present · answer under 60 words · page re-fetched" or "the citation returns on 2 of 3 platforms within 14 days".
- check: how doneWhen is checked: auto (the page is fetched again), rerun (the prompts are run again) or manual (the person confirms).
Also: type (content, on_page, technical, outreach, pr or product), effort (e.g. "~2h") and role (e.g. "Content writer").

Rules:
- One task per page or domain. Prefer the targets with the most evidence.
- Do not write analysis tasks (analyze, identify, review, validate, measure, monitor): the product already did that work and shows it to the user.
- refs lists the evidence refs the task rests on (e.g. "page:1", "domain:2"). Use only refs that exist. The title, Where or url must name the target itself: a page by its URL or path, a domain or competitor by name, a prompt by quoting it.
- Use only facts from the evidence. No placeholders, no generic SEO advice.
- Name pages and content the way the brand's kind of site does (its site type and page types below): a category page or a buying guide for an online shop, a feature or comparison page for B2B software, a destination or help page for a consumer service.
- Write in English. At most ${MAX_TASKS} tasks.`;

/**
 * The brand's kind of site and the pages it writes, for the prompt; null for
 * a type it doesn't know (an older caller without one).
 */
function siteTypeLine(siteType) {
  if (!SITE_PAGE_TYPES[siteType]) return null;
  const pages = SITE_PAGE_TYPES[siteType].map((type) => type.replace(/_/g, ' ')).join(', ');
  return `Site type: ${SITE_TYPE_NAMES[siteType]} (${SITE_TYPE_MEANINGS[siteType]}). Its page types: ${pages}.`;
}

/**
 * @param {{
 *   action: { name: string, category: string, title?: string },
 *   brand: { name: string, description?: string | null, domains: string[], siteType?: string },
 *   evidence: object,
 *   history?: object[],
 * }} input evidence as `evidenceForPrompt` gives it; history as `loadPastRounds` does
 */
export function buildTaskWriterPrompt({ action, brand, evidence, history = [] }) {
  const prompt = [
    `Brand: ${brand.name}${brand.domains.length ? ` (${brand.domains.join(', ')})` : ''}`,
    brand.description ? `About the brand: ${brand.description}` : null,
    siteTypeLine(brand.siteType),
    `Action: ${action.name} (category: ${action.category})`,
    '',
    'Evidence (JSON):',
    JSON.stringify(evidence),
    // Earlier rounds of this action here (learning B5): what was done, and
    // what the result read.
    ...(history.length
      ? [
          '',
          'Earlier rounds of this action at this brand, newest first (JSON). result is improved, mixed, no_meaningful_change, declined, not_measurable or pending_measurement; final is false while it is a reading so far:',
          JSON.stringify(history),
          'Build on what the rounds that improved results did. Do not give again a task a round did without improvement, unless the evidence shows something new. A dismissed round says why it was turned down.',
        ]
      : []),
    '',
    `Write up to ${MAX_TASKS} tasks.`,
  ]
    .filter((line) => line !== null)
    .join('\n');
  return { system: SYSTEM, prompt };
}

/**
 * The second ask: replacements for the tasks the quality rule refused,
 * without repeating the ones kept.
 *
 * @param {{ base: { system: string, prompt: string }, kept: object[],
 *   refused: { task: object, problems: string[] }[], count: number }} input
 */
export function buildRetryPrompt({ base, kept, refused, count }) {
  const prompt = [
    base.prompt,
    '',
    'These tasks are already accepted; do not repeat them:',
    ...kept.map((task) => `- ${task.title}`),
    '',
    'These tasks were refused, with the reasons:',
    ...refused.map(({ task, problems }) => `- "${task.title}": ${problems.join('; ')}`),
    '',
    `Write ${count} replacement task${count === 1 ? '' : 's'} that keep every rule.`,
  ].join('\n');
  return { system: base.system, prompt };
}
