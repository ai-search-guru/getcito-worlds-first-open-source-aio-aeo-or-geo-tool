import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { AGENT_AVATAR_STATES, AgentAvatar } from './AgentAvatar';
import { STATUS_PILL_STATES, StatusPill } from './StatusPill';
import { APPROVAL_PILL_KINDS, ApprovalPill } from './ApprovalPill';
import { STEP_MARKER_STATES, StepMarker } from './StepMarker';
import { LIST_DOT_STATES, ListDot, ListProgress } from './ListDot';
import { NewPill } from './NewPill';
import { AttentionCount, AttentionDot } from './AttentionBadge';
import { DoneTick } from './DoneTick';

/**
 * Chat's shared agent pieces (Chat agentic plan §2, Chat v2 design polish):
 * each state says what it is to a screen reader, wears its mockup colours in
 * both themes, and stops moving with reduced motion.
 */

function render(ui: ReactElement): HTMLElement {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
  const body = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body;
  return body.firstElementChild as HTMLElement;
}
const root = (ui: ReactElement) => render(ui).firstElementChild as HTMLElement;
const classOf = (el: Element) => el.getAttribute('class') ?? '';

/** Every piece in every state, as the preview page shows them. */
function everyPiece(): ReactElement {
  return (
    <>
      {AGENT_AVATAR_STATES.map((state) => (
        <AgentAvatar key={state} state={state} />
      ))}
      {AGENT_AVATAR_STATES.map((state) => (
        <AgentAvatar key={`muted-${state}`} state={state} tone="muted" />
      ))}
      {STATUS_PILL_STATES.map((state) => (
        <StatusPill key={state} state={state} />
      ))}
      {APPROVAL_PILL_KINDS.map((kind) => (
        <ApprovalPill key={kind} kind={kind} />
      ))}
      {STEP_MARKER_STATES.map((state, i) => (
        <StepMarker key={state} number={i + 1} state={state} />
      ))}
      {LIST_DOT_STATES.map((state) => (
        <ListDot key={state} state={state} />
      ))}
      <ListProgress value={30} />
      <NewPill />
      <AttentionDot needsYou={1} />
      <AttentionCount count={3} needsYou={1} />
      <DoneTick pop />
    </>
  );
}

describe('AgentAvatar', () => {
  it.each([
    ['idle', 'Agent · idle'],
    ['working', 'Agent · working'],
    ['waiting', 'Agent · needs you'],
    ['done', 'Agent · done'],
    ['failed', 'Agent · failed'],
  ] as const)('says %s to a screen reader, in Chat and in the Agents list', (state, label) => {
    for (const tone of ['live', 'muted'] as const) {
      const el = root(<AgentAvatar state={state} tone={tone} />);
      expect(el.getAttribute('role')).toBe('img');
      expect(el.getAttribute('aria-label')).toBe(label);
      expect(el.dataset.state).toBe(state);
      expect(el.dataset.tone).toBe(tone);
    }
  });

  it('is hidden from screen readers when the words beside it say the state', () => {
    const el = root(<AgentAvatar state="working" decorative />);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
  });

  it('works by breathing, bobbing and a sweep: its eyes look around, no spinning ring', () => {
    const el = root(<AgentAvatar state="working" />);
    expect(classOf(el)).toContain('animate-agent-work');
    expect(el.querySelector('[class*="animate-agent-sweep"]')).not.toBeNull();
    expect(el.querySelector('g[class*="animate-agent-look"]')).not.toBeNull();
    expect(el.querySelector('[class*="animate-agent-wait"]')).toBeNull();
    expect(el.outerHTML).not.toMatch(/animate-spin|rotate/);
  });

  it('waits for the person with an amber ring that grows out of it', () => {
    const el = root(<AgentAvatar state="waiting" />);
    const ring = el.querySelector('[class*="animate-agent-wait"]')!;
    expect(classOf(ring)).toContain('border-amber-600/50');
    expect(classOf(ring)).toContain('dark:border-amber-400/50');
    expect(classOf(el)).not.toContain('animate-agent-work');
  });

  it('idles on the dark tile, blinking; turns soft green when done, in both themes', () => {
    const idle = root(<AgentAvatar state="idle" />);
    expect(classOf(idle)).toContain('bg-foreground');
    expect(idle.querySelector('g[class*="animate-agent-blink"]')).not.toBeNull();
    const done = root(<AgentAvatar state="done" />);
    expect(classOf(done)).toContain('bg-green-100');
    expect(classOf(done)).toContain('dark:bg-green-950');
    expect(classOf(done)).not.toContain('bg-foreground');
  });

  it('turns soft red when a step failed, still blinking as the mockup does', () => {
    const el = root(<AgentAvatar state="failed" />);
    expect(classOf(el)).toContain('bg-red-100');
    expect(classOf(el)).toContain('text-red-700');
    expect(classOf(el)).toContain('dark:bg-red-950');
    expect(classOf(el)).not.toContain('bg-foreground');
    expect(el.querySelector('g[class*="animate-agent-blink"]')).not.toBeNull();
    expect(el.querySelector('[class*="animate-agent-wait"]')).toBeNull();
  });

  it('sits still in the Agents list: grey when idle, a fixed amber ring when waiting', () => {
    const idle = root(<AgentAvatar state="idle" tone="muted" />);
    expect(classOf(idle)).toContain('bg-foreground/10');
    expect(classOf(idle)).not.toContain('bg-foreground ');
    const waiting = root(<AgentAvatar state="waiting" tone="muted" />);
    expect(classOf(waiting)).toContain('ring-offset-amber-100');
    expect(classOf(waiting)).toContain('ring-amber-200');
    expect(classOf(waiting)).toContain('bg-foreground');
    expect(waiting.querySelector('[class*="animate-agent-wait"]')).toBeNull();
    for (const state of AGENT_AVATAR_STATES) {
      const el = root(<AgentAvatar state={state} tone="muted" />);
      expect(el.outerHTML).not.toContain('animate-');
      // No spark: the governance mockup's robot has none.
      expect(el.querySelector('[class*="agent-spark"]')).toBeNull();
    }
    // In Chat, idle stays the dark tile.
    const chatIdle = root(<AgentAvatar state="idle" />);
    expect(classOf(chatIdle)).toContain('bg-foreground text-background');
    expect(chatIdle.querySelector('[class*="agent-spark"]')).not.toBeNull();
  });

  it.each([
    ['md', 'size-[30px]'],
    ['sm', 'size-[26px]'],
    ['xs', 'size-[22px]'],
  ] as const)('comes in the %s size of the mockup', (size, cls) => {
    expect(classOf(root(<AgentAvatar size={size} />))).toContain(cls);
  });
});

