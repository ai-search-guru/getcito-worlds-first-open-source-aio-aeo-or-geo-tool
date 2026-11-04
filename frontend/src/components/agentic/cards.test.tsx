import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { ChatStep } from '@/lib/chat/events';
import { PlanCard, planStepPill, type PlanStep } from './PlanCard';
import { ApprovalCard, APPROVAL_CARD_STATUSES } from './ApprovalCard';
import { QuestionAnswered, QuestionCard } from './QuestionCard';
import { ResultCard } from './ResultCard';
import { DenialCard } from './DenialCard';
import { ErrorCard } from './ErrorCard';
import { RunSteps, runClock } from './RunSteps';
import type { StepRow } from './StepList';

/**
 * The run cards (Chat P0, D2; CHAT-mockup-v2 `#s-plan`, `#s-need`, `#s-done`,
 * `#s-denied`, `#s-failed`; CHAT-03; CHAT-20 §4c, §6; CHAT-23 G7, G8, P10):
 * each state, "Don't ask again" only where allowed, EXECUTE's one dark pill,
 * the denial's four parts, the question card's picks and keys (CHAT-07), the
 * read-only gate on every approve, answer and send,
 * screen readers hearing the steps, and no motion with reduced motion.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  openUpgrade.mockReset();
  toast.success.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function tree(ui: ReactElement, isLocked: boolean) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <UpgradeDialogContext.Provider
        value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
      >
        {ui}
      </UpgradeDialogContext.Provider>
    </NextIntlClientProvider>
  );
}

async function render(ui: ReactElement, { isLocked = false } = {}) {
  await act(async () => root.render(tree(ui, isLocked)));
}

const $ = <T extends Element = HTMLElement>(selector: string) =>
  container.querySelector<T & HTMLElement>(selector);
const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const action = (id: string) => $<HTMLButtonElement>(`[data-action="${id}"]`);
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => (el as HTMLElement).click());
};
const classOf = (el: Element) => el.getAttribute('class') ?? '';

const PLAN: PlanStep[] = [
  { label: 'Read the 4 tasks', detail: 'Action Center', cls: 'read' },
  { label: 'Change one cited passage', cls: 'write' },
  { label: 'Publish the Webflow draft', cls: 'execute' },
];

const CHANGE = { before: 'Every plan tracks all 7 platforms.', after: 'Starter tracks 2.' };

const step = (n: number, status: ChatStep['status'], label: string, extra = {}): ChatStep => ({
  n,
  kind: 'read',
  status,
  label,
  ...extra,
});

describe('PlanCard', () => {
  it('shows how each step runs in each mode (CHAT-23 P10)', async () => {
    expect(PLAN.map((s) => planStepPill(s.cls, 'auto'))).toEqual(['auto', 'asks', 'click']);
    expect(PLAN.map((s) => planStepPill(s.cls, 'ask_first'))).toEqual(['asks', 'asks', 'click']);
    expect(PLAN.map((s) => planStepPill(s.cls, 'full_auto'))).toEqual(['auto', 'logged', 'click']);

    await render(<PlanCard title="Action Center tasks" steps={PLAN} mode="full_auto" />);
    const pills = $$('[data-slot="approval-pill"]').map((p) => p.dataset.state);
    expect(pills).toEqual(['auto', 'logged', 'click']);
    expect(container.textContent).toContain('Here’s my plan');
    expect(container.textContent).toContain('Mode: Full auto');
    // Steps are numbered, none started.
    expect($$('[data-slot="step-marker"]').map((m) => m.dataset.state)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('lists what the run uses, connects, takes and makes', async () => {
    await render(
      <PlanCard
        title="Plan"
        steps={PLAN}
        mode="auto"
        uses="Action Center · 52 sources"
        connections={[
          { name: 'Webflow', connected: true },
          { name: 'Shopify', connected: false },
        ]}
        time="6 min"
        aiUsage="~2%"
        outputs="FAQ draft"
        onConnect={() => {}}
      />,
    );
    const text = container.textContent!;
    expect(text).toContain('Uses Action Center · 52 sources');
    expect(text).toContain('About 6 min');
    expect(text).toContain('AI usage ~2% of monthly limit');
    expect(text).toContain('Outputs FAQ draft');
    // A missing optional tool's line (agentic plan §6): Connect or Skip, the run does the rest.
    expect(text).toContain('Shopify isn’t connected. I can do everything else without it.');
    expect(action('integrations.connect')!.textContent).toBe('Connect Shopify');
    await click(action('integrations.skip'));
    expect(container.textContent).not.toContain('I can do everything else without it.');
    expect(action('integrations.connect')).toBeNull();
  });

  it('starts with the plan as edited: moved and removed steps', async () => {
    const onStart = vi.fn();
    await render(<PlanCard title="Plan" steps={PLAN} mode="auto" onStart={onStart} />);
    expect(action('plan.moveStepUp')).toBeNull();
    await click(action('plan.edit'));
    expect(action('plan.edit')!.textContent).toBe('Done editing');
    // Move the second step up, then remove the (now) last step.
    await click($$('[data-action="plan.moveStepUp"]')[1]);
    await click($$('[data-action="plan.removeStep"]')[2]);
    await click(action('plan.start'));
    expect(onStart).toHaveBeenCalledWith([PLAN[1], PLAN[0]]);
  });

  it('gives a role that can’t start runs Ask your Admin, and no Edit plan', async () => {
    const onAskAdmin = vi.fn();
    await render(
      <PlanCard title="Plan" steps={PLAN} mode="auto" canStart={false} onAskAdmin={onAskAdmin} />,
    );
    expect(action('plan.start')).toBeNull();
    expect(action('plan.edit')).toBeNull();
    await click(action('access.askAdmin'));
    expect(onAskAdmin).toHaveBeenCalledOnce();
  });

  it('starts nothing while the workspace is read-only: the upgrade dialog opens', async () => {
    const onStart = vi.fn();
    await render(<PlanCard title="Plan" steps={PLAN} mode="auto" onStart={onStart} />, {
      isLocked: true,
    });
    await click(action('plan.start'));
    expect(onStart).not.toHaveBeenCalled();
    expect(openUpgrade).toHaveBeenCalledWith('Starting a run needs a plan');
  });
});

describe('ApprovalCard', () => {
  const write = (props: Partial<Parameters<typeof ApprovalCard>[0]> = {}) => (
    <ApprovalCard
      step={{ n: 4, total: 6 }}
      title="Change a cited passage on /pricing"
      badge="Cited 12× last month"
      why="ChatGPT cites this passage."
      change={CHANGE}
      sources={['Brand fact · Plans', 'Cited page · /pricing']}
      {...props}
    />
  );

  it('shows a WRITE: its step, the change before and after, why and its sources', async () => {
    await render(write());
    const card = $('[data-slot="agent-card"]')!;
    expect(card.dataset.tone).toBe('needsYou');
    expect(card.getAttribute('aria-labelledby')).toBe(card.querySelector('h3')!.id);
    expect(card.textContent).toContain('Step 4 of 6');
    expect(card.textContent).toContain('Cited 12× last month');
    expect(card.textContent).toContain('Before: Every plan tracks all 7 platforms.');
    expect(card.textContent).toContain('After: Starter tracks 2.');
    expect($$('li').map((li) => li.textContent)).toEqual([
      'Brand fact · Plans',
      'Cited page · /pricing',
    ]);
    expect($$('button').map((b) => b.dataset.action)).toEqual([
      'approval.skip',
      'approval.edit',
      'approval.approve',
    ]);
    // A WRITE has no dark pill.
    expect($('[data-slot="approval-pill"][data-state="click"]')).toBeNull();
  });

  it('offers "Don’t ask again" only when the precedence allows it', async () => {
    await render(write());
    expect(action('approval.dontAskAgain')).toBeNull();
    await render(write({ canDontAskAgain: true }));
    expect(action('approval.dontAskAgain')).not.toBeNull();
    expect(container.textContent).toContain('Don’t ask again for this kind of change');
    await render(
      write({ canDontAskAgain: true, dontAskAgainLabel: 'Don’t ask again for CMS drafts' }),
    );
    expect(container.textContent).toContain('Don’t ask again for CMS drafts');
    // Never on an EXECUTE, even if asked.
    await render(write({ kind: 'execute', canDontAskAgain: true, actionLabel: 'Publish' }));
    expect(action('approval.dontAskAgain')).toBeNull();
  });

  it('approves with the tick only when it was offered and ticked', async () => {
    const onApprove = vi.fn();
    await render(write({ canDontAskAgain: true, onApprove }));
    await click(action('approval.approve'));
    expect(onApprove).toHaveBeenLastCalledWith({ dontAskAgain: false });
    await click(action('approval.dontAskAgain'));
    await click(action('approval.approve'));
    expect(onApprove).toHaveBeenLastCalledWith({ dontAskAgain: true });
  });

  it('approves the edited text with Save & approve, and Cancel keeps the proposal', async () => {
    const onApprove = vi.fn();
    await render(write({ onApprove }));
    await click(action('approval.edit'));
    const box = $<HTMLTextAreaElement>('textarea')!;
    expect(box.getAttribute('aria-label')).toBe('New text');
    expect(box.value).toBe('Starter tracks 2.');
    await click(action('approval.cancelEdit'));
    expect($('textarea')).toBeNull();
    await click(action('approval.edit'));
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call($('textarea'), 'Starter tracks ChatGPT and Copilot.');
      $('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(action('approval.saveAndApprove'));
    expect(onApprove).toHaveBeenCalledWith({
      text: 'Starter tracks ChatGPT and Copilot.',
      dontAskAgain: false,
    });
  });

  it('skips without the gate, and says what it is in each state', async () => {
    const onSkip = vi.fn();
    await render(write({ onSkip }), { isLocked: true });
    await click(action('approval.skip'));
    expect(onSkip).toHaveBeenCalledOnce();

    expect(APPROVAL_CARD_STATUSES).toEqual(['pending', 'saving', 'approved', 'skipped', 'error']);
    await render(write({ status: 'saving' }));
    expect(action('approval.approve')!.disabled).toBe(true);
    expect(action('approval.approve')!.getAttribute('aria-busy')).toBe('true');
    expect(action('approval.skip')!.disabled).toBe(true);

    await render(write({ status: 'error', error: 'Webflow didn’t answer.' }));
    expect($('[role="alert"]')!.textContent).toBe('Webflow didn’t answer.');
    expect(action('approval.approve')!.textContent).toBe('Retry');

    await render(write({ status: 'approved', doneLabel: 'cited passage changed' }));
    expect($('[data-slot="done-line"]')!.getAttribute('role')).toBe('status');
    expect($('[data-slot="done-line"]')!.textContent).toBe(
      'Step 4 approved · cited passage changed',
    );
    expect($('button')).toBeNull();

    await render(write({ status: 'skipped' }));
    expect($('[role="status"]')!.textContent).toBe(
      'Step 4 skipped · Change a cited passage on /pricing',
    );
  });

  it('shows an EXECUTE as the one dark "Needs your click" pill and a button naming the effect', async () => {
    const onApprove = vi.fn();
    const onPreview = vi.fn();
    await render(
      <ApprovalCard
        kind="execute"
        step={{ n: 6, total: 6 }}
        title="Publish the Webflow draft for /pricing"
        summary="FAQ block · Webflow draft “Pricing”"
        note="Goes live on getcito.com/pricing · same in every mode"
        actionLabel="Publish"
        busyLabel="Publishing…"
        previewLabel="Preview in Webflow"
        onPreview={onPreview}
        onApprove={onApprove}
      />,
    );
    expect($('[data-slot="agent-card"]')!.dataset.tone).toBe('click');
    const pills = $$('[data-slot="approval-pill"]');
    expect(pills).toHaveLength(1);
    expect(pills[0].dataset.state).toBe('click');
    expect(pills[0].textContent).toBe('Needs your click');
    expect(classOf(pills[0])).toContain('bg-foreground');
    expect(container.textContent).toContain('Step 6 of 6');
    expect(action('exec.publish')!.textContent).toBe('Publish');
    await click(action('exec.preview'));
    expect(onPreview).toHaveBeenCalledOnce();
    await click(action('exec.publish'));
    expect(onApprove).toHaveBeenCalledWith({ dontAskAgain: false });
  });

  it('keeps the click off until it can be made, with the reason, and says Publishing… while it works', async () => {
    const props = {
      kind: 'execute' as const,
      step: { n: 6, total: 6 },
      title: 'Publish',
      actionLabel: 'Publish',
      busyLabel: 'Publishing…',
    };
    await render(<ApprovalCard {...props} disabledReason="After the draft is approved" />);
    expect(action('exec.publish')!.disabled).toBe(true);
    expect(action('exec.publish')!.title).toBe('After the draft is approved');
    expect(container.textContent).toContain('After the draft is approved');
    await render(<ApprovalCard {...props} status="saving" />);
    expect(action('exec.publish')!.textContent).toBe('Publishing…');
    expect(action('exec.publish')!.disabled).toBe(true);
    await render(<ApprovalCard {...props} status="approved" doneLabel="Published · 14:32" />);
    expect($('[data-slot="done-line"]')!.textContent).toBe('Published · 14:32');
  });

  it('approves nothing while the workspace is read-only: the upgrade dialog opens', async () => {
    const onApprove = vi.fn();
    await render(write({ onApprove }), { isLocked: true });
    await click(action('approval.approve'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Approving changes needs a plan');
    await click(action('approval.edit'));
    await click(action('approval.saveAndApprove'));
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    await render(
      <ApprovalCard
        kind="execute"
        step={{ n: 6, total: 6 }}
        title="Publish"
        actionLabel="Publish"
        onApprove={onApprove}
      />,
      { isLocked: true },
    );
    await click(action('exec.publish'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Going live needs a plan');
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe('RunSteps', () => {
  const running = [
    step(1, 'done', 'Read Action Center'),
    step(2, 'running', 'Read Citations', { detail: 'Last 30 days' }),
  ];

  it('is open while it runs, with the step count and the clock, and says each new step', async () => {
    expect(runClock(41_000)).toBe('0:41');
    expect(runClock(72_000)).toBe('1:12');
    await render(<RunSteps status="running" steps={running} workingMs={41_000} />);
    const header = $('button')!;
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.textContent).toContain('Working on it');
    expect(header.textContent).toContain('2 steps · 0:41');
    const live = $('[aria-live]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Step 2: Read Citations');
    expect(document.getElementById(header.getAttribute('aria-controls')!)!.hidden).toBe(false);

    // A new step starts: the same region says it.
    await render(
      <RunSteps
        status="running"
        steps={[
          ...running.slice(0, 1),
          step(2, 'done', 'Read Citations'),
          step(3, 'running', 'Opened /pricing'),
        ]}
        workingMs={52_000}
      />,
    );
    expect($$('[aria-live]')).toHaveLength(1);
    expect($('[aria-live]')!.textContent).toBe('Step 3: Opened /pricing');
    // Waiting on the person is the step it says.
    await render(
      <RunSteps
        status="waiting"
        steps={[step(1, 'done', 'Read'), step(2, 'waiting', 'Change a passage')]}
        workingMs={60_000}
      />,
    );
    expect($('[aria-live]')!.textContent).toBe('Step 2: Change a passage');
  });

  it('folds to "Worked for" once done, and opens on a click', async () => {
    const done = [
      step(1, 'done', 'Thinking · 3s', { kind: 'thinking' }),
      step(2, 'done', 'Read Action Center'),
      step(3, 'done', 'Read Citations'),
    ];
    await render(<RunSteps status="done" steps={done} workingMs={72_000} sources={4} />);
    const header = $('button')!;
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.textContent).toContain('Worked for 1m 12s');
    expect(header.textContent).toContain('3 steps · 4 sources');
    expect($('[aria-live]')!.textContent).toBe('Worked for 1m 12s');
    expect($('[data-slot="step-list"]')!.parentElement!.hidden).toBe(true);
    await click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect($('[data-slot="step-list"]')!.parentElement!.hidden).toBe(false);

    await render(<RunSteps status="done" steps={done} workingMs={41_000} />);
    expect($('button')!.textContent).toContain('Worked for 41s');
    expect($('button')!.textContent).toContain('3 steps');
    expect($('button')!.textContent).not.toContain('sources');
  });

  it('shows a one-step run as that step’s line, and its rows', async () => {
    await render(
      <RunSteps
        status="done"
        steps={[
          step(1, 'done', 'Read Citations', { detail: 'Perplexity · Last 30 days', rowCount: 18 }),
        ]}
        workingMs={4_000}
        sources={1}
      />,
    );
    expect($('button')!.textContent).toContain('Read Citations · Perplexity · Last 30 days');
    expect($('button')!.textContent).toContain('18 rows');
  });

  it('says a stop and an error, and shows nothing without steps', async () => {
    await render(<RunSteps status="stopped" steps={running} workingMs={41_000} />);
    expect($('button')!.textContent).toContain('Stopped after 41s');
    await render(
      <RunSteps
        status="error"
        steps={[step(1, 'error', 'Read Citations', { detail: 'Timed out' })]}
        workingMs={9_000}
      />,
    );
    expect($('button')!.textContent).toContain('Stopped: something went wrong');
    expect($('[data-slot="step-marker"]')!.dataset.state).toBe('failed');
    expect(container.textContent).toContain('Timed out');
    await render(<RunSteps status="done" steps={[]} workingMs={0} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('ResultCard', () => {
  const base = {
    title: 'Done. 4 tasks are ready for you to close.',
    summary: '6 of 6 steps · 2% of monthly AI limit',
    generatedAt: '2026-10-26T11:32:00Z',
    dataAsOf: '2026-10-26T05:00:00Z',
    timeZone: 'Europe/Istanbul',
  };

  it('says when it was made and what data it used, in absolute time with the offset', async () => {
    await render(<ResultCard state="done" {...base} />);
    const head = $('[data-slot="agent-head"]')!;
    expect(head.querySelector('[data-slot="agent-avatar"]')!.getAttribute('data-state')).toBe(
      'done',
    );
    expect(head.textContent).toContain('Generated Oct 26, 2026 · 14:32');
    expect(head.textContent).toContain('Data as of Oct 26, 08:00');
    expect(head.querySelector('[title^="Generated"]')!.getAttribute('title')).toBe(
      'Generated Oct 26, 2026 14:32 GMT+3',
    );
    await render(<ResultCard state="done" {...base} dataAsOf={null} />);
    expect(container.textContent).not.toContain('Data as of');
  });

  it('opens files only at a path in the app', async () => {
    await render(
      <ResultCard
        state="done"
        {...base}
        files={[
          { title: 'FAQ block', href: '/dashboard/content/library' },
          { title: 'Schema' },
          { title: 'Outside', href: 'https://example.com/x' },
          { title: 'Sneaky', href: '/dashboard/../admin' },
        ]}
        primary={{
          label: 'Close tasks',
          href: '/dashboard/action-center',
          action: 'done.closeTasksInActionCenter',
        }}
      />,
    );
    const opens = $$('[data-action="deliverable.open"]');
    expect(opens.map((a) => a.getAttribute('href'))).toEqual(['/dashboard/content/library']);
    expect(opens[0].textContent).toBe('Open');
    expect(action('done.closeTasksInActionCenter')!.getAttribute('href')).toBe(
      '/dashboard/action-center',
    );
  });

  it('shows counts, the steps under "Worked for", and the click that waits above it', async () => {
    await render(
      <ResultCard
        state="needsClick"
        {...base}
        title="Ready to go live. Publishing needs your click."
        run={{
          steps: [step(1, 'done', 'Read'), step(2, 'done', 'Wrote')],
          workingMs: 340_000,
          sources: 4,
        }}
        kpis={[{ label: 'Tasks ready', value: '4', note: 'of 4' }]}
        before={
          <ApprovalCard
            kind="execute"
            step={{ n: 6, total: 6 }}
            title="Publish"
            actionLabel="Publish"
          />
        }
      />,
    );
    expect($('[data-slot="agent-avatar"]')!.dataset.state).toBe('waiting');
    expect(container.textContent).toContain('Tasks ready4of 4');
    expect($('[data-slot="run-steps"] button')!.textContent).toContain('Worked for 5m 40s');
    expect($('[data-slot="run-steps"] button')!.textContent).toContain('2 steps · 4 sources');
    // The click card comes before the result.
    const cards = $$('[data-slot="agent-card"]');
    expect(cards[0].dataset.tone).toBe('click');
  });
});

describe('DenialCard', () => {
  const role = {
    title: 'I can’t add these prompts for you',
    asked: 'Add 5 prompts to Tracked Prompts for GetCito.',
    askedItems: ['best aeo tools', 'aeo vs seo'],
    why: 'Your role is Analyst. Adding prompts needs Manager or Admin.',
    whySource: 'Role rule · Settings › Team › Roles & access',
    whoCan: 'Admins and Managers can do this.',
    nextActions: ['ask_admin', 'see_access'] as const,
  };

  it('answers in four parts: what was asked, why not, who can, what next', async () => {
    await render(
      <DenialCard {...role} nextActions={[...role.nextActions]} onAskAdmin={() => {}} />,
    );
    expect($$('dt').map((dt) => dt.textContent)).toEqual([
      'You asked',
      'Why not',
      'Who can',
      'Next',
    ]);
    expect($('[data-part="asked"]')!.textContent).toBe(
      'Add 5 prompts to Tracked Prompts for GetCito.best aeo toolsaeo vs seo',
    );
    expect($('[data-part="why"]')!.textContent).toBe(
      'Your role is Analyst. Adding prompts needs Manager or Admin.Role rule · Settings › Team › Roles & access',
    );
    expect($('[data-part="who"]')!.textContent).toBe(
      'Admins and Managers can do this.Your request goes to the workspace Admins, in the app',
    );
    const next = [...$('[data-part="next"]')!.children] as HTMLElement[];
    expect(next.map((el) => [el.dataset.action, el.textContent])).toEqual([
      ['access.askAdmin', 'Ask your Admin'],
      ['access.see', 'See your access ↗'],
    ]);
    expect(next[1].getAttribute('href')).toBe('/dashboard/settings/team');
  });

  it('adds what the next plan unlocks for a plan gate, and links plans to Billing', async () => {
    await render(
      <DenialCard
        title="Full auto needs Growth"
        asked="Run /winback in Full auto."
        why="Full auto needs Growth. Your plan: Starter."
        whoCan="Admins can change the plan."
        nextActions={['upgrade', 'compare_plans']}
        extra={{
          label: 'Growth adds',
          items: [{ title: 'Full auto', detail: 'logged and undoable' }],
          note: '$249 a month',
        }}
      />,
    );
    expect($$('dt').map((dt) => dt.textContent)).toEqual([
      'You asked',
      'Why not',
      'Who can',
      'Growth adds',
      'Next',
    ]);
    expect($('[data-part="who"]')!.textContent).toBe('Admins can change the plan.');
    expect(action('plan.upgrade')!.getAttribute('href')).toBe('/dashboard/settings/billing');
    expect(action('plan.compare')!.getAttribute('href')).toBe('/dashboard/settings/billing');
  });

  it('shows See tool policy only once its page has an address', async () => {
    const policy = {
      title: 'Your Admin set this tool to Never',
      asked: 'Send 4 outreach emails.',
      why: 'Your Admin set this tool to Never.',
      whoCan: 'Admins can change the tool policy.',
      nextActions: ['ask_admin', 'open_policy'] as ('ask_admin' | 'open_policy')[],
    };
    await render(<DenialCard {...policy} />);
    expect(action('policy.open')).toBeNull();
    await render(<DenialCard {...policy} hrefs={{ open_policy: '/dashboard/settings/chat' }} />);
    expect(action('policy.open')!.getAttribute('href')).toBe('/dashboard/settings/chat');
  });

  it('sends Ask your Admin once, then says Sent', async () => {
    let resolve!: () => void;
    const onAskAdmin = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    await render(
      <DenialCard {...role} nextActions={[...role.nextActions]} onAskAdmin={onAskAdmin} />,
    );
    await click(action('access.askAdmin'));
    expect(action('access.askAdmin')!.disabled).toBe(true);
    expect(action('access.askAdmin')!.getAttribute('aria-busy')).toBe('true');
    await act(async () => resolve());
    expect(action('access.askAdmin')!.textContent).toBe('Sent');
    expect(action('access.askAdmin')!.disabled).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('Sent to your Admins');
    expect(onAskAdmin).toHaveBeenCalledOnce();
  });

  it('says a request that failed, and sends nothing while read-only', async () => {
    await render(
      <DenialCard
        {...role}
        nextActions={[...role.nextActions]}
        onAskAdmin={() => Promise.reject(new Error('down'))}
      />,
    );
    await click(action('access.askAdmin'));
    expect($('[role="alert"]')!.textContent).toBe('Couldn’t send it. Try again.');
    expect(action('access.askAdmin')!.disabled).toBe(false);

    const onAskAdmin = vi.fn();
    await render(
      <DenialCard {...role} nextActions={[...role.nextActions]} onAskAdmin={onAskAdmin} />,
      {
        isLocked: true,
      },
    );
    await click(action('access.askAdmin'));
    expect(onAskAdmin).not.toHaveBeenCalled();
    expect(openUpgrade).toHaveBeenCalledWith('Sending a request needs a plan');
  });
});

describe('ErrorCard', () => {
  const rows: StepRow[] = [
    { n: 1, label: 'Read 48 products', state: 'done' },
    {
      n: 2,
      label: 'Update 12 titles',
      detail: 'Google Merchant Center isn’t connected',
      state: 'failed',
      pill: 'asks',
    },
    { n: 3, label: 'Push the feed', state: 'pending', pill: 'click' },
  ];

  it('shows the agent in red, where it stopped and why, and Retry from that step', async () => {
    const onRetry = vi.fn();
    await render(
      <ErrorCard
        title="Merchant feed fix · EU"
        reason="Google Merchant Center isn’t connected · nothing was changed"
        steps={rows}
        failedStep={2}
        onRetry={onRetry}
      />,
    );
    const head = $('[data-slot="agent-head"]')!;
    expect(head.querySelector('[data-slot="agent-avatar"]')!.getAttribute('data-state')).toBe(
      'failed',
    );
    expect(head.textContent).toContain('Stopped at step 2 of 3');
    expect(head.textContent).toContain('nothing was changed');
    expect($('[data-slot="agent-card"]')!.dataset.tone).toBe('failed');
    expect($('[data-slot="status-pill"]')!.textContent).toBe('Failed');
    expect($$('[data-slot="step-marker"]').map((m) => m.dataset.state)).toEqual([
      'done',
      'failed',
      'pending',
    ]);
    expect(container.textContent).toContain('Retry starts again from step 2');
    expect(action('run.retryStep')!.textContent).toBe('Retry step 2');
    await click(action('run.retryStep'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('retries the whole run after an error outside a step, and nothing while read-only', async () => {
    const onRetry = vi.fn();
    await render(
      <ErrorCard title="Run" reason="Something went wrong" steps={[]} onRetry={onRetry} />,
      {
        isLocked: true,
      },
    );
    expect($('[data-slot="agent-head"]')!.textContent).toContain('Stopped: something went wrong');
    expect(action('run.retry')!.textContent).toBe('Retry');
    await click(action('run.retry'));
    expect(onRetry).not.toHaveBeenCalled();
    expect(openUpgrade).toHaveBeenCalledWith('Retrying a run needs a plan');
  });
});

describe('QuestionCard', () => {
  const ASK = {
    n: 3,
    question: 'Which page should the FAQ go on?',
    options: [
      { label: '/pricing', detail: 'Cited 18 times for pricing prompts', recommended: true },
      { label: '/features', recommended: false, costMultiplier: 2 },
    ],
    allowOther: true,
    multi: false,
  };
  const key = async (target: Element, k: string) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    });
  };
  const picked = () =>
    $$('[data-action="question.pick"]').map((b) => b.getAttribute('aria-checked'));
  const type = async (value: string) => {
    await act(async () => {
      const input = $<HTMLInputElement>('[data-action="question.other"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('shows the question, its options and Other…, the Recommended one picked, and takes focus', async () => {
    await render(
      <QuestionCard
        ask={{ ...ASK, batch: { at: 1, of: 2 }, then: 'Then the draft' }}
        onAnswer={() => {}}
      />,
    );
    const card = $('[data-slot="question-card"]')!;
    expect(card.dataset.tone).toBe('needsYou');
    expect(document.activeElement).toBe(card);
    expect(card.querySelector('h3')!.textContent).toBe('Which page should the FAQ go on?');
    expect(card.textContent).toContain('1 of 2');
    expect(card.textContent).toContain('Then the draft');
    expect($('[role="radiogroup"]')).not.toBeNull();
    const rows = $$('[data-action="question.pick"]');
    expect(rows.map((r) => r.textContent)).toEqual([
      '1/pricingRecommendedCited 18 times for pricing prompts',
      '2/features2×',
    ]);
    expect(picked()).toEqual(['true', 'false']);
    expect($<HTMLInputElement>('[data-action="question.other"]')!.placeholder).toBe('Other…');
    expect(card.textContent).toContain('Press 1–3 to pick');
    expect(card.textContent).not.toContain('Pick one or more');
    expect($('[data-slot="question-check"]')).toBeNull();
  });

  it('leaves the focus in a field the person is typing in', async () => {
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    field.focus();
    await render(<QuestionCard ask={ASK} onAnswer={() => {}} />);
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it('picks with a click or a number key, and Enter is Next', async () => {
    const onAnswer = vi.fn();
    await render(<QuestionCard ask={ASK} onAnswer={onAnswer} />);
    const card = $('[data-slot="question-card"]')!;
    await key(card, '2');
    expect(picked()).toEqual(['false', 'true']);
    await key(card, '9');
    expect(picked()).toEqual(['false', 'true']);
    await key(card, 'Enter');
    expect(onAnswer).toHaveBeenLastCalledWith({ selected: [1], other: null, skipped: false });
    await click($$('[data-action="question.pick"]')[0]);
    await click(action('question.next'));
    expect(onAnswer).toHaveBeenLastCalledWith({ selected: [0], other: null, skipped: false });
  });

  it('leaves Enter on Skip, Add or an option to that button: only the card’s Enter is Next', async () => {
    const onAnswer = vi.fn();
    await render(<QuestionCard ask={ASK} onAnswer={onAnswer} />);
    for (const id of ['question.skip', 'question.addOther']) await key(action(id)!, 'Enter');
    await key($$('[data-action="question.pick"]')[1], 'Enter');
    expect(onAnswer).not.toHaveBeenCalled();
    await key($('[data-slot="question-card"]')!, 'Enter');
    expect(onAnswer).toHaveBeenCalledOnce();
  });

  it('takes the text in Other… without Add, up to 500 characters', async () => {
    const onAnswer = vi.fn();
    await render(<QuestionCard ask={ASK} onAnswer={onAnswer} />);
    expect($<HTMLInputElement>('[data-action="question.other"]')!.maxLength).toBe(500);
    await type('The blog');
    await click(action('question.next'));
    // One pick only: the text typed is the answer, over the Recommended option.
    expect(onAnswer).toHaveBeenLastCalledWith({ selected: [], other: 'The blog', skipped: false });
    await render(
      <QuestionCard key="multi" ask={{ ...ASK, n: 4, multi: true }} onAnswer={onAnswer} />,
    );
    await type('The blog');
    await click(action('question.next'));
    expect(onAnswer).toHaveBeenLastCalledWith({ selected: [0], other: 'The blog', skipped: false });
  });

  it('leaves keys to the Other… field, and answers with its text', async () => {
    const onAnswer = vi.fn();
    await render(<QuestionCard ask={ASK} onAnswer={onAnswer} />);
    await key($('[data-slot="question-card"]')!, '3');
    const input = $<HTMLInputElement>('[data-action="question.other"]')!;
    expect(document.activeElement).toBe(input);
    expect(action('question.addOther')!.disabled).toBe(true);
    await type('The blog');
    // A number typed in the field stays text; Enter there adds it.
    await key(input, '1');
    expect(picked()).toEqual(['true', 'false']);
    await key(input, 'Enter');
    expect(onAnswer).not.toHaveBeenCalled();
    expect(picked()).toEqual(['false', 'false']);
    await click(action('question.next'));
    expect(onAnswer).toHaveBeenCalledWith({ selected: [], other: 'The blog', skipped: false });
  });

  it('picks several when it may, Next off with none; Skip goes on with the Recommended', async () => {
    const onAnswer = vi.fn();
    await render(
      <QuestionCard ask={{ ...ASK, multi: true, allowOther: false }} onAnswer={onAnswer} />,
    );
    expect($('[role="group"]')).not.toBeNull();
    expect($$('[role="checkbox"]')).toHaveLength(2);
    // Several may be picked, and it says so: a box on each row, "Pick one or more" under them.
    expect($('[data-slot="question-card"]')!.textContent).toContain(
      'Pick one or more · Press 1–2 to pick',
    );
    expect($$('[data-slot="question-check"]')).toHaveLength(2);
    expect($$('[data-slot="question-check"] svg')).toHaveLength(1);
    expect(action('question.other')).toBeNull();
    await click($$('[data-action="question.pick"]')[1]);
    expect(picked()).toEqual(['true', 'true']);
    await click($$('[data-action="question.pick"]')[0]);
    await click($$('[data-action="question.pick"]')[1]);
    expect(action('question.next')!.disabled).toBe(true);
    await click(action('question.skip'));
    expect(onAnswer).toHaveBeenCalledWith({ selected: [], other: null, skipped: true });
  });

  it('answers nothing while the workspace is read-only: the upgrade dialog opens', async () => {
    const onAnswer = vi.fn();
    await render(<QuestionCard ask={ASK} onAnswer={onAnswer} />, { isLocked: true });
    await click(action('question.next'));
    await click(action('question.skip'));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(openUpgrade).toHaveBeenCalledWith('Answering needs a plan');
  });

  it('is busy while saving, with the error under it', async () => {
    await render(<QuestionCard ask={ASK} status="saving" onAnswer={() => {}} />);
    expect(action('question.next')!.disabled).toBe(true);
    expect(action('question.next')!.getAttribute('aria-busy')).toBe('true');
    expect(action('question.skip')!.disabled).toBe(true);
    await render(
      <QuestionCard ask={ASK} status="error" error="Couldn’t send" onAnswer={() => {}} />,
    );
    expect($('[role="alert"]')!.textContent).toBe('Couldn’t send');
  });

  it('folds an answered question to one line: the question and the answer', async () => {
    await render(<QuestionAnswered question="Which page?" answer="Skipped · used /pricing" />);
    const line = $('[data-slot="question-answered"]')!;
    expect(line.textContent).toBe('Which page?Skipped · used /pricing');
  });
});

describe('every card', () => {
  async function renderAll() {
    await render(
      <>
        <PlanCard
          title="Plan"
          steps={PLAN}
          mode="auto"
          connections={[{ name: 'Shopify', connected: false }]}
        />
        <RunSteps status="running" steps={[step(1, 'running', 'Read')]} workingMs={1000} />
        <RunSteps
          status="done"
          steps={[step(1, 'done', 'Read'), step(2, 'done', 'Wrote')]}
          workingMs={1000}
        />
        <ApprovalCard
          step={{ n: 4, total: 6 }}
          title="Change"
          change={CHANGE}
          canDontAskAgain
          status="saving"
        />
        <ApprovalCard step={{ n: 4, total: 6 }} title="Change" status="approved" />
        <ApprovalCard step={{ n: 4, total: 6 }} title="Change" status="error" error="Failed" />
        <ApprovalCard
          kind="execute"
          step={{ n: 6, total: 6 }}
          title="Publish"
          actionLabel="Publish"
        />
        <ResultCard
          state="done"
          title="Done"
          generatedAt="2026-10-26T11:32:00Z"
          kpis={[{ label: 'Tasks', value: '4', note: 'of 4' }]}
        />
        <DenialCard
          title="No"
          asked="Add"
          why="Role"
          whoCan="Admins"
          nextActions={['ask_admin']}
          onAskAdmin={() => {}}
        />
        <ErrorCard
          title="Run"
          reason="Failed"
          steps={[{ n: 1, label: 'Read', state: 'failed' }]}
          failedStep={1}
          retrying
        />
        <QuestionCard
          ask={{
            n: 2,
            question: 'Which page?',
            options: [{ label: '/pricing', recommended: true }, { label: '/features' }],
            allowOther: true,
            multi: false,
          }}
          status="error"
          error="Failed"
          onAnswer={() => {}}
        />
        <QuestionAnswered question="Which page?" answer="/pricing" />
      </>,
    );
  }

  it('stops every motion with reduced motion', async () => {
    await renderAll();
    const moving = $$('[class*="animate-"]');
    expect(moving.length).toBeGreaterThan(10);
    for (const el of moving) expect(classOf(el)).toContain('motion-reduce:animate-none');
    for (const el of $$('[class*="rotate-"], [class*="transition-transform"]')) {
      expect(classOf(el)).toContain('motion-reduce:transition-none');
    }
  });

  it('gives each coloured state its dark-theme colour', async () => {
    await renderAll();
    for (const el of $$('*')) {
      const cls = classOf(el).split(/\s+/);
      for (const hue of ['green', 'amber', 'red']) {
        for (const c of cls.filter((c) => new RegExp(`^(bg|text|border|ring)-${hue}-`).test(c))) {
          const kind = c.slice(0, c.indexOf(`-${hue}-`));
          expect(
            cls.some((d) => d.startsWith(`dark:${kind}-${hue}-`)),
            c,
          ).toBe(true);
        }
      }
    }
  });

  it('gives every control a data-action id', async () => {
    await renderAll();
    const controls = $$('button, a, input, textarea');
    expect(controls.length).toBeGreaterThan(10);
    for (const el of controls) expect(el.dataset.action, el.outerHTML.slice(0, 80)).toBeTruthy();
  });
});
