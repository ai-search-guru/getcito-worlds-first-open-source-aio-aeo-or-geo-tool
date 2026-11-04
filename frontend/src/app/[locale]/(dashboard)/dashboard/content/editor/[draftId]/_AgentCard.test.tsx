import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '@/lib/content/agentRuns';
import messages from '../../../../../../../../messages/en.json';
import type { DraftSuggestion } from '@/lib/content/suggestions';
import { ChatAgenticProvider } from '@/components/context/ChatAgenticProvider';
import { AgentCard, rulesAfter, type CardRules } from './_AgentCard';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const suggestion = (over: Partial<DraftSuggestion> = {}): DraftSuggestion => ({
  id: 's1',
  batchId: 'b1',
  actionId: null,
  actionNo: null,
  kind: 'replace',
  blockText: 'We delve into forecasting.',
  beforeText: 'delve into',
  afterText: 'look at',
  reason: 'remove an AI trace (rule)',
  ruleKeys: ['aiTraces'],
  status: 'open',
  ...over,
});

const rules: CardRules = { met: 9, total: 14, open: new Set(['aiTraces', 'summary', 'faq']) };

let container: HTMLDivElement;
let root: Root;
const handlers = {
  onAcceptAll: vi.fn(),
  onRejectAll: vi.fn(),
  onUndoAll: vi.fn(),
  onReview: vi.fn(),
  onRun: vi.fn(),
  onClose: vi.fn(),
  onDecidePage: vi.fn(),
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(handlers).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  suggestions: DraftSuggestion[],
  working = false,
  extra: Partial<Parameters<typeof AgentCard>[0]> = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentCard
          suggestions={suggestions}
          rules={rules}
          busy={false}
          working={working}
          {...handlers}
          {...extra}
        />
      </NextIntlClientProvider>,
    );
  });
}

const buttons = () => [...container.querySelectorAll('button')].map((b) => b.textContent);
const click = (label: string) =>
  act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === label)!.click(),
  );

describe('rulesAfter', () => {
  it('counts each open rule an open suggestion meets once', () => {
    expect(
      rulesAfter(
        [
          suggestion(),
          suggestion({ id: 's2', ruleKeys: ['aiTraces', 'summary'] }),
          // Decided, or a rule already met: no gain.
          suggestion({ id: 's3', ruleKeys: ['faq'], status: 'rejected' }),
          suggestion({ id: 's4', ruleKeys: ['sentence'] }),
        ],
        rules,
      ),
    ).toBe(11);
    expect(rulesAfter([suggestion()], { ...rules, met: 14 })).toBe(14);
  });
});

