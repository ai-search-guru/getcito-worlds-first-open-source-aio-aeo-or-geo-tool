import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TASKS } from './registry.js';
import { TEMPLATED_TASKS, onePage, templateDetails } from './templates.js';
import { TASK_CHECKS } from '../task-writer/quality.js';
import { CHECKS } from '../taskChecks.js';

// taskChecks.js reaches the supabase admin client at import time, whose
// config hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../../../config/supabase.js', () => ({ default: {} }));

/** How a library task is checked, and the page it is done on (AC-010). */

describe('templateDetails', () => {
  it('has a check that exists for library tasks only', () => {
    for (const id of TEMPLATED_TASKS) {
      expect(TASKS[id], id).toBeDefined();
      expect(TASKS[id].legacy, id).toBe(false);
      const details = templateDetails(id);
      expect(TASK_CHECKS, id).toContain(details.check);
      expect(details.source).toBe('template');
    }
    // The analysis GetCito does itself has none: the writer drops it anyway.
    expect(templateDetails('analyze_citations')).toBeNull();
    expect(templateDetails('no_such_task')).toBeNull();
  });

  it('checks every task a person or an agent does, and every validation but a data window’s', () => {
    // A data window (GA4, Search Console, AI visits) fits none of the checks;
    // no plan uses the baseline's.
    const windows = ['validate_ai_traffic', 'validate_gsc', 'validate_ga4'];
    const unused = ['define_validation_baseline'];
    const doing = Object.values(TASKS).filter(
      (task) =>
        !task.legacy &&
        !/^(?:analyze|identify|map|cluster|prioritize)_/.test(task.id) &&
        ![...windows, ...unused].includes(task.id),
    );
    expect(doing.map((task) => task.id).filter((id) => !TEMPLATED_TASKS.includes(id))).toEqual([]);
  });

  it('has a Done when on the web for every task with a check (en.json actionCenter.taskDoneWhen)', () => {
    const doneWhen = JSON.parse(
      readFileSync(new URL('../../../../../frontend/messages/en.json', import.meta.url), 'utf8'),
    ).actionCenter.taskDoneWhen;
    for (const id of TEMPLATED_TASKS) expect(typeof doneWhen[id], id).toBe('string');
    // And none for a task that isn't one.
    for (const id of Object.keys(doneWhen)) expect(TASKS[id], id).toBeDefined();
  });

  it('gives a change on a page its action’s one page, and a re-run or a link task none', () => {
    const one = { targetEntity: 'pages', targetCount: 1, targets: [{ id: '/pricing' }] };
    expect(templateDetails('optimize_content', one)).toEqual({
      check: 'auto',
      url: '/pricing',
      source: 'template',
    });
    expect(templateDetails('validate_citations', one)).toEqual({
      check: 'rerun',
      source: 'template',
    });
    // Its links go on other pages.
    expect(templateDetails('add_internal_links', one)).not.toHaveProperty('url');
    expect(templateDetails('prepare_outreach', one).check).toBe('manual');
  });

  it('leaves a call to action to the person, on its page: a re-fetch can’t tell it (#1565)', () => {
    const one = { targetEntity: 'pages', targetCount: 1, targets: [{ id: '/pricing' }] };
    expect(templateDetails('improve_cta_path', one)).toEqual({
      check: 'manual',
      url: '/pricing',
      source: 'template',
    });
    expect(CHECKS).not.toHaveProperty('improve_cta_path');
  });
});

describe('onePage', () => {
  it('reads the one page an action is about, never several or the whole site', () => {
    expect(
      onePage({
        targetEntity: 'pages',
        targetCount: 1,
        targets: [{ id: 'https://acme.example/a' }],
      }),
    ).toBe('https://acme.example/a');
    expect(onePage({ targetEntity: 'pages', targetCount: 1, targetIds: ['/a'] })).toBe('/a');
    // A traffic page keeps its full URL beside the path it is counted by.
    expect(
      onePage({
        targetEntity: 'pages',
        targetCount: 1,
        targets: [{ id: '/a' }],
        pages: ['https://acme.example/a'],
      }),
    ).toBe('https://acme.example/a');
    // A sent action's one page (a draft's, an opportunity's).
    expect(
      onePage({ targetEntity: 'prompts', targetCount: 3, pages: ['https://acme.example/b'] }),
    ).toBe('https://acme.example/b');
    expect(
      onePage({ targetEntity: 'pages', targetCount: 2, targets: [{ id: '/a' }, { id: '/b' }] }),
    ).toBeNull();
    expect(
      onePage({ targetEntity: 'pages', targetCount: 1, targets: [{ id: 'site' }] }),
    ).toBeNull();
    expect(
      onePage({ targetEntity: 'prompts', targetCount: 1, targets: [{ id: 'p1' }] }),
    ).toBeNull();
    expect(onePage({ pages: ['https://acme.example/a', 'https://acme.example/b'] })).toBeNull();
    expect(onePage({ pages: [null] })).toBeNull();
    expect(onePage()).toBeNull();
    // An opportunity with a new page and one to optimize: neither is the other's.
    expect(
      onePage({
        assets: [{ decision: 'create' }, { decision: 'optimize' }],
        pages: ['https://acme.example/b'],
      }),
    ).toBeNull();
    expect(onePage({ assets: [{ decision: 'optimize' }], pages: ['https://acme.example/b'] })).toBe(
      'https://acme.example/b',
    );
  });
});
