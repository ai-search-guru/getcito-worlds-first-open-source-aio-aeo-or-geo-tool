/**
 * The task planner (#818, phase 5).
 *
 * Turns a definition's task spec into the rows one action actually gets,
 * given what the brand has and what the action is about. Two brands with the
 * same problem no longer receive the same list: a brand with analytics
 * connected is asked what the drop cost in sessions; a brand without is not
 * asked a question it cannot answer.
 *
 * Three things happen here, and nothing else — the planner decides the plan,
 * it does not write it. `generate.js` owns the writing, which keeps this
 * testable without a database.
 *
 *  1. **Eligibility.** A task whose required sources the brand lacks is
 *     dropped. Definition-level `requires` on a spec entry narrows further,
 *     which is how a task that exists for every brand can still be optional
 *     inside one particular plan.
 *  2. **Dependencies.** A dropped task takes its name out of everyone's
 *     `dependsOn`. A dependency that is not in the plan is not a dependency —
 *     leaving the name behind would block a task on work nobody was asked to
 *     do.
 *  3. **Targets.** A task that can name what it is about does, from the
 *     action's payload. The values travel as parameters rather than as
 *     resolved text, so the plan stays translatable.
 */

import { getTask } from './registry.js';
import { templateDetails } from './templates.js';

/**
 * Payload values a task's text may name, normalised.
 *
 * `competitorNames` is stored as a list because an action can consolidate
 * several; a task title names the one that leads. Everything else is passed
 * through as it was stored.
 */
function titleValues(payload) {
  const names = Array.isArray(payload.competitorNames) ? payload.competitorNames : [];
  const count = Number(payload.targetCount ?? 0);
  return {
    ...payload,
    competitor: names[0],
    // Library tasks name what they act on as a count and an entity. Nothing to
    // name is no title parameters, and the plain message renders instead.
    count: count > 0 ? count : undefined,
    entity: count > 0 ? payload.targetEntity : undefined,
  };
}

/**
 * A plan entry, expanded into the task ids it stands for.
 *
 *  - `'analyze_citations'` — one task;
 *  - `{ id, requires }` — one task, only where the brand has those sources;
 *  - `{ branch: [[…], […]] }` — the specification's `A|B+C`: optimise the
 *    page that exists, or brief and draft the one that does not. The first
 *    branch unless the action says no adequate content exists (spec §7,
 *    tests 3 and 4). Never both.
 */
function expand(entry, payload) {
  if (typeof entry === 'string') return [{ id: entry, requires: [] }];
  if (entry.branch) {
    const chosen = payload.contentExists === false ? entry.branch[1] : entry.branch[0];
    return chosen.map((id) => ({ id, requires: entry.requires ?? [] }));
  }
  return [{ requires: [], ...entry }];
}

/**
 * The tasks one action should be given.
 *
 * @param {{ id: string, tasks: readonly (string|object)[] }} definition
 * @param {{ sources: Set<string>, payload?: Record<string, unknown> }} context
 * @returns {Array<{ taskKey: string, version: number, mode: string, permission: string,
 *   dependsOn: string[], titleParams: Record<string, unknown>, position: number,
 *   details: object|null }>} `details`: the template's Done when, How we check
 *   and page (AC-010, templates.js), null without one
 */
export function planTasks(definition, { sources, payload = {} }) {
  const values = titleValues(payload);

  const chosen = [];
  const seen = new Set();
  for (const entry of definition.tasks.flatMap((e) => expand(e, payload))) {
    const primitive = getTask(entry.id);
    if (!primitive || seen.has(primitive.id)) continue;
    const needed = [...primitive.requires, ...entry.requires];
    if (!needed.every((source) => sources.has(source))) continue;
    // One task per primitive: two capabilities implying the same analysis are
    // one task over the combined scope (spec §7, test 12).
    seen.add(primitive.id);
    chosen.push(primitive);
  }

  const planned = new Set(chosen.map((primitive) => primitive.id));

  return chosen.map((primitive, index) => {
    const named = primitive.titleKeys.every(
      (key) => values[key] !== undefined && values[key] !== null,
    );
    return {
      taskKey: primitive.id,
      version: primitive.version,
      mode: primitive.mode,
      permission: primitive.permission,
      dependsOn: primitive.dependsOn.filter((id) => planned.has(id)),
      titleParams: named
        ? Object.fromEntries(primitive.titleKeys.map((key) => [key, values[key]]))
        : {},
      position: index + 1,
      details: templateDetails(primitive.id, payload),
    };
  });
}
