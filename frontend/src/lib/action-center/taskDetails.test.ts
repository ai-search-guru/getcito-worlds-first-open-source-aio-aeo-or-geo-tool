import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MANUAL_TASKS,
  PAGE_CHECKED_TASKS,
  pageCheckable,
  type ActionTaskDetails,
  TASK_DETAIL_LIMITS,
  cleanTaskDetailsEdit,
  isTaskDetailsEdit,
  parseTaskDetails,
  withTemplateCheck,
  withTemplateDoneWhen,
  withoutTemplateDoneWhen,
} from './taskDetails';

const empty = {
  body: null,
  platform: null,
  platformLabel: null,
  sources: [],
  where: null,
  url: null,
  change: null,
  why: null,
  how: [],
  doneWhen: null,
  check: null,
  type: null,
  effort: null,
  role: null,
  sent: { content: null, webhook: null },
  lastCheck: null,
};

describe('parseTaskDetails', () => {
  it('reads a task sent from the Improve tab, which has none of the AC-004 fields', () => {
    expect(
      parseTaskDetails({
        body: 'Lead with the table.',
        platform: 'chatgpt-web',
        platformLabel: 'ChatGPT',
        sources: [{ type: 'domain', ref: 'profound.com' }],
      }),
    ).toEqual({
      ...empty,
      body: 'Lead with the table.',
      platform: 'chatgpt-web',
      platformLabel: 'ChatGPT',
      sources: [{ type: 'domain', ref: 'profound.com' }],
    });
  });

  it('reads where, why, how, done-when, type, effort and role', () => {
    expect(
      parseTaskDetails({
        where: 'acme.example/blog/best-tools',
        why: 'Cited #2 until Oct 8.',
        how: ['Add a table.', '  ', 'Update the title.'],
        doneWhen: 'Cited again on 2 of 3 platforms.',
        type: 'content',
        effort: '~2h',
        role: 'Content writer',
      }),
    ).toEqual({
      ...empty,
      where: 'acme.example/blog/best-tools',
      why: 'Cited #2 until Oct 8.',
      how: ['Add a table.', 'Update the title.'],
      doneWhen: 'Cited again on 2 of 3 platforms.',
      type: 'content',
      effort: '~2h',
      role: 'Content writer',
    });
  });

  it('reads the exact page, the change and how it is checked (AC-010)', () => {
    expect(
      parseTaskDetails({
        url: ' /blog/best-tools ',
        change: { before: '  ', after: 'H2 "How accurate is it?" with a 50-word answer.' },
        check: 'auto',
      }),
    ).toEqual({
      ...empty,
      url: '/blog/best-tools',
      // Nothing it replaces: it adds.
      change: { before: null, after: 'H2 "How accurate is it?" with a 50-word answer.' },
      check: 'auto',
    });
    // A change with no new text is none; an unknown check is none.
    expect(
      parseTaskDetails({ where: '/x', change: { before: 'Old', after: ' ' }, check: 'weekly' }),
    ).toEqual({ ...empty, where: '/x' });
    expect(parseTaskDetails({ change: 'Add an H2' })).toBeNull();
  });

  it('ignores what is malformed rather than failing on it', () => {
    expect(
      parseTaskDetails({
        where: 'x.example',
        how: 'not a list',
        type: 'marketing',
        sources: [{ type: 'domain' }, null, 'x'],
      }),
    ).toEqual({ ...empty, where: 'x.example' });
  });

  it('is null when there is nothing to show', () => {
    expect(parseTaskDetails(null)).toBeNull();
    expect(parseTaskDetails([])).toBeNull();
    expect(parseTaskDetails('text')).toBeNull();
    expect(parseTaskDetails({ where: '  ', how: [] })).toBeNull();
  });
});

describe('the last automatic check (AC-010)', () => {
  it('reads what the server kept, and nothing malformed', () => {
    expect(
      parseTaskDetails({
        check: 'auto',
        autoCheck: { at: '2026-10-27T03:00:00Z', passed: false, missing: ['page_error', 7] },
      })?.lastCheck,
    ).toEqual({ at: '2026-10-27T03:00:00Z', passed: false, missing: ['page_error'] });
    expect(parseTaskDetails({ check: 'auto', autoCheck: { at: 'x' } })?.lastCheck).toBeNull();
    expect(parseTaskDetails({ check: 'auto', autoCheck: 'passed' })?.lastCheck).toBeNull();
  });
});