describe('StatusPill', () => {
  it.each([
    ['working', 'Working', 'border-foreground'],
    ['answering', 'Answering', 'border-foreground'],
    ['needsYou', 'Needs you', 'bg-amber-100'],
    ['done', 'Done', 'bg-green-100'],
    ['answered', 'Answered', 'bg-green-100'],
    ['ready', 'Ready', 'bg-green-100'],
    ['planReady', 'Plan ready', 'text-muted-foreground'],
    ['draft', 'Draft', 'text-muted-foreground'],
    ['failed', 'Failed', 'bg-red-100'],
  ] as const)('shows %s as "%s"', (state, label, tone) => {
    const el = root(<StatusPill state={state} />);
    expect(el.textContent).toBe(label);
    expect(el.dataset.state).toBe(state);
    expect(el.hasAttribute('aria-hidden')).toBe(false);
    expect(classOf(el)).toContain(tone);
  });
});

describe('ApprovalPill', () => {
  it.each([
    ['auto', 'Auto'],
    ['asks', 'Asks you'],
    ['logged', 'Auto · logged'],
    ['click', 'Needs your click'],
    ['done', 'Done'],
  ] as const)('shows %s as "%s"', (kind, label) => {
    const el = root(<ApprovalPill kind={kind} />);
    expect(el.textContent).toBe(label);
    expect(el.dataset.state).toBe(kind);
  });

  it('keeps Needs your click the only dark pill', () => {
    const dark = APPROVAL_PILL_KINDS.filter((kind) =>
      classOf(root(<ApprovalPill kind={kind} />)).includes('bg-foreground'),
    );
    expect(dark).toEqual(['click']);
  });

  it('says why in a tooltip for Auto · logged and Needs your click, and dots the logged one', () => {
    expect(root(<ApprovalPill kind="logged" />).title).toBe(
      'Runs without a card in Full auto. Logged in the Activity log, with Undo.',
    );
    expect(root(<ApprovalPill kind="click" />).title).toBe(
      'Goes live or leaves the workspace. Always needs your click, in every mode.',
    );
    expect(root(<ApprovalPill kind="auto" />).hasAttribute('title')).toBe(false);
    expect(root(<ApprovalPill kind="logged" />).querySelector('[aria-hidden]')).not.toBeNull();
    expect(root(<ApprovalPill kind="auto" />).querySelector('[aria-hidden]')).toBeNull();
  });
});

describe('StepMarker', () => {
  it.each([
    ['pending', 'Step 2 · Not started', '2'],
    ['current', 'Step 2 · Running', '2'],
    ['waiting', 'Step 2 · Needs you', '2'],
    ['failed', 'Step 2 · Failed', '!'],
    ['done', 'Step 2 · Done', ''],
  ] as const)('says %s with the step to a screen reader', (state, label, text) => {
    const el = root(<StepMarker number={2} state={state} />);
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe(label);
    expect(el.textContent).toBe(text);
  });

  it('ticks a done step, and pulses only the one under way', () => {
    expect(root(<StepMarker number={1} state="done" />).querySelector('svg path')).not.toBeNull();
    const pulsing = STEP_MARKER_STATES.filter((state) =>
      classOf(root(<StepMarker number={1} state={state} />)).includes('animate-agent-step'),
    );
    expect(pulsing).toEqual(['current']);
  });
});

