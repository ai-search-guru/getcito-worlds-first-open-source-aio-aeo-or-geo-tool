import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// loadDefinitions reaches sources.js, which imports the admin client; its
// config hard-exits without SUPABASE_* env, as in CI. Nothing here touches it.
vi.mock('../../../config/supabase.js', () => ({ default: { from: vi.fn(), rpc: vi.fn() } }));

import { planTasks } from './plan.js';
import { AUTOMATABLE_MODES, TASKS, libraryTasks, listTasks, validateTask } from './registry.js';
import { isEligible, loadDefinitions } from '../definitions/index.js';
import { TOOLS } from '../execution/tools.js';

const ALL = new Set(['tracking', 'competitors', 'site_audits', 'analytics']);
const BARE = new Set(['tracking']);

const keys = (plan) => plan.map((item) => item.taskKey);

/**
 * Phase 5's exit condition, stated as a test: the same action kind, two
 * brands, different plans. Everything else here is the machinery that makes
 * that safe to do.
 */
describe('planTasks: what each task says it is done by (AC-010)', () => {
  it('gives a task its template’s details, and a change on a page the action’s one page', () => {
    const definition = {
      id: 'x',
      tasks: ['analyze_citations', 'optimize_content', 'validate_citations'],
    };
    const payload = {
      targetEntity: 'pages',
      targetCount: 1,
      targets: [{ id: '/pricing', label: '/pricing' }],
    };
    const plan = planTasks(definition, { sources: ALL, payload });
    expect(
      plan.map((item) => [item.taskKey, item.details?.check ?? null, item.details?.url ?? null]),
    ).toEqual([
      ['analyze_citations', null, null],
      ['optimize_content', 'auto', '/pricing'],
      ['validate_citations', 'rerun', null],
    ]);
    // Two pages: no one page to name.
    const two = planTasks(definition, {
      sources: ALL,
      payload: { ...payload, targetCount: 2, targets: [{ id: '/a' }, { id: '/b' }] },
    });
    expect(two[1].details).not.toHaveProperty('url');
  });
});