describe('withTemplateDoneWhen', () => {
  const doneWhenOf = (key: string) => (key === 'refresh_content' ? 'Refreshed and live' : null);

  it("gives a library task its template's Done when until someone writes one (AC-010)", () => {
    expect(withTemplateDoneWhen(null, 'refresh_content', doneWhenOf)).toEqual({
      ...empty,
      doneWhen: 'Refreshed and live',
    });
    const own = parseTaskDetails({ doneWhen: 'Our own check', check: 'auto' });
    expect(withTemplateDoneWhen(own, 'refresh_content', doneWhenOf)).toBe(own);
    const checked = parseTaskDetails({ check: 'auto' });
    expect(withTemplateDoneWhen(checked, 'refresh_content', doneWhenOf)).toEqual({
      ...checked,
      doneWhen: 'Refreshed and live',
    });
    // No template, or a task written by hand: as it is.
    expect(withTemplateDoneWhen(null, 'analyze_citations', doneWhenOf)).toBeNull();
    expect(withTemplateDoneWhen(checked, null, doneWhenOf)).toBe(checked);
  });
});

describe('withoutTemplateDoneWhen', () => {
  const edit = {
    url: '',
    where: '',
    why: '',
    before: '',
    after: '',
    how: [],
    doneWhen: ' Refreshed and live ',
    check: null,
    type: null,
    effort: '~1h',
    role: '',
  };
  const shown = parseTaskDetails({ doneWhen: 'Refreshed and live' });

  it("gives the template's Done when back as none when it's left as it was (AC-010)", () => {
    expect(withoutTemplateDoneWhen(edit, null, shown).doneWhen).toBe('');
    // Changed, it's the person's.
    expect(withoutTemplateDoneWhen({ ...edit, doneWhen: 'Ours' }, null, shown).doneWhen).toBe(
      'Ours',
    );
    // The task's own, the same words or not, stays its own.
    expect(withoutTemplateDoneWhen(edit, shown, shown).doneWhen).toBe(' Refreshed and live ');
  });
});

describe('cleanTaskDetailsEdit', () => {
  const edit = {
    url: '',
    where: '',
    why: '',
    before: '',
    after: '',
    how: [],
    doneWhen: '',
    check: null,
    type: null,
    effort: '',
    role: '',
  };

  it('trims, and stores a cleared field as null', () => {
    expect(
      cleanTaskDetailsEdit({ ...edit, where: '  /pricing  ', why: '   ', effort: ' ~1h ' }),
    ).toEqual({
      url: null,
      where: '/pricing',
      why: null,
      change: null,
      how: [],
      doneWhen: null,
      check: null,
      type: null,
      effort: '~1h',
      role: null,
    });
  });

  it('keeps the change only with its new text, and a known check (AC-010)', () => {
    expect(
      cleanTaskDetailsEdit({
        ...edit,
        url: ' /pricing ',
        before: ' Old line ',
        after: ' New line ',
        check: 'rerun',
      }),
    ).toMatchObject({
      url: '/pricing',
      change: { before: 'Old line', after: 'New line' },
      check: 'rerun',
    });
    // Before alone is no change; an empty before adds.
    expect(cleanTaskDetailsEdit({ ...edit, before: 'Old line' }).change).toBeNull();
    expect(cleanTaskDetailsEdit({ ...edit, after: 'New line' }).change).toEqual({
      before: null,
      after: 'New line',
    });
    expect(cleanTaskDetailsEdit({ ...edit, check: 'weekly' as never }).check).toBeNull();
  });

  it('drops blank steps and keeps at most the limit', () => {
    const how = ['One', '', '  ', ...Array.from({ length: 12 }, (_, i) => `Step ${i}`)];
    const cleaned = cleanTaskDetailsEdit({ ...edit, how });
    expect(cleaned.how[0]).toBe('One');
    expect(cleaned.how).toHaveLength(TASK_DETAIL_LIMITS.steps);
  });

  it('cuts each field to its length and refuses an unknown type', () => {
    const cleaned = cleanTaskDetailsEdit({
      ...edit,
      why: 'x'.repeat(1000),
      type: 'marketing' as never,
    });
    expect(cleaned.why).toHaveLength(TASK_DETAIL_LIMITS.why);
    expect(cleaned.type).toBeNull();
  });
});

describe('isTaskDetailsEdit', () => {
  const edit = {
    url: '/pricing',
    where: '/pricing',
    why: '',
    before: '',
    after: 'A table of plans.',
    how: ['Add a table.'],
    doneWhen: '',
    check: 'auto',
    type: 'content',
    effort: '',
    role: '',
  };

  it('accepts what the form sends', () => {
    expect(isTaskDetailsEdit(edit)).toBe(true);
    expect(isTaskDetailsEdit({ ...edit, type: null })).toBe(true);
  });

  it('refuses a malformed edit before anything reads it', () => {
    expect(isTaskDetailsEdit(null)).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, how: 'Add a table.' })).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, how: [1] })).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, where: null })).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, type: 'marketing' })).toBe(false);
    // AC-010's fields, from a form before them or with a wrong check.
    expect(isTaskDetailsEdit({ ...edit, url: undefined })).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, after: null })).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, check: 'weekly' })).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, check: null })).toBe(true);
  });
});

