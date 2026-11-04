import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { nextStep, type NextStepState } from '@/lib/content/nextStep';
import type { AgentRun } from '@/lib/content/agentRuns';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { NextStepButton, wordsUnderTitle, stepActor } = await import('./_NextStep');

/**
 * The Next step basket (Next step spec §2–3): the header's button names
 * the step; the popover gives why, its buttons, Skip, the path and the
 * "If you see…" lines, or the run under way with Stop.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const state = (over: Partial<NextStepState> = {}): NextStepState => ({
  method: 'create',
  open: true,
  published: false,
  hasBrief: true,
  empty: false,
  rewrite: null,
  openRules: [],
  quality: { trust: 72, trustLow: false, todos: [] },
  skipped: {},
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onAction = vi.fn();
const onSkip = vi.fn();
const onOpenChange = vi.fn();

async function render(
  s: NextStepState,
  {
    open = true,
    todoLine = null as string | null,
    blocked = (() => null) as (action: string) => string | null,
    working = null as { run: AgentRun | null; onStop: () => void; stopping: boolean } | null,
    raises = [] as { line: string; gain: string | null }[],
    cost = null as { minutes: number; percent: number | null } | null,
  } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NextStepButton
          next={nextStep(s)}
          state={s}
          todoLine={todoLine}
          open={open}
          onOpenChange={onOpenChange}
          focusOnOpen
          onAction={onAction}
          onSkip={onSkip}
          blocked={blocked}
          working={working}
          raises={raises}
          cost={cost}
        />
      </NextIntlClientProvider>,
    );
  });
}
const trigger = () => container.querySelector('button')!;
const popup = () => document.querySelector('[data-slot="dialog-content"]');
const button = (name: string) =>
  [...(popup()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name);
const path = () => [...popup()!.querySelectorAll('ol li')].map((li) => li.textContent);

beforeEach(() => {
  onAction.mockReset();
  onSkip.mockReset();
  onOpenChange.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('NextStepButton', () => {
  it('names the step on the header button and opens the basket on a click', async () => {
    await render(state({ hasBrief: false, empty: true }), { open: false });
    expect(trigger().getAttribute('aria-label')).toBe('Next · Plan the page');
    expect(trigger().textContent).toBe('Next· Plan the page');
    expect(popup()).toBeNull();
    await act(async () => trigger().click());
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('counts the open rules once, as Rules does, and how many the agent can fix (editor UX review 2026-11-03)', async () => {
    // Length far off and a rule held by quoted passages: open in the Rules tab, not for Fix.
    await render(state({ method: 'optimize', openRules: ['faq'], openTotal: 3 }));
    expect(popup()!.textContent).toContain(
      '3 rules are open: Content Agent can fix 1 in small, reviewable changes, and 2 are yours to decide in the Rules tab.',
    );
    // As many as a Fix is sent, its Length among them: as Rules counts them.
    await render(state({ method: 'optimize', openRules: ['faq'], openTotal: 3, fixable: 2 }));
    expect(popup()!.textContent).toContain(
      '3 rules are open: Content Agent can fix 2 in small, reviewable changes, and 1 is yours',
    );
    // All of them the agent's.
    await render(state({ method: 'optimize', openRules: ['faq', 'summary'], openTotal: 2 }));
    expect(popup()!.textContent).toContain(
      '2 rules are open, all for the agent. Small, reviewable changes for them.',
    );
  });

  it('says why from the page, with its button, the other one and Skip', async () => {
    await render(
      state({
        method: 'optimize',
        rewrite: { reason: 'length', count: 19_203, target: 8_000, percent: 140 },
        openRules: ['rule0', 'rule1', 'rule2'],
      }),
    );
    expect(popup()!.textContent).toContain('Shorten to your Length');
    expect(popup()!.textContent).toContain(
      "19,203 characters against a Length of 8,000. Small fixes won't get there, so rewrite it in one go.",
    );
    await act(async () => button('Rewrite page')!.click());
    expect(onAction).toHaveBeenCalledWith('rewritePage');
    await act(async () => button('Fix open rules')!.click());
    expect(onAction).toHaveBeenCalledWith('fixRules');
    await act(async () => button('Skip this step')!.click());
    expect(onSkip).toHaveBeenCalledWith('length');
    expect(path()).toEqual([
      'Plan the page · done',
      'Bring in your page · done',
      '3Shorten to your Length · now',
      '4Add proof and author · to do',
      '5Check and mark ready · to do',
    ]);
    // If you see…: each line with its button, none repeating the step's own.
    expect(popup()!.textContent).not.toContain('Page far longer than Length');
    expect(popup()!.textContent).not.toContain('rules open →');
    // Fix open rules passed: the line names how few are open (the Rules tab's rewrite count less one).
    const few = state({ openRules: ['faq', 'summary'], skipped: { fixRules: 'faq,summary' } });
    await render(few);
    expect(popup()!.textContent).toContain('1 to 3 rules open → Fix open rules');
  });

  it('crosses out a step the agent took, as a done one, and not its note (editor test 2026-10-27)', async () => {
    await render(
      state({
        openRules: ['faq'],
        thirdPasses: { fixRules: { rules: ['faq'], length: '' } },
      }),
    );
    const step = [...popup()!.querySelectorAll('ol li')].find((li) =>
      li.textContent?.includes('Fix open rules'),
    )!;
    expect(step.textContent).toContain('the rest is in Rules');
    // Ticked and its bar filled, as a done step's (editor test 2026-11-03:
    // shown like one ahead, it read as never done).
    expect(step.querySelector('svg')).not.toBeNull();
    const bars = [...popup()!.querySelectorAll('i')].map((bar) => bar.className);
    expect(bars[2]).toContain('bg-foreground');
    expect(bars[2]).not.toContain('bg-foreground/');
    const name = [...step.querySelectorAll('span')].find(
      (s) => s.textContent === 'Fix open rules',
    )!;
    expect(name.className).toContain('line-through');
    // The note says what is still the person's: never crossed out, by
    // itself or by what holds it.
    const note = [...step.querySelectorAll('span')].find(
      (s) => s.textContent === 'done by Content Agent, the rest is in Rules',
    )!;
    expect(note.className).not.toContain('line-through');
    expect(name.parentElement!.className).not.toContain('line-through');
    expect(step.className).not.toContain('line-through');
  });

  it('names the to-do only the person can do while Trust is low', async () => {
    await render(
      state({
        quality: {
          trust: 54,
          trustLow: true,
          todos: [{ id: 'byline', done: false, gain: 15, score: 'eeat', action: 'pickAuthor' }],
        },
      }),
      { todoLine: "pick the page's author" },
    );
    expect(popup()!.textContent).toContain(
      "Trust is 54, under 60. Only you can do this first: pick the page's author.",
    );
    await act(async () => button('Pick author')!.click());
    expect(onAction).toHaveBeenCalledWith('pickAuthor');
  });

  it("says why a button can't run now, and offers no Skip on the last step", async () => {
    await render(state({ openRules: ['rule0', 'rule1'] }), {
      blocked: (action) =>
        action === 'fixRules' ? 'Decide on the 2 open suggestions first.' : null,
    });
    expect(button('Fix open rules')!.disabled).toBe(true);
    expect(popup()!.textContent).toContain('Decide on the 2 open suggestions first.');
    await render(state());
    expect(popup()!.textContent).toContain('Check and mark ready');
    expect(button('Before you publish')).toBeDefined();
    expect(button('Skip this step')).toBeUndefined();
    // Published: Export, saying it went out.
    await render(state({ open: false, published: true }));
    expect(popup()!.textContent).toContain(
      "It's published. Export it again when the page changes.",
    );
    expect(button('Export')).toBeDefined();
  });

  it("moves focus to the next step's button after Skip, and reads the step out", async () => {
    const s = state({ openRules: ['faq'] });
    await render(s);
    await act(async () => button('Skip this step')!.click());
    expect(onSkip).toHaveBeenCalledWith('fixRules');
    // The editor passes the skip on: the step after it shows.
    await render({ ...s, skipped: { fixRules: 'faq' } });
    expect(document.activeElement).toBe(button('Before you publish'));
    expect(popup()!.querySelector('[aria-live="polite"]')!.textContent).toContain(
      'Check and mark ready',
    );
  });

  it('shows the run under way with Stop instead of a step', async () => {
    const onStop = vi.fn();
    await render(state({ openRules: ['rule0', 'rule1'] }), {
      working: {
        run: {
          id: 'r1',
          kind: 'fix',
          steps: [
            { key: 'read_rules', count: null },
            { key: 'write_changes', count: null },
          ],
          step: 1,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          stoppedAt: null,
          outcome: null,
        },
        onStop,
        stopping: false,
      },
    });
    expect(popup()!.textContent).toContain('Content Agent is working');
    expect(button('Fix open rules')).toBeUndefined();
    await act(async () => button('Stop')!.click());
    expect(onStop).toHaveBeenCalled();
  });
});

describe('the step’s words (editor UX review 2026-11-03)', () => {
  it('names the suggestions to review, and Review is the person’s', async () => {
    await render(state({ openRules: ['faq'], waiting: 2 }));
    expect(popup()!.textContent).toContain('Review 2 suggestions');
    expect(popup()!.textContent).toContain('Content Agent left 2 suggestions on the page.');
    const review = [...popup()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Review',
    )!;
    await act(async () => review.click());
    expect(onAction).toHaveBeenCalledWith('review');
    expect(
      stepActor({ id: 'review', primary: 'review', alternative: null, skippable: false }),
    ).toBe('you');
  });

  it('says a page marked ready has steps left, never that every step is done', async () => {
    await render(
      state({
        open: false,
        openRules: ['faq'],
      }),
    );
    expect(popup()!.textContent).toContain('Marked ready with 1 step still open: see All steps.');
    expect(popup()!.textContent).not.toContain('Every step is done');
    expect(popup()!.textContent).toContain('1 step still open');
    const fix = [...popup()!.querySelectorAll('ol li')].find((li) =>
      li.textContent?.includes('Fix open rules'),
    )!;
    expect(fix.textContent).toContain('skipped');
    expect(fix.querySelector('svg')).toBeNull();
    // Nothing left: as before.
    await render(state({ open: false }));
    expect(popup()!.textContent).toContain('Every step is done.');
  });

  it('asks for sources when the brief has nothing to build from', async () => {
    await render(state({ hasBrief: false, briefSources: false }));
    expect(popup()!.textContent).toContain('Add one in Sources first.');
    expect([...popup()!.querySelectorAll('button')].map((b) => b.textContent)).toContain(
      'Add sources',
    );
  });
});

describe('the window (the user, 2026-11-03)', () => {
  it('says who takes the step and what raises the score, the most first, with its points', async () => {
    await render(state({ quality: { trust: 54, trustLow: true, todos: [] } }), {
      raises: [
        { line: 'Fill 5 placeholders', gain: '+15 E-E-A-T' },
        { line: '4 links don’t work', gain: '+38 Trust' },
        { line: 'Direct answer under each H2', gain: null },
      ],
    });
    const right = popup()!.querySelector('section')!;
    expect(right.textContent).toContain('Only you can take this step');
    expect(right.textContent).toContain('Add proof and author');
    const items = [...right.querySelectorAll('ul li')].map((li) => li.textContent);
    expect(items).toEqual([
      '+15 E-E-A-TFill 5 placeholders',
      '+38 Trust4 links don’t work',
      'Direct answer under each H2',
    ]);
    // Every step on the left.
    expect(popup()!.querySelectorAll('aside ol li')).toHaveLength(5);
    // The agent's step says so.
    await render(state({ openRules: ['faq'] }));
    expect(popup()!.querySelector('section')!.textContent).toContain(
      'Content Agent takes this step',
    );
    // Nothing to list: no heading for it.
    expect(popup()!.textContent).not.toContain('What raises it');
  });

  it('says how long the agent’s step takes and its share of the month’s AI usage', async () => {
    await render(state({ openRules: ['faq'] }), { cost: { minutes: 1, percent: 3.4 } });
    expect(popup()!.textContent).toContain("About 1 minute · 3% of this month's AI usage");
    await render(state({ openRules: ['faq'] }), { cost: { minutes: 2, percent: 0.4 } });
    expect(popup()!.textContent).toContain("About 2 minutes · <1% of this month's AI usage");
    // Unlimited, or unread: the time alone.
    await render(state({ openRules: ['faq'] }), { cost: { minutes: 2, percent: null } });
    expect(popup()!.textContent).toContain('About 2 minutes');
    expect(popup()!.textContent).not.toContain('AI usage');
    // The person's step: none.
    await render(state({ quality: { trust: 54, trustLow: true, todos: [] } }), {
      cost: { minutes: 1, percent: 3 },
    });
    expect(popup()!.textContent).not.toContain('About 1 minute');
  });
});

describe('stepActor', () => {
  it('gives the agent its runs and the person the rest', () => {
    const actor = (primary: Parameters<typeof stepActor>[0]['primary']) =>
      stepActor({ id: 'fixRules', primary, alternative: null, skippable: true });
    expect(
      (['buildBrief', 'writeWithAgent', 'rewritePage', 'fixRules'] as const).map(actor),
    ).toEqual(['agent', 'agent', 'agent', 'agent']);
    expect(
      (
        [
          'writeMyself',
          'pickAuthor',
          'addAuthor',
          'showTodos',
          'showTrust',
          'beforePublish',
          'markReady',
          'export',
        ] as const
      ).map(actor),
    ).toEqual(['you', 'you', 'you', 'you', 'you', 'you', 'you', 'you']);
  });
});

describe('wordsUnderTitle', () => {
  it('reads the words besides the block the title comes from', () => {
    expect(wordsUnderTitle('<h1>Pour-over</h1><p></p>')).toBe(false);
    expect(wordsUnderTitle('<h1>Pour-over</h1><p>Brew.</p>')).toBe(true);
    // An empty line or an image above the title changes nothing.
    expect(wordsUnderTitle('<p></p><h1>Pour-over</h1><p></p>')).toBe(false);
    expect(wordsUnderTitle('<p><img src="https://cdn.acme.com/a.jpg"></p><h1>Pour-over</h1>')).toBe(
      false,
    );
    // No H1: the first heading, else the first line, is the title.
    expect(wordsUnderTitle('<h2>Pour-over</h2><p>Brew.</p>')).toBe(true);
    expect(wordsUnderTitle('<p>Pour-over</p>')).toBe(false);
    expect(wordsUnderTitle('<p>Pour-over</p><p>Brew.</p>')).toBe(true);
    expect(wordsUnderTitle('')).toBe(false);
  });
});
