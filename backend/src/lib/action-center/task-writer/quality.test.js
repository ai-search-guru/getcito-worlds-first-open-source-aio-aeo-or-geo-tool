import { describe, expect, it } from 'vitest';
import { buildEvidence } from './evidence.js';
import { onlyGaps, pageAddress, sameTask, taskGaps, taskProblems } from './quality.js';

const evidence = buildEvidence([
  {
    id: 's1',
    kind: 'lost_citations',
    payload: {
      promptId: 'p1',
      promptText: 'Which coffee subscriptions ship internationally?',
      lostUrls: [{ url: 'https://acme.example/blog/shipping', position: 2 }],
      citedNow: [{ url: 'https://seriouseats.com/best', domain: 'seriouseats.com' }],
    },
  },
]);

const good = {
  title: 'Add a 2026 shipping table to /blog/shipping',
  url: 'https://acme.example/blog/shipping',
  where: 'acme.example/blog/shipping · lost on ChatGPT',
  why: 'Cited #2 until Oct 12; seriouseats.com now has a dated table.',
  change: { before: '', after: 'H2 "Where do we ship?" with a table of 12 countries and costs.' },
  how: ['Add a table of countries and costs.', 'Put "2026" in the title.'],
  doneWhen: 'Cited again on ChatGPT within 14 days.',
  check: 'rerun',
  type: 'content',
  effort: '~2h',
  role: 'Content writer',
  refs: ['page:1', 'domain:1'],
};

describe('taskProblems', () => {
  it('keeps a concrete task', () => {
    expect(taskProblems(good, evidence)).toEqual([]);
  });

  it('refuses a title that counts instead of naming', () => {
    expect(taskProblems({ ...good, title: 'Refresh content for 7 prompts' }, evidence)).toContain(
      'the title counts prompts or pages instead of naming one',
    );
    expect(
      taskProblems({ ...good, title: 'Improve /blog/shipping across 3 pages' }, evidence),
    ).toContain('the title counts prompts or pages instead of naming one');
  });

  it('refuses analysis the product does itself', () => {
    expect(
      taskProblems({ ...good, title: 'Analyze citations on /blog/shipping' }, evidence),
    ).toContain('it is analysis, which the product does itself; write the change to make');
  });

  it('needs where, 2 to 5 steps, done-when and a known type', () => {
    expect(
      taskProblems(
        { ...good, where: ' ', how: ['One step.'], doneWhen: '', type: 'marketing' },
        evidence,
      ),
    ).toEqual([
      'Where is empty',
      'How needs 2 to 5 steps',
      'Done when is empty',
      'its type is not one of the six',
    ]);
  });

  it('needs the exact page, the change and how it is checked (AC-010)', () => {
    expect(
      taskProblems(
        { ...good, url: '', change: { before: 'Old text', after: ' ' }, check: 'weekly' },
        evidence,
      ),
    ).toEqual([
      'URL is empty',
      'the change has no after text',
      'check is not auto, rerun or manual',
    ]);
    expect(taskProblems({ ...good, change: undefined }, evidence)).toEqual([
      'the change has no after text',
    ]);
    // A page's address: a full URL, a path, or a host and path as the evidence shows them.
    expect(taskProblems({ ...good, url: 'the shipping guide' }, evidence)).toEqual([
      'URL is not a page address (https://… or /…)',
    ]);
    expect(taskProblems({ ...good, url: '/blog/shipping', check: 'auto' }, evidence)).toEqual([]);
    expect(taskProblems({ ...good, url: 'acme.example/blog/shipping?ref=1' }, evidence)).toEqual(
      [],
    );
    expect(taskProblems({ ...good, check: 'Auto' }, evidence)).toEqual([]);
  });

  it('stores a host and path with its https://, and no address as none', () => {
    expect(pageAddress(' acme.example/blog/shipping ')).toBe('https://acme.example/blog/shipping');
    expect(pageAddress('/pricing')).toBe('/pricing');
    expect(pageAddress('http://acme.example/x')).toBe('http://acme.example/x');
    expect(pageAddress('the shipping guide')).toBeNull();
    expect(pageAddress(undefined)).toBeNull();
  });

  it('names the fields a task misses, and tells them from its other problems (AC-010)', () => {
    expect(taskGaps(good)).toEqual([]);
    expect(
      taskGaps({ ...good, url: 'the guide', change: { before: 'x', after: '' }, doneWhen: ' ' }),
    ).toEqual(['url', 'change', 'doneWhen']);
    expect(taskGaps({ ...good, check: undefined })).toEqual(['check']);
    expect(onlyGaps(taskProblems({ ...good, url: '', check: 'later' }, evidence))).toBe(true);
    // Another problem with them, or none at all: not a gap to review.
    expect(onlyGaps(taskProblems({ ...good, url: '', where: '' }, evidence))).toBe(false);
    expect(onlyGaps([])).toBe(false);
  });

  it('needs refs the evidence has, and its target named', () => {
    expect(taskProblems({ ...good, refs: [] }, evidence)).toEqual([
      'it cites none of the evidence refs',
    ]);
    expect(taskProblems({ ...good, refs: ['page:1', 'page:9'] }, evidence)).toEqual([
      'it cites refs the evidence does not have (page:9)',
    ]);
    expect(
      taskProblems(
        { ...good, title: 'Rewrite the shipping guide', where: 'Your blog', url: '/pricing' },
        evidence,
      ),
    ).toEqual(['neither the title, Where nor URL names its target']);
    // The URL names the page.
    expect(
      taskProblems({ ...good, title: 'Rewrite the shipping guide', where: 'Your blog' }, evidence),
    ).toEqual([]);
  });
});

describe('a task aimed at a prompt', () => {
  const prompts = buildEvidence([
    {
      id: 's2',
      kind: 'uncited_mentions',
      payload: {
        mentions: [
          {
            promptId: 'p9',
            promptText: 'What are the best coffee subscriptions in 2026?',
            platforms: ['gemini-web'],
          },
        ],
      },
    },
  ]);
  const aimed = {
    ...good,
    title: 'Publish a buyer guide that cites acme.example',
    url: '/guides/coffee-subscriptions',
    refs: ['prompt:1'],
  };

  it('names the prompt by its first words, whatever the quotes and case', () => {
    expect(
      taskProblems(
        { ...aimed, where: 'Gemini · "what are the BEST coffee subscriptions" prompt' },
        prompts,
      ),
    ).toEqual([]);
  });

  it('does not count a paraphrase as naming it', () => {
    expect(
      taskProblems({ ...aimed, where: 'Gemini · prompts about coffee subscriptions' }, prompts),
    ).toEqual(['neither the title, Where nor URL names its target']);
  });
});

describe('sameTask', () => {
  it('reads two titles that differ only in case and spacing as one', () => {
    expect(
      sameTask(good, { ...good, title: '  add a 2026 SHIPPING table to /blog/shipping ' }),
    ).toBe(true);
  });
});