describe('where a task was sent', () => {
  it('reads the opportunity it became and when it went to the webhook', () => {
    expect(
      parseTaskDetails({
        where: '/pricing',
        sent: {
          content: { opportunityId: 'o1', at: '2026-10-16T10:00:00Z' },
          webhook: { at: '2026-10-16T11:00:00Z', delivered: 1, failed: 0 },
        },
      })?.sent,
    ).toEqual({
      content: { opportunityId: 'o1', at: '2026-10-16T10:00:00Z' },
      webhook: { at: '2026-10-16T11:00:00Z' },
    });
  });

  it('ignores a malformed record', () => {
    expect(
      parseTaskDetails({ where: '/pricing', sent: { content: {}, webhook: 'x' } })?.sent,
    ).toEqual({ content: null, webhook: null });
  });
});

describe('pageCheckable', () => {
  const auto = (over: Partial<ActionTaskDetails> = {}) =>
    ({ check: 'auto', url: '/pricing', change: null, ...over }) as ActionTaskDetails;

  it('checks a library task the API reads on its page, or a written one with its new text', () => {
    expect(pageCheckable({ taskKey: 'refresh_content', details: auto() })).toBe(true);
    expect(
      pageCheckable({ taskKey: null, details: auto({ change: { before: null, after: 'New' } }) }),
    ).toBe(true);
  });

  it('leaves out a Site Audit fix, a written task without new text, and a task with no page', () => {
    expect(pageCheckable({ taskKey: 'fix_meta_description', details: auto() })).toBe(false);
    expect(pageCheckable({ taskKey: null, details: auto() })).toBe(false);
    expect(pageCheckable({ taskKey: 'refresh_content', details: auto({ url: ' ' }) })).toBe(false);
    expect(pageCheckable({ taskKey: 'refresh_content', details: auto({ check: 'manual' }) })).toBe(
      false,
    );
  });

  it('keeps Check now on a shopping links task, which has no new text (#1616)', () => {
    expect(pageCheckable({ taskKey: null, details: auto() }, 'shopping_links')).toBe(true);
    expect(pageCheckable({ taskKey: null, details: auto() }, 'content_draft')).toBe(false);
    expect(
      pageCheckable({ taskKey: null, details: auto({ check: 'manual' }) }, 'shopping_links'),
    ).toBe(false);
  });

  it("lists the API's checked tasks, no more and no fewer", () => {
    const server = readFileSync(
      join(__dirname, '../../../../backend/src/lib/action-center/taskChecks.js'),
      'utf8',
    );
    const block = server.match(/export const CHECKS = Object\.freeze\(\{([^}]*)\}\)/)![1];
    const keys = [...block.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
    expect([...PAGE_CHECKED_TASKS].sort()).toEqual(keys.sort());
  });
});

describe('withTemplateCheck', () => {
  const auto = parseTaskDetails({
    url: '/pricing',
    check: 'auto',
    autoCheck: { at: '2026-10-20T00:00:00Z', passed: false, missing: ['not_changed'] },
  });

  it('reads a task planned while its template was Automatic as Manual', () => {
    expect(withTemplateCheck(auto, 'improve_cta_path')).toMatchObject({
      check: 'manual',
      url: '/pricing',
      lastCheck: null,
    });
  });

  it("keeps a page-checked task's, a Site Audit fix's and a written task's check", () => {
    expect(withTemplateCheck(auto, 'refresh_content')).toBe(auto);
    expect(withTemplateCheck(auto, 'fix_technical_issue')).toBe(auto);
    expect(withTemplateCheck(auto, null)).toBe(auto);
    expect(withTemplateCheck(null, 'improve_cta_path')).toBeNull();
  });

  it("lists the templates' Manual tasks, no more and no fewer", () => {
    const server = readFileSync(
      join(__dirname, '../../../../backend/src/lib/action-center/tasks/templates.js'),
      'utf8',
    );
    const block = server.match(/const TEMPLATES = Object\.freeze\(\{([\s\S]*?)\n\}\);/)![1];
    const keys = [...block.matchAll(/^\s*([a-z_]+): \{ check: 'manual'/gm)].map((m) => m[1]);
    expect(keys).toContain('improve_cta_path');
    expect([...MANUAL_TASKS].sort()).toEqual(keys.sort());
  });
});