describe('AgentCard', () => {
  it('says how many suggestions wait, what they change and the rules they gain', async () => {
    await render([
      suggestion(),
      suggestion({ id: 's2', reason: 'add a summary', ruleKeys: ['summary'] }),
    ]);
    expect(container.textContent).toContain('Content Agent has 2 suggestions for you');
    expect(container.textContent).toContain(
      'Remove an AI trace (rule) · +1 more · 9 → 11/14 rules',
    );
    expect(buttons()).toEqual(['Review', 'Reject all', 'Accept all']);
    await click('Review');
    expect(handlers.onReview).toHaveBeenCalled();
    await click('Accept all');
    expect(handlers.onAcceptAll).toHaveBeenCalled();
  });

  it('once all are reviewed, says what was accepted and runs the agent again', async () => {
    await render([
      suggestion({ status: 'accepted' }),
      suggestion({ id: 's2', status: 'rejected' }),
    ]);
    expect(container.textContent).toContain('All suggestions reviewed');
    expect(container.textContent).toContain('1 accepted · 9/14 rules · 5 still open');
    expect(buttons().slice(0, 2)).toEqual(['Undo all', 'Fix open rules']);
    expect(container.querySelector('button[aria-label="Close"]')).not.toBeNull();
    await click('Fix open rules');
    expect(handlers.onRun).toHaveBeenCalled();
  });

  it("offers the Next step basket's step in Run Agent's place, with All steps", async () => {
    const onNext = vi.fn();
    const onAllSteps = vi.fn();
    const reviewed = [
      suggestion({ status: 'accepted' }),
      suggestion({ id: 's2', status: 'rejected' }),
    ];
    await render(reviewed, false, {
      next: { label: 'Rewrite page', onRun: onNext, blocked: null },
      onAllSteps,
    });
    expect(buttons().slice(0, 3)).toEqual(['Undo all', 'All steps', 'Next: Rewrite page']);
    await click('Next: Rewrite page');
    expect(onNext).toHaveBeenCalled();
    expect(handlers.onRun).not.toHaveBeenCalled();
    await click('All steps');
    expect(onAllSteps).toHaveBeenCalled();
    // With every rule met it still says what's next, and why it waits when it can't run.
    await render(reviewed, false, {
      rules: { ...rules, met: 14 },
      next: { label: 'Before you publish', onRun: onNext, blocked: 'Saving first.' },
      onAllSteps,
    });
    const nextButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Next: Before you publish',
    )!;
    expect(nextButton.disabled).toBe(true);
    expect(container.textContent).toContain('Saving first.');
    // Suggestions still to decide come first.
    await render([suggestion()], false, {
      next: { label: 'Rewrite page', onRun: onNext, blocked: null },
    });
    expect(buttons()).not.toContain('Next: Rewrite page');
  });

  it('heads with the Next step and who takes it, what the agent left as its last run', async () => {
    const reviewed = [suggestion({ status: 'accepted' })];
    const step = {
      label: 'Rewrite page',
      onRun: vi.fn(),
      blocked: null,
      title: 'Shorten to your Length',
      reason: '6,773 characters against a Length of 4,000.',
      actor: 'agent' as const,
    };
    await render(reviewed, false, { next: step });
    const card = container.querySelector('[role="region"]')!;
    expect(card.textContent).toContain('Next · Shorten to your Length');
    expect(card.textContent).toContain('Content Agent takes this step');
    expect(card.textContent).toContain('6,773 characters against a Length of 4,000.');
    expect(card.textContent).toContain('Last run: All suggestions reviewed · 1 accepted');
    // The agent's step: its robot.
    expect(card.querySelector('svg rect')).not.toBeNull();
    // The step changes, and so does the card: the person's step, the person's tile.
    await render(reviewed, false, {
      next: {
        ...step,
        label: 'Pick author',
        title: 'Add proof and author',
        reason: "Only you can do this: pick the page's author.",
        actor: 'you',
      },
    });
    expect(card.textContent).toContain('Next · Add proof and author');
    expect(card.textContent).toContain("Only you can do this: pick the page's author.");
    expect(card.textContent).toContain('only you can take this step');
    expect(card.querySelector('svg rect')).toBeNull();
    // The agent's suggestions still to decide keep its tile and their count in sight.
    await render([suggestion()], false, { next: { ...step, actor: 'you' } });
    expect(card.querySelector('svg rect')).not.toBeNull();
    // Working: the run, not the step.
    await render([], true, { next: step });
    expect(card.textContent).toBe('Content Agent is working');
    // A rewrite to decide heads with what it is, not the step after it, with its own buttons.
    await render(
      [
        suggestion({
          kind: 'page',
          beforeHtml: '<h1>Old</h1><p>A much longer page than this one.</p>',
          afterText: '<h1>New</h1><p>Shorter.</p>',
          reason: 'cut to the Length',
        }),
      ],
      false,
      { next: step },
    );
    expect(card.textContent).not.toContain('Next · Shorten to your Length');
    expect(card.textContent).toContain(
      'Content Agent rewrote the page to its rules37 → 12 characters · cut to the Length',
    );
    expect(buttons()).toEqual(['Compare', 'Reject', 'Accept']);
  });

  it('works under Chat’s avatar and says the page can be left, with the new Chat on only', async () => {
    const working = (chatOn: boolean, onServer = true) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages}>
            <ChatAgenticProvider enabled={chatOn}>
              <AgentCard
                suggestions={[]}
                rules={rules}
                busy={false}
                working
                onServer={onServer}
                {...handlers}
              />
            </ChatAgenticProvider>
          </NextIntlClientProvider>,
        );
      });
    await working(true);
    expect(container.querySelector('[data-slot="agent-avatar"]')?.getAttribute('data-state')).toBe(
      'working',
    );
    expect(container.textContent).toContain("You can leave this page. I'll keep going.");
    // Still in the browser (the brief's prompts and sources): leaving would lose it.
    await working(true, false);
    expect(container.querySelector('[data-slot="agent-avatar"]')).not.toBeNull();
    expect(container.textContent).not.toContain('You can leave this page');
    // Chat off: the card as it was.
    await working(false);
    expect(container.querySelector('[data-slot="agent-avatar"]')).toBeNull();
    expect(container.textContent).not.toContain('You can leave this page');
  });

  it('says how many placeholders the result leaves to fill', async () => {
    const page = suggestion({
      kind: 'page',
      beforeHtml: '<h1>Old</h1><p>Teams cut churn by [figure, source].</p>',
      afterText:
        '<h1>New</h1><p>Teams cut churn by [figure, source].</p><p>[name of a real person] said so in [year].</p>',
      reason: 'answered each heading first',
    });
    await render([page], false);
    // Two new: the one the page had isn't the run's.
    expect(container.textContent).toContain(
      'answered each heading first · 2 facts need your input',
    );
    // A list the agent wrote without paragraphs in its items: read by their words.
    await render(
      [
        suggestion({
          kind: 'page',
          beforeHtml: '<h1>Old</h1><ul><li><p>Churn fell [figure, source].</p></li></ul>',
          afterText:
            '<h1>New</h1><ul><li>Churn fell [figure, source].</li></ul><p>Since [year].</p>',
          reason: 'kept the list',
        }),
      ],
      false,
    );
    expect(container.textContent).toContain('kept the list · 1 fact needs your input');
    await render(
      [
        suggestion({ afterText: 'look at [figure, source]' }),
        suggestion({ id: 's2', beforeText: 'old', afterText: 'new' }),
      ],
      false,
    );
    expect(container.textContent).toContain('1 fact needs your input');
  });

  it('reads a rewrite against the Length, not the agent’s say, and says what it kept', async () => {
    const page = suggestion({
      kind: 'page',
      beforeHtml: '<h1>Old</h1><p>A much longer page than this one.</p>',
      afterText: '<h1>New</h1><p>Shorter.</p>',
      reason: 'shortened the content to about 4 characters',
    });
    // 12 characters for a Length of 4 (3–5): missed, and what it keeps puts it out of reach.
    await render([page], false, {
      length: { target: 4, min: 3, max: 5, kept: 4, outOfReach: true },
    });
    expect(container.textContent).toContain(
      '37 → 12 characters · Length 4 not reached (4 characters are passages AI answers quote, tables and other blocks a rewrite keeps as they are)',
    );
    expect(container.textContent).not.toContain('shortened the content');
    // Something kept, but not why it missed: not named as the reason.
    await render([page], false, { length: { target: 4, min: 3, max: 5, kept: 4 } });
    expect(container.textContent).toContain('37 → 12 characters · Length 4 not reached');
    expect(container.textContent).not.toContain('characters are passages AI answers quote');
    // Within the Length: the agent's own words.
    await render([page], false, { length: { target: 12, min: 10, max: 14, kept: 0 } });
    expect(container.textContent).toContain(
      '37 → 12 characters · shortened the content to about 4 characters',
    );
  });

  it('says when a rewrite meant to shorten the page came out longer', async () => {
    const page = suggestion({
      kind: 'page',
      beforeHtml: '<h1>Old</h1><p>Short.</p>',
      afterText: '<h1>New</h1><p>A much longer page than before.</p>',
      reason: 'answered each heading first',
    });
    // Before 10, over the Length's top (5): asked to shorten it, it came out longer.
    await render([page], false, { length: { target: 4, min: 3, max: 5, kept: 0 } });
    expect(container.textContent).toContain(
      '10 → 35 characters · Length 4 not reached · longer than the page before',
    );
    // A page under its Length, asked to grow: longer is what it was asked for.
    await render([page], false, { length: { target: 20, min: 16, max: 24, kept: 0 } });
    expect(container.textContent).toContain('10 → 35 characters · Length 20 not reached');
    expect(container.textContent).not.toContain('longer than the page before');
  });

  it('says the last run failed in place of an earlier batch’s review', async () => {
    await render([suggestion({ status: 'accepted' })], false, { lastRunFailed: true });
    expect(container.textContent).toContain("Content Agent couldn't finish");
    expect(container.textContent).toContain('Nothing it wrote was kept.');
    expect(container.textContent).not.toContain('All suggestions reviewed');
  });

  it('reads the gain from the page with the changes in, and names a rule they would break', async () => {
    await render([suggestion()], false, {
      rules: { ...rules, after: { now: 9, met: 8, breaks: 'Internal links' } },
    });
    expect(container.textContent).toContain('9 → 8/14 rules · would break Internal links');
    // Counted from the page as it is now, not a read a beat behind it.
    await render([suggestion()], false, {
      rules: { ...rules, met: 7, after: { now: 9, met: 10, breaks: null } },
    });
    expect(container.textContent).toContain('9 → 10/14 rules');
    // A whole page rewritten: its count beside its characters.
    await render(
      [
        suggestion({
          kind: 'page',
          beforeHtml: '<h1>Old</h1><p>Long.</p>',
          afterText: '<h1>New</h1><p>Short.</p>',
          reason: 'answered each heading first',
        }),
      ],
      false,
      { rules: { ...rules, after: { now: 9, met: 8, breaks: 'FAQ' } } },
    );
    expect(container.textContent).toContain(
      'answered each heading first · 9 → 8/14 rules · would break FAQ',
    );
  });

  it('counts a rewrite’s characters as the toolbar does, when the editor gives them', async () => {
    const page = suggestion({
      kind: 'page',
      beforeHtml: '<h1>Old</h1><p>A much longer page than this one.</p>',
      afterText: '<h1>New</h1><p>Shorter.</p>',
      reason: 'cut it',
    });
    await render([page], false, { pageChars: { before: 6_617, after: 5_468 } });
    expect(container.textContent).toContain('6,617 → 5,468 characters');
  });

  it('says it is working, with nothing to press', async () => {
    await render([], true);
    const card = container.querySelector('[role="region"]')!;
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(card.textContent).toBe('Content Agent is working');
    expect(buttons()).toEqual([]);
  });

  it('shows a page rewritten with its characters, to compare, reject or accept', async () => {
    const page = suggestion({
      kind: 'page',
      beforeHtml: '<h1>Old</h1><p>A much longer page than this one.</p>',
      afterText: '<h1>New</h1><p>Shorter.</p>',
      reason: 'cut to the Length',
    });
    await render([page]);
    expect(container.textContent).toContain('Content Agent rewrote the page to its rules');
    expect(container.textContent).toContain('37 → 12 characters · cut to the Length');
    expect(buttons()).toEqual(['Compare', 'Reject', 'Accept']);
    await click('Accept');
    expect(handlers.onDecidePage).toHaveBeenCalledWith('accepted');
  });

  it('says how many of the person’s sources a batch or a rewrite was built from (CE-034)', async () => {
    const onSeeSources = vi.fn();
    const show = async (list: DraftSuggestion[]) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages}>
            <AgentCard
              suggestions={list}
              rules={rules}
              busy={false}
              working={false}
              sourceCount={3}
              onSeeSources={onSeeSources}
              {...handlers}
            />
          </NextIntlClientProvider>,
        );
      });
    await show([suggestion({})]);
    expect(container.textContent).toContain('built from 3 of your sources · See sources');
    await click('See sources');
    expect(onSeeSources).toHaveBeenCalledTimes(1);
    await show([
      suggestion({
        kind: 'page',
        beforeHtml: '<h1>Old</h1><p>Longer than this.</p>',
        afterText: '<h1>New</h1><p>Short.</p>',
        reason: 'cut to the Length',
      }),
    ]);
    expect(container.textContent).toContain(
      'cut to the Length · built from 3 of your sources · See sources',
    );
    // None named: nothing said.
    await render([suggestion({})]);
    expect(container.textContent).not.toContain('built from');
  });

  it('shows the run’s steps while working, done ones checked, and only Stop (CE-027/035)', async () => {
    const onStop = vi.fn();
    const run: AgentRun = {
      id: 'r1',
      kind: 'rewrite',
      steps: [
        { key: 'read_rules', count: 14 },
        { key: 'gather_sources', count: 52 },
        { key: 'rewrite_page', count: null },
        { key: 'check_sources', count: null },
      ],
      step: 1,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      stoppedAt: null,
      outcome: null,
    };
    const show = (stopping: boolean) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages}>
            <AgentCard
              suggestions={[]}
              rules={rules}
              busy={false}
              working
              run={run}
              onStop={onStop}
              stopping={stopping}
              {...handlers}
            />
          </NextIntlClientProvider>,
        );
      });
    await show(false);
    const steps = [...container.querySelectorAll('li')];
    expect(steps.map((li) => li.textContent)).toEqual([
      'Reading 14 rules',
      'Gathering 52 sources',
      'Rewriting the page',
      'Checking sources',
    ]);
    expect(steps[0].querySelector('svg')).not.toBeNull();
    expect(steps[1].querySelector('[aria-current="step"]')).not.toBeNull();
    expect(buttons()).toEqual(['Stop']);
    await click('Stop');
    expect(onStop).toHaveBeenCalledTimes(1);
    await show(true);
    expect(container.querySelector('button')!.disabled).toBe(true);

    // The rules it keeps small, as people at the brand mostly reject them (learning B6),
    // named as a list: a name may have a comma of its own.
    run.steps[0] = { key: 'read_rules', count: 14, careful: ['feedMatch', 'unknownRule', 'faq'] };
    await show(false);
    expect(container.textContent).toContain(
      'Keeping its changes small for rules people here mostly reject: Price, GTIN and stock match the feed and FAQ block.',
    );

    // What the live page earns, which it keeps (learning B5).
    run.steps[1] = {
      ...run.steps[1],
      key: 'gather_sources',
      live: { days: 30, citations: 12, before: 20, lost: 2 },
    };
    await show(false);
    expect(container.textContent).toContain(
      'Keeping what the live page earns: cited 12 times in 30 days (20 before), 2 prompts lost.',
    );
    // Thousands as the citations are, before as now.
    run.steps[1] = {
      ...run.steps[1],
      live: { days: 30, citations: 1500, before: 1200, lost: 1 },
    };
    await show(false);
    expect(container.textContent).toContain(
      'Keeping what the live page earns: cited 1,500 times in 30 days (1,200 before), 1 prompt lost.',
    );
  });

  it('stops all of its motion with reduced motion, in every state', async () => {
    for (const [list, working] of [
      [[suggestion()], false],
      [[suggestion({ status: 'accepted' })], false],
      [[], true],
    ] as const) {
      await render([...list], working);
      const moving = [...container.querySelectorAll('[class*="animate-agent"]')];
      expect(moving.length).toBeGreaterThan(0);
      expect(
        moving.every((el) => /motion-reduce:(animate-none|hidden)/.test(el.getAttribute('class')!)),
      ).toBe(true);
    }
  });

  it('undoes a page rewrite rejected, and runs the agent on what is still open', async () => {
    await render([
      suggestion({
        kind: 'page',
        status: 'rejected',
        beforeHtml: '<p>Old.</p>',
        afterText: '<p>New.</p>',
      }),
    ]);
    expect(container.textContent).toContain('Rewrite rejected');
    await click('Undo');
    expect(handlers.onDecidePage).toHaveBeenCalledWith('open');
  });

  it('says why Run Agent waits, in the card, never only on hover', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <AgentCard
            suggestions={[suggestion({ status: 'accepted' })]}
            rules={rules}
            busy={false}
            working={false}
            runBlocked="Content Agent is already working on this page."
            {...handlers}
          />
        </NextIntlClientProvider>,
      );
    });
    const run = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Fix open rules',
    )!;
    expect(run.disabled).toBe(true);
    expect(run.title).toBe('');
    const reason = container.querySelector(`[id="${run.getAttribute('aria-describedby')}"]`)!;
    expect(reason.textContent).toBe('Content Agent is already working on this page.');
    expect(reason.className).toContain('text-amber-700');
  });
});