describe('planTasks', () => {
  const definition = {
    id: 'recover_visibility',
    tasks: ['analyze_losses', 'measure_traffic_impact', 'coverage_gaps', 'update_content'],
  };

  it('gives a brand with analytics the task that reads it', () => {
    expect(keys(planTasks(definition, { sources: ALL }))).toContain('measure_traffic_impact');
  });

  it('does not ask a brand without analytics a question it cannot answer', () => {
    const plan = planTasks(definition, { sources: BARE });
    expect(keys(plan)).not.toContain('measure_traffic_impact');
    expect(keys(plan)).toEqual(['analyze_losses', 'coverage_gaps', 'update_content']);
  });

  it('numbers positions over the tasks that survived, leaving no gap', () => {
    const plan = planTasks(definition, { sources: BARE });
    expect(plan.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  /**
   * A dependency that was never planned is not a dependency. Leaving the name
   * behind would block a task on work nobody was asked to do.
   */
  it('drops a dependency on a task the brand did not get', () => {
    const plan = planTasks(
      { id: 'x', tasks: ['diagnose_slip', 'competitor_pressure', 'review_responses'] },
      { sources: BARE },
    );
    expect(keys(plan)).not.toContain('competitor_pressure');
    const reinforce = plan.find((item) => item.taskKey === 'review_responses');
    expect(reinforce.dependsOn).toEqual(['diagnose_slip']);
  });

  it('keeps a dependency that is in the plan', () => {
    const plan = planTasks(
      { id: 'x', tasks: ['diagnose_slip', 'competitor_pressure'] },
      { sources: ALL },
    );
    expect(plan.find((i) => i.taskKey === 'competitor_pressure').dependsOn).toEqual([
      'diagnose_slip',
    ]);
  });

  it('carries the task primitive’s mode, permission and version onto the row', () => {
    const plan = planTasks(
      { id: 'x', tasks: ['publish_content', 'validate_ai_visibility'] },
      { sources: ALL },
    );
    expect(plan[0]).toMatchObject({ mode: 'human', permission: 'execute', version: 1 });
    expect(plan[1]).toMatchObject({ mode: 'system', permission: 'read' });
  });

  describe('branches', () => {
    const definition = {
      id: 'x',
      tasks: [{ branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] }],
    };

    it('optimises when content exists', () => {
      expect(
        keys(planTasks(definition, { sources: ALL, payload: { contentExists: true } })),
      ).toEqual(['optimize_content']);
    });

    it('creates when it does not', () => {
      expect(
        keys(planTasks(definition, { sources: ALL, payload: { contentExists: false } })),
      ).toEqual(['create_content_brief', 'create_content_draft']);
    });

    /** Creating a page that duplicates one is worse than improving it. */
    it('optimises when nothing says either way', () => {
      expect(keys(planTasks(definition, { sources: ALL }))).toEqual(['optimize_content']);
    });
  });

  /** Task Library acceptance test 12: one task per primitive. */
  it('plans a primitive once however many entries imply it', () => {
    const plan = planTasks(
      { id: 'x', tasks: ['analyze_citations', 'analyze_citations', 'validate_citations'] },
      { sources: ALL },
    );
    expect(keys(plan)).toEqual(['analyze_citations', 'validate_citations']);
  });

  it('ignores a task id that no longer exists in the registry', () => {
    expect(
      keys(planTasks({ id: 'x', tasks: ['validate', 'retired_task'] }, { sources: ALL })),
    ).toEqual(['validate']);
  });

  describe('naming what the task is about', () => {
    it('carries the values as parameters, not as resolved text', () => {
      const plan = planTasks(
        { id: 'x', tasks: ['compare_platforms'] },
        { sources: ALL, payload: { platform: 'gemini-web', bestPlatform: 'chatgpt-web' } },
      );
      expect(plan[0].titleParams).toEqual({
        platform: 'gemini-web',
        bestPlatform: 'chatgpt-web',
      });
    });

    it('names the competitor that leads, out of however many the action holds', () => {
      const plan = planTasks(
        { id: 'x', tasks: ['analyze_competitor'] },
        { sources: ALL, payload: { competitorNames: ['Acme', 'Globex'] } },
      );
      expect(plan[0].titleParams).toEqual({ competitor: 'Acme' });
    });

    /**
     * Half a title is worse than none: "Compare coverage against undefined"
     * is what a partially filled payload produces if the planner does not
     * insist on all of it.
     */
    it('names nothing when the payload is missing a value the text needs', () => {
      const plan = planTasks(
        { id: 'x', tasks: ['compare_platforms'] },
        { sources: ALL, payload: { platform: 'gemini-web' } },
      );
      expect(plan[0].titleParams).toEqual({});
    });

    it('names nothing for a task that names nothing', () => {
      const plan = planTasks({ id: 'x', tasks: ['validate'] }, { sources: ALL, payload: { a: 1 } });
      expect(plan[0].titleParams).toEqual({});
    });
  });
});

describe('the task registry', () => {
  it('holds the specification’s sixty-two task primitives, and learning C4’s', () => {
    expect(libraryTasks()).toHaveLength(63);
    expect(TASKS.analyze_winning_pages).toMatchObject({
      mode: 'system',
      requires: ['site_audits'],
      tool: 'winning_page_features',
    });
  });

  it.each(listTasks().map((entry) => [entry.id, entry]))('%s is well formed', (_id, entry) => {
    expect(validateTask(entry)).toEqual([]);
  });

  it('keys every entry by its own id', () => {
    for (const [key, entry] of Object.entries(TASKS)) expect(entry.id).toBe(key);
  });

  /** A cycle would make the plan unorderable and is easy to write by accident. */
  it('has no dependency cycles', () => {
    const seen = new Map();
    const walk = (id, trail) => {
      if (trail.includes(id)) throw new Error(`cycle: ${[...trail, id].join(' -> ')}`);
      if (seen.get(id)) return;
      for (const next of TASKS[id].dependsOn) walk(next, [...trail, id]);
      seen.set(id, true);
    };
    expect(() => listTasks().forEach((entry) => walk(entry.id, []))).not.toThrow();
  });

  /**
   * A definition naming a task that does not exist would silently produce a
   * shorter plan — the planner skips what it cannot find, by design, because
   * a retired task must not break every action that still lists it. That
   * makes a typo invisible at runtime, so it is caught here instead.
   */
  it('backs every task the shipped definitions ask for', async () => {
    const definitions = await loadDefinitions();
    for (const definition of definitions) {
      const ids = definition.tasks.flatMap((entry) =>
        typeof entry === 'string' ? [entry] : entry.branch ? entry.branch.flat() : [entry.id],
      );
      for (const id of ids) {
        // Known, and from the library — legacy primitives exist only so old
        // rows still render; no definition may plan them.
        expect({ definition: definition.id, id, library: TASKS[id]?.legacy === false }).toEqual({
          definition: definition.id,
          id,
          library: true,
        });
      }
    }
  });

  /**
   * The web renders a task from its id. A task with no message shows its own
   * key to the user, and a target-aware task with no `_target` variant shows
   * the key the moment a payload resolves — which is exactly when the text
   * mattered most. Both are silent until someone sees them, so they are
   * caught here, against the file the web actually ships.
   */
  it('has a message for every task, and a target variant for every task that names one', () => {
    const messages = JSON.parse(
      readFileSync(new URL('../../../../../frontend/messages/en.json', import.meta.url), 'utf8'),
    ).actionCenter.actionTasks;

    for (const entry of listTasks()) {
      expect({ id: entry.id, message: typeof messages[entry.id] }).toEqual({
        id: entry.id,
        message: 'string',
      });
      if (entry.titleKeys.length > 0) {
        expect({ id: entry.id, target: typeof messages[`${entry.id}_target`] }).toEqual({
          id: entry.id,
          target: 'string',
        });
      }
    }
  });

  /** A message naming a value the planner never supplies renders as an ICU
   *  error in the user's face. */
  it('only names values the planner puts in the parameters', () => {
    const messages = JSON.parse(
      readFileSync(new URL('../../../../../frontend/messages/en.json', import.meta.url), 'utf8'),
    ).actionCenter.actionTasks;

    for (const entry of listTasks()) {
      if (entry.titleKeys.length === 0) continue;
      // Only the top-level ICU arguments: `{promptCount, plural, ...}` names
      // one, `one {1 prompt}` nested inside it names nothing.
      const named = [...messages[`${entry.id}_target`].matchAll(/\{\s*(\w+)\s*[,}]/g)].map(
        (m) => m[1],
      );
      // `{targets}` is rendered by the web from the count and entity the
      // planner stores ("11 prompts"), so it is declared when those are.
      const declared = new Set(entry.titleKeys);
      if (declared.has('count') && declared.has('entity')) declared.add('targets');
      for (const name of named) {
        expect({ id: entry.id, name, declared: declared.has(name) }).toEqual({
          id: entry.id,
          name,
          declared: true,
        });
      }
    }
  });

  /**
   * A task naming a tool that does not exist is not runnable and nothing
   * would say why — the runner would report "no tool implements this", which
   * is true and misleading. Caught here instead.
   */
  it('names a real tool wherever it names one', () => {
    for (const entry of listTasks()) {
      if (!entry.tool) continue;
      expect({ id: entry.id, tool: entry.tool, exists: Boolean(TOOLS[entry.tool]) }).toEqual({
        id: entry.id,
        tool: entry.tool,
        exists: true,
      });
    }
  });

  /**
   * A tool can only be given to a task that is meant to be automated, and the
   * brand needs the tool's source as well as the task's own — otherwise a
   * task is planned that can never run.
   */
  it('only gives tools to tasks that can run without a person, whose requirements cover the tool’s', () => {
    for (const entry of listTasks()) {
      if (!entry.tool) continue;
      expect({ id: entry.id, automatable: AUTOMATABLE_MODES.includes(entry.mode) }).toEqual({
        id: entry.id,
        automatable: true,
      });
      // A tool reading analytics may sit on a task that only needs AI traffic:
      // the runner then refuses brands whose traffic comes from the snippet,
      // and says why.
      const source = TOOLS[entry.tool].source;
      const covered =
        source === 'tracking' ||
        entry.requires.includes(source) ||
        (source === 'analytics' && entry.requires.includes('ai_traffic'));
      expect({ id: entry.id, source, covered }).toEqual({ id: entry.id, source, covered: true });
    }
  });

  /**
   * The registry says a task can produce structured output; the planner is
   * what has to keep the declaration reachable. A task declaring outputs
   * nobody consumes is fine — one consuming an output nothing declares is a
   * chain that silently breaks.
   */
  it('has a producer for every output a task depends on reading', () => {
    const produced = new Set(listTasks().flatMap((entry) => entry.outputs));
    for (const entry of listTasks()) {
      for (const id of entry.dependsOn) {
        for (const output of TASKS[id].outputs) expect(produced.has(output)).toBe(true);
      }
    }
  });
});

describe('F02 for a brand without Site Audit (AT-013)', () => {
  it('is raised from the AI bot report alone, without the tasks that read an audit', async () => {
    const definitions = await loadDefinitions();
    const f02 = definitions.find((d) => d.code === 'F02');
    // cited_page_uncrawled comes from the brand's Cloudflare or Vercel, not an audit.
    expect(isEligible(f02, BARE)).toBe(true);
    const plan = keys(planTasks(f02, { sources: BARE }));
    expect(plan).not.toContain('analyze_site_audit');
    expect(plan).not.toContain('validate_technical_fix');
    expect(plan).toContain('fix_crawler_access');
    // With an audit, the plan reads it first.
    expect(keys(planTasks(f02, { sources: ALL }))[0]).toBe('analyze_site_audit');
  });
});