describe('ListDot', () => {
  it.each([
    ['running', 'Running'],
    ['needsYou', 'Needs you'],
    ['done', 'Done'],
    ['failed', 'Stopped or failed'],
    ['idle', 'Idle'],
    ['paused', 'Paused'],
  ] as const)('says %s to a screen reader and in its tooltip', (state, label) => {
    const el = root(<ListDot state={state} />);
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe(label);
    expect(el.title).toBe(label);
  });

  it('rings while running, nudges when it needs you and ticks when done', () => {
    const running = root(<ListDot state="running" />);
    expect(running.querySelector('[class*="animate-agent-dot-ring"]')).not.toBeNull();
    expect(classOf(root(<ListDot state="needsYou" />))).toContain('animate-agent-nudge');
    expect(root(<ListDot state="done" />).querySelector('svg')).not.toBeNull();
    expect(root(<ListDot state="idle" />).querySelector('[class*="animate-"]')).toBeNull();
  });

  it('is hidden from screen readers next to its own words', () => {
    const el = root(<ListDot state="running" decorative />);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('title')).toBe(false);
  });

  it('draws progress as a bar a screen reader reads, kept between 0 and 100', () => {
    const bar = root(<ListProgress value={30} />);
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('Progress');
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('30%');
    expect(root(<ListProgress value={140} />).getAttribute('aria-valuenow')).toBe('100');
    expect(root(<ListProgress value={-3} />).getAttribute('aria-valuenow')).toBe('0');
  });
});

describe('NewPill', () => {
  it('reads "New" in an outlined grey pill', () => {
    const el = root(<NewPill />);
    expect(el.textContent).toBe('New');
    expect(classOf(el)).toContain('border');
    expect(classOf(el)).toContain('rounded-full');
  });
});

describe('the attention badge', () => {
  it('dots a menu icon while something needs the person, and says how many', () => {
    expect(render(<AttentionDot needsYou={0} />).innerHTML).toBe('');
    expect(root(<AttentionDot needsYou={1} />).getAttribute('aria-label')).toBe('1 needs you');
    expect(root(<AttentionDot needsYou={2} />).getAttribute('aria-label')).toBe('2 need you');
  });

  it('counts Home, with an amber dot first while any of it needs the person', () => {
    expect(render(<AttentionCount count={0} />).innerHTML).toBe('');
    const needs = root(<AttentionCount count={3} needsYou={1} />);
    expect(needs.getAttribute('role')).toBe('img');
    expect(needs.getAttribute('aria-label')).toBe('3 items · 1 needs you');
    expect(needs.textContent).toBe('3');
    expect(needs.querySelector('[class*="bg-amber-600"]')).not.toBeNull();
    const calm = root(<AttentionCount count={1} />);
    expect(calm.getAttribute('aria-label')).toBe('1 item');
    expect(calm.querySelector('[class*="bg-amber-600"]')).toBeNull();
  });
});

describe('DoneTick', () => {
  it('says Done, and pops in only when asked', () => {
    const el = root(<DoneTick />);
    expect(el.getAttribute('aria-label')).toBe('Done');
    expect(classOf(el)).not.toContain('animate-agent-tick');
    expect(classOf(root(<DoneTick pop />))).toContain('animate-agent-tick');
    expect(root(<DoneTick decorative />).getAttribute('aria-hidden')).toBe('true');
  });
});

describe('every piece', () => {
  it('stops every motion with reduced motion', () => {
    const all = render(everyPiece());
    const moving = [...all.querySelectorAll('[class*="animate-"]')];
    expect(moving.length).toBeGreaterThan(10);
    for (const el of moving) expect(classOf(el)).toContain('motion-reduce:animate-none');
    const sliding = [...all.querySelectorAll('[class*="transition"]')];
    for (const el of sliding) expect(classOf(el)).toContain('motion-reduce:transition-none');
  });

  it('gives each coloured state its dark-theme colour', () => {
    const all = render(everyPiece());
    for (const el of [all, ...all.querySelectorAll('*')]) {
      const cls = classOf(el).split(/\s+/);
      for (const hue of ['green', 'amber', 'red']) {
        const light = cls.filter((c) =>
          new RegExp(`^(bg|text|border|ring|ring-offset)-${hue}-`).test(c),
        );
        for (const c of light) {
          const kind = c.slice(0, c.indexOf(`-${hue}-`));
          expect(cls.some((d) => d.startsWith(`dark:${kind}-${hue}-`))).toBe(true);
        }
      }
    }
  });

  it('only moves with an animation globals.css defines', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
    const used = new Set(
      [...render(everyPiece()).querySelectorAll('[class*="animate-agent"]')].flatMap((el) =>
        classOf(el)
          .split(/\s+/)
          .filter((c) => c.startsWith('animate-agent-')),
      ),
    );
    expect(used.size).toBeGreaterThan(5);
    for (const cls of used) expect(css).toContain(`--${cls}:`);
  });

  it('has nothing clickable: the pieces are shown, not pressed', () => {
    const all = render(everyPiece());
    expect(all.querySelectorAll('button, a, [role="button"], [tabindex]')).toHaveLength(0);
  });
});
