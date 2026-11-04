import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import type { ChatMode } from '@/lib/chat/precedence';
import { composerKeyAction } from './composerKeys';

/**
 * Chat's composer (W1-10, CHAT-02): send, Stop and steering, the run mode
 * with Full auto's plan lock, and the read-only composer of Analysts and
 * Agency partners.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => router,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));
const requestAccess = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/chatAccessRequests', () => ({ requestAccess }));

const { ChatComposer } = await import('./ChatComposer');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const handlers = {
  onSend: vi.fn(),
  onStop: vi.fn(),
  onSteer: vi.fn(),
  onModeChange: vi.fn(),
};

async function render(
  props: Partial<Parameters<typeof ChatComposer>[0]> = {},
  role: TeamRole = 'admin',
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <ChatComposer
            mode={'auto' as ChatMode}
            fullAutoOpen
            onSend={handlers.onSend}
            onModeChange={handlers.onModeChange}
            {...props}
          />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const box = () => container.querySelector('textarea')!;
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const radios = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const under = () => container.lastElementChild!.lastElementChild!.textContent;

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(box(), value);
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

beforeEach(() => {
  Object.values(handlers).forEach((fn) => fn.mockReset());
  toast.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('composerKeyAction', () => {
  const key = (over: Partial<Parameters<typeof composerKeyAction>[0]>) =>
    composerKeyAction({
      key: 'Enter',
      shiftKey: false,
      composing: false,
      coarse: false,
      running: false,
      hasText: true,
      canSteer: true,
      ...over,
    });

  it('sends on Enter, and leaves Shift+Enter, an input method’s Enter and a touch screen’s to the box', () => {
    expect(key({})).toBe('send');
    expect(key({ shiftKey: true })).toBeNull();
    expect(key({ composing: true })).toBeNull();
    expect(key({ coarse: true })).toBeNull();
    expect(key({ hasText: false })).toBe('block');
    expect(key({ key: 'a' })).toBeNull();
  });

  it('steers on Enter while a run answers, and stops it on Esc', () => {
    expect(key({ running: true })).toBe('steer');
    expect(key({ running: true, canSteer: false })).toBe('block');
    expect(key({ key: 'Escape', running: true })).toBe('stop');
    expect(key({ key: 'Escape' })).toBeNull();
    // A run waiting on a question: Enter answers, Esc stops it.
    expect(key({ stoppable: true })).toBe('send');
    expect(key({ key: 'Escape', stoppable: true })).toBe('stop');
  });

  it('takes a ghost suggestion in on Tab only in an empty box', () => {
    expect(key({ key: 'Tab', ghost: true, hasText: false })).toBe('accept');
    expect(key({ key: 'Tab', ghost: true, hasText: true })).toBeNull();
    expect(key({ key: 'Tab', ghost: true, hasText: false, shiftKey: true })).toBeNull();
    expect(key({ key: 'Tab', hasText: false })).toBeNull();
    // Only the ghost shows: Enter sends nothing.
    expect(key({ ghost: true, hasText: false })).toBe('block');
  });
});

describe('ChatComposer', () => {
  it('sends the text on Enter and clears the box; Shift+Enter and an empty box send nothing', async () => {
    await render();
    expect(button('Send')!.disabled).toBe(true);
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();

    await type('  Why did our citations drop?  ');
    expect(button('Send')!.disabled).toBe(false);
    await press('Enter', { shiftKey: true });
    expect(handlers.onSend).not.toHaveBeenCalled();
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Why did our citations drop?', {
      context: [],
      references: [],
      attachments: [],
    });
    expect(box().value).toBe('');
  });

  it('puts the text back when the send is refused', async () => {
    handlers.onSend.mockResolvedValue(false);
    await render();
    await type('Open Citations');
    await act(async () => button('Send')!.click());
    expect(box().value).toBe('Open Citations');
  });

  it('turns Send into Stop while a run answers, and steers with what is typed', async () => {
    await render({ running: true, onStop: handlers.onStop, onSteer: handlers.onSteer });
    expect(button('Send')).toBeNull();
    expect(box().placeholder).toBe('Steer while I work: “only blog pages”…');
    expect(under()).toContain('Answering · Esc to stop');

    await act(async () => button('Stop')!.click());
    await press('Escape');
    expect(handlers.onStop).toHaveBeenCalledTimes(2);

    await type('only blog pages');
    expect(under()).toContain('Enter stops this run and sends your message');
    await press('Enter');
    expect(handlers.onSteer).toHaveBeenCalledExactlyOnceWith('only blog pages', {
      context: [],
      references: [],
      attachments: [],
    });
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('answers a question with Send, Stop beside it and Esc, up to the answer’s length', async () => {
    await render({ answering: true, maxLength: 500, onStop: handlers.onStop });
    expect(under()).toContain("Your message answers Chat's question · Esc stops the run");
    expect(box().maxLength).toBe(500);
    await act(async () => button('Stop')!.click());
    await press('Escape');
    expect(handlers.onStop).toHaveBeenCalledTimes(2);
    await type('The blog');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledWith('The blog', expect.anything());
    expect(button('Send')).not.toBeNull();
  });

  it('waits for the run on Enter when the page doesn’t steer', async () => {
    await render({ running: true, onStop: handlers.onStop });
    await type('only blog pages');
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(box().value).toBe('only blog pages');
  });

  it('switches the run mode, saying what it does, and locks Full auto below Growth', async () => {
    await render({ fullAutoOpen: false });
    expect(radios().map((r) => r.textContent)).toEqual([
      'Ask me first',
      'Auto, ask before changes',
      'Full autoNeeds Growth',
    ]);
    expect(radios()[1].getAttribute('aria-checked')).toBe('true');

    const fullAuto = radios()[2];
    expect(fullAuto.getAttribute('aria-disabled')).toBe('true');
    await act(async () => fullAuto.click());
    expect(handlers.onModeChange).not.toHaveBeenCalled();

    await act(async () => radios()[0].click());
    expect(handlers.onModeChange).toHaveBeenCalledExactlyOnceWith('ask_first');
    expect(toast).toHaveBeenCalledWith('Ask me first: the agent asks before every step.');
  });

  it('opens Full auto on Growth, with its toast', async () => {
    await render({ fullAutoOpen: true });
    await act(async () => radios()[2].click());
    expect(handlers.onModeChange).toHaveBeenCalledWith('full_auto');
    expect(toast).toHaveBeenCalledWith(
      'Full auto: the agent makes changes without asking. Nothing is published or sent without your click. Every change is in the Activity log.',
    );
  });

  it('reads only for an Analyst or an Agency partner: no mode, a link to what they can do', async () => {
    for (const [role, name] of [
      ['analyst', 'Analyst'],
      ['agency_partner', 'Agency partner'],
    ] as const) {
      await render({}, role);
      expect(radios()).toHaveLength(0);
      const link = container.querySelector('a')!;
      expect(link.textContent).toBe(`Read-only · ${name}`);
      expect(link.getAttribute('href')).toBe('/dashboard/chat/capabilities');
      expect(under()).toContain('@ data · read-only');
    }
    // A manager changes things: the mode is there.
    await render({}, 'manager');
    expect(radios()).toHaveLength(3);
  });

  it('starts Chat home’s box at two rows, the others at one', async () => {
    await render({ variant: 'home' });
    expect(box().rows).toBe(2);
    await render({ variant: 'panel' });
    expect(box().rows).toBe(1);
  });

  it('shows the model on Auto in the line under the box', async () => {
    await render();
    expect(under()).toContain('Auto · Haiku reads, Sonnet writes');
  });
});

describe('ChatComposer: a pasted API key (W4-05)', () => {
  const KEY = `sk-proj-${'Xy9_'.repeat(12)}`;
  const keyLine = () => container.querySelector('[data-slot="composer-key-paste"]');
  const action = (name: string) =>
    container.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);

  it('never sends text that holds a key: the line says why, and Remove takes the key out', async () => {
    await render();
    await type(`Use my OpenAI key ${KEY}`);
    expect(keyLine()?.textContent).toContain(
      'This looks like an API key. Save it securely instead of sending it?',
    );
    expect(button('Send')!.disabled).toBe(true);
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();
    // Save securely waits for the page's key form.
    expect(action('composer.saveKey')).toBeNull();

    await act(async () => action('composer.removeKey')!.click());
    expect(box().value).toBe('Use my OpenAI key');
    expect(keyLine()).toBeNull();
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Use my OpenAI key', expect.anything());
  });

  it('steers no key into a running run either', async () => {
    await render({ running: true, onSteer: handlers.onSteer, onStop: handlers.onStop });
    await type(KEY);
    await press('Enter');
    expect(handlers.onSteer).not.toHaveBeenCalled();
    expect(handlers.onStop).not.toHaveBeenCalled();
    expect(keyLine()).not.toBeNull();
  });

  it('hands the text to the page’s key form on Save securely, where the page offers it', async () => {
    const onSaveKey = vi.fn();
    await render({ onSaveKey });
    await type(`key ${KEY}`);
    await act(async () => action('composer.saveKey')!.click());
    expect(onSaveKey).toHaveBeenCalledExactlyOnceWith(`key ${KEY}`);
    expect(handlers.onSend).not.toHaveBeenCalled();
  });
});

describe('ChatComposer: context chips and the ghost suggestion (W1-11)', () => {
  const chips = [
    { key: 'brand', label: 'GetCito' },
    { key: 'range', label: 'Last 30 days' },
    { key: 'prompt', label: 'Best AI search visibility tools for small agencies' },
  ];
  const ghost = 'Why did our Perplexity citations drop this week?';
  const chipTexts = () =>
    [...container.querySelectorAll('[data-action="composer.removeChip"]')].map(
      (b) => b.parentElement!.textContent,
    );

  it('shows the chips by name, cuts a long one with the whole name in its tooltip, and sends them', async () => {
    const onRemoveChip = vi.fn();
    await render({ chips, onRemoveChip });
    expect(chipTexts()).toEqual(['GetCito×', 'Last 30 days×', 'Best AI search visibility t…×']);
    const long = container.querySelectorAll('[data-action="composer.removeChip"]')[2];
    expect(long.parentElement!.getAttribute('title')).toBe(chips[2].label);
    expect(long.getAttribute('aria-label')).toBe(`Remove ${chips[2].label}`);
    await act(async () => (long as HTMLButtonElement).click());
    expect(onRemoveChip).toHaveBeenCalledExactlyOnceWith('prompt');

    await type('What changed?');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('What changed?', {
      context: chips,
      references: [],
      attachments: [],
    });
  });

  it('takes a page’s hand-off once: a question in the box, unsent, or an object as an @ chip (W1-08)', async () => {
    const chart = { type: 'chart' as const, id: 'mentions-trend', label: 'Mentions over time' };
    await render({ draft: { nonce: 1, text: 'Turn this page into actions' } });
    expect(box().value).toBe('Turn this page into actions');
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box());

    await render({ draft: { nonce: 2, reference: chart } });
    expect(chipTexts()).toEqual(['Mentions over time×']);
    // The same hand-off again is not taken twice.
    await render({ draft: { nonce: 2, reference: chart } });
    await render({ draft: { nonce: 3, reference: chart } });
    expect(chipTexts()).toEqual(['Mentions over time×']);

    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Turn this page into actions', {
      context: [],
      references: [chart],
      attachments: [],
    });
  });

  it('keeps the focus in the composer when a chip is removed from the keyboard', async () => {
    let shownChips = chips;
    const onRemoveChip = vi.fn((key: string) => {
      shownChips = shownChips.filter((c) => c.key !== key);
    });
    await render({ chips, onRemoveChip });
    const remove = container.querySelectorAll<HTMLButtonElement>(
      '[data-action="composer.removeChip"]',
    )[0];
    remove.focus();
    expect(document.activeElement).toBe(remove);
    await act(async () => remove.click());
    expect(onRemoveChip).toHaveBeenCalledExactlyOnceWith('brand');
    await render({ chips: shownChips, onRemoveChip });
    expect(document.activeElement).toBe(box());
  });

  it('shows one ghost suggestion in the empty box; Tab makes it the text, and nothing sends by itself', async () => {
    await render({ ghost });
    const shown = () => container.querySelector('[data-action="composer.acceptGhost"]');
    expect(shown()!.textContent).toBe(`${ghost}Tab`);
    expect(under()).toContain('Tab to accept · / skills · @ data');
    expect(button('Send')!.disabled).toBe(true);
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();

    await press('Tab');
    expect(box().value).toBe(ghost);
    expect(shown()).toBeNull();
    expect(handlers.onSend).not.toHaveBeenCalled();
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith(ghost, {
      context: [],
      references: [],
      attachments: [],
    });
  });

  it('gives way to typing, comes back on an empty box, and fills the box on a click', async () => {
    await render({ ghost });
    const shown = () =>
      container.querySelector<HTMLElement>('[data-action="composer.acceptGhost"]');
    await type('O');
    expect(shown()).toBeNull();
    expect(box().value).toBe('O');
    await type('');
    expect(shown()).not.toBeNull();
    await act(async () => shown()!.click());
    expect(box().value).toBe(ghost);
  });

  it('shows no ghost while a run answers', async () => {
    await render({ ghost, running: true, onStop: handlers.onStop });
    expect(container.querySelector('[data-action="composer.acceptGhost"]')).toBeNull();
    expect(box().placeholder).toBe('Steer while I work: “only blog pages”…');
  });
});

describe('ChatComposer: the / @ ＋ menus (W1-12)', () => {
  // A row's words, without its mark (aria-hidden).
  const options = () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].map((o) => {
      const copy = o.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden]').forEach((mark) => mark.remove());
      return copy.textContent;
    });
  const listbox = () => container.querySelector('[role="listbox"]');
  // CHAT-08's shortcuts, as the / menu lists them (W2-09).
  const ALL_SHORTCUTS = [
    '/startGet started',
    '/analyzeAnalyze',
    '/new-reportReports',
    '/createCreate content',
    '/optimizeOptimize content',
    '/opportunitiesFind opportunities',
    '/auditImprove with audit',
  ];

  it('lists the shortcuts on "/" first in an empty box, filters them, and fills the starter on Enter', async () => {
    await render();
    await type('/');
    expect(listbox()!.getAttribute('aria-label')).toBe('Skills and shortcuts');
    expect(options()).toEqual(ALL_SHORTCUTS);

    await type('/re');
    expect(options()).toEqual(['/new-reportReports']);
    await press('Enter');
    expect(box().value).toBe('Create a report on ');
    expect(listbox()).toBeNull();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('moves with the arrows, closes on Esc keeping the text, and opens on "/" only first', async () => {
    await render();
    await type('/');
    await press('ArrowDown');
    expect(container.querySelector('[aria-selected="true"]')!.textContent).toBe('/analyzeAnalyze');
    await press('ArrowUp');
    await press('ArrowUp');
    expect(container.querySelector('[aria-selected="true"]')!.textContent).toBe(
      '/auditImprove with audit',
    );
    await press('Escape');
    expect(listbox()).toBeNull();
    expect(box().value).toBe('/');

    await type('Compare a/b');
    expect(listbox()).toBeNull();
    await type('/zz');
    expect(container.textContent).toContain('No shortcuts match');
  });

  it('opens the shortcuts from the / button, the text kept after the starter', async () => {
    await render();
    await type('our pricing page');
    await act(async () => button('Skills and shortcuts')!.click());
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')][1].click(),
    );
    expect(box().value).toBe('Analyze our pricing page');
  });

  it('sends the picked shortcut with its message while the trigger words stay', async () => {
    await render();
    await type('/an');
    await press('Enter');
    await type('Analyze our citations on Perplexity');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Analyze our citations on Perplexity', {
      context: [],
      references: [],
      attachments: [],
      shortcutId: 'analyze',
    });

    // Picked from the / button, the text after the words: the shortcut's too.
    handlers.onSend.mockReset();
    await type('Q3 share of voice');
    await act(async () => button('Skills and shortcuts')!.click());
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')][2].click(),
    );
    expect(box().value).toBe('Create a report on Q3 share of voice');
    await press('Enter');
    expect(handlers.onSend.mock.calls[0][1]).toMatchObject({ shortcutId: 'new-report' });
  });

  it('drops the shortcut once its trigger words are rewritten, and keeps it on a refused send', async () => {
    await render();
    await type('/an');
    await press('Enter');
    await type('Why did our citations drop?');
    await press('Enter');
    expect(handlers.onSend.mock.calls[0][1]).not.toHaveProperty('shortcutId');

    // Typed back, it doesn't come back: the person wrote it.
    handlers.onSend.mockReset();
    await type('Analyze our citations');
    await press('Enter');
    expect(handlers.onSend.mock.calls[0][1]).not.toHaveProperty('shortcutId');

    // A refused send puts the text back with its shortcut.
    handlers.onSend.mockReset();
    handlers.onSend.mockResolvedValueOnce(false);
    await type('/au');
    await press('Enter');
    await type('Run an audit on our pricing page');
    await press('Enter');
    expect(box().value).toBe('Run an audit on our pricing page');
    await press('Enter');
    expect(handlers.onSend.mock.calls.map((call) => call[1].shortcutId)).toEqual([
      'audit',
      'audit',
    ]);
  });

  it('gives Analysts and Agency partners no shortcuts', async () => {
    await render({}, 'analyst');
    expect(button('Skills and shortcuts')).toBeNull();
    await type('/');
    expect(listbox()).toBeNull();
  });

  // The enabled skills (W2-04, CHAT-13 item 5), as the page passes them.
  const SKILLS = [
    { name: 'faq', title: 'FAQ from fan-outs' },
    { name: 'report', title: 'Weekly report' },
    { name: 'compare', title: 'Comparison page' },
  ];

  it("lists the skills under Skills after the shortcuts, filters both, and puts a skill's /command first", async () => {
    await render({ skills: SKILLS });
    await type('/');
    // Reports is /new-report: /report is the Weekly report skill's.
    expect(options()).toEqual([
      ...ALL_SHORTCUTS,
      '/faqFAQ from fan-outs',
      '/reportWeekly report',
      '/compareComparison page',
    ]);
    expect(container.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Skills');

    await type('/fa');
    expect(options()).toEqual(['/faqFAQ from fan-outs']);
    await press('Enter');
    expect(box().value).toBe('/faq ');
    expect(listbox()).toBeNull();
    expect(handlers.onSend).not.toHaveBeenCalled();
    // A skill's message carries no shortcut.
    await type('/faq Our pricing page');
    await press('Enter');
    expect(handlers.onSend.mock.calls[0][1]).not.toHaveProperty('shortcutId');
  });

  it('reaches the skills with the arrows, keeps the text after one picked from the / button, and says when none match', async () => {
    await render({ skills: SKILLS });
    await type('our pricing page');
    await act(async () => button('Skills and shortcuts')!.click());
    await press('ArrowUp');
    expect(container.querySelector('[aria-selected="true"]')!.textContent).toBe(
      '/compareComparison page',
    );
    await press('Enter');
    expect(box().value).toBe('/compare our pricing page');

    await type('/zz');
    expect(container.textContent).toContain('No shortcuts or skills match');
  });

  it('shows no Skills group without skills: the new Chat off', async () => {
    await render();
    await type('/');
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(options()).toHaveLength(ALL_SHORTCUTS.length);
  });

  it('references data on "@": the page’s own first, then the brand’s matches; the pick is a chip that goes with the message', async () => {
    const searchReferences = vi.fn(async () => [
      { type: 'prompt' as const, id: 'p1', label: 'Best AEO tools' },
      { type: 'page' as const, id: 'https://getcito.com/pricing', label: 'getcito.com/pricing' },
    ]);
    const chart = {
      type: 'chart' as const,
      id: 'visibility-by-platform',
      label: 'Visibility by platform',
      scope: { range: '30d' },
    };
    await render({ references: [chart], searchReferences });
    await type('Explain @');
    expect(listbox()!.getAttribute('aria-label')).toBe('Reference your data');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(searchReferences).toHaveBeenCalledWith('');
    expect(options()).toEqual([
      'Visibility by platformChart',
      'Best AEO toolsPrompt',
      'getcito.com/pricingPage',
    ]);
    // No ID anywhere on screen.
    expect(container.textContent).not.toContain('visibility-by-platform');
    expect(container.textContent).not.toContain('p1');

    await press('Enter');
    expect(box().value).toBe('Explain ');
    const chips = [...container.querySelectorAll('[data-action="composer.removeChip"]')];
    expect(chips.map((c) => c.parentElement!.textContent)).toEqual(['Visibility by platform×']);

    await type('Explain this');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Explain this', {
      context: [],
      references: [chart],
      attachments: [],
    });
    expect(container.querySelector('[data-action="composer.removeChip"]')).toBeNull();
  });

  it('opens @ from its button at the cursor, filters as you type, and takes a reference off with ×', async () => {
    await render({
      references: [
        { type: 'chart', id: 'c1', label: 'Visibility by platform' },
        { type: 'metric', id: 'm1', label: 'Share of voice' },
      ],
    });
    await type('Why');
    await act(async () => button('Reference a chart, metric, page or task')!.click());
    expect(box().value).toBe('Why @');
    await type('Why @share');
    expect(options()).toEqual(['Share of voiceMetric']);
    await press('Enter');
    const remove = container.querySelector<HTMLButtonElement>(
      '[data-action="composer.removeChip"]',
    )!;
    expect(remove.getAttribute('aria-label')).toBe('Remove Share of voice');
    await act(async () => remove.click());
    expect(container.querySelector('[data-action="composer.removeChip"]')).toBeNull();
  });

  it('attaches files and connects a tool from ＋ for an Admin', async () => {
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    await render({ uploader: { upload: vi.fn(), remove: vi.fn() } });
    await act(async () => button('Attach, read a page or connect a tool')!.click());
    expect(options()).toEqual([
      'Attach filesUp to 5 files, 10 MB each',
      'Connect a toolAdmins connect · others ask an Admin',
    ]);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="plusMenu.attachFiles"]')!.click(),
    );
    expect(pick).toHaveBeenCalledOnce();
    pick.mockRestore();

    await act(async () => button('Attach, read a page or connect a tool')!.click());
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="plusMenu.connectTool"]')!.click(),
    );
    expect(router.push).toHaveBeenCalledWith('/dashboard/settings/integrations');
  });

  it('lets other members ask an Admin to connect, in one click', async () => {
    requestAccess.mockResolvedValue({ ok: true });
    await render({}, 'manager');
    await act(async () => button('Attach, read a page or connect a tool')!.click());
    // No Attach files without the page's upload (W1-13).
    expect(options()).toEqual(['Ask your Admin to connectAdmins connect · others ask an Admin']);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="plusMenu.connectTool"]')!.click(),
    );
    expect(requestAccess).toHaveBeenCalledWith({
      asked: 'Connect a tool so Chat can use it',
      ruleKind: 'role',
    });
    expect(toast.success).toHaveBeenCalledWith('Sent to your Admins');
  });
});

describe("ChatComposer: a menu's side and height (W2-04)", () => {
  // The page's scrolling area, under a 53px header, in a 1024×768 window (jsdom's height).
  const SCROLLER = { top: 53, bottom: 768 };
  const SKILLS = Array.from({ length: 14 }, (_, i) => ({
    name: `skill-${i}`,
    title: `Skill ${i}`,
  }));
  const listbox = () => container.querySelector<HTMLElement>('[role="listbox"]')!;

  /** The composer's box at `box`, and the menu's rows `content` px tall. */
  function layout(box: { top: number; bottom: number }, content = 500) {
    container.style.overflowY = 'auto';
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(content);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const isBox = [...this.children].some((child) => child.getAttribute('role') === 'listbox');
      const r = this === container ? SCROLLER : isBox ? box : { top: 0, bottom: 0 };
      return {
        ...r,
        left: 0,
        right: 0,
        x: 0,
        y: r.top,
        width: 0,
        height: r.bottom - r.top,
      } as DOMRect;
    });
  }
  afterEach(() => vi.restoreAllMocks());

  it("opens below when the room above the box (under the header, not the window's top) can't hold it", async () => {
    // Chat Home: the box 210px under the header.
    layout({ top: 263, bottom: 363 });
    await render({ skills: SKILLS });
    await type('/');
    expect(listbox().dataset.side).toBe('below');
    expect(listbox().className).toContain('top-full');
    expect(listbox().className).not.toContain('bottom-full');
    expect(listbox().style.maxHeight).toBe('300px');
  });

  it('opens above when its rows fit there, as in a chat and the side panel', async () => {
    layout({ top: 600, bottom: 700 });
    await render({ skills: SKILLS });
    await type('/');
    expect(listbox().dataset.side).toBe('above');
    expect(listbox().className).toContain('bottom-full');
    expect(listbox().style.maxHeight).toBe('300px');

    // A short menu fits above Chat Home's box too.
    act(() => root.unmount());
    root = createRoot(container);
    layout({ top: 263, bottom: 363 }, 120);
    await render();
    await type('/');
    expect(listbox().dataset.side).toBe('above');
  });

  it('keeps to the room it has: above when there is less below, as tall as the room less the gap', async () => {
    // 147px above the box, 68px below it.
    layout({ top: 200, bottom: 700 });
    await render({ skills: SKILLS });
    await type('/');
    expect(listbox().dataset.side).toBe('above');
    expect(listbox().style.maxHeight).toBe(`${200 - 53 - 8}px`);
  });

  it('picks its side again when the window changes size, and keeps the active row in view', async () => {
    const box = { top: 263, bottom: 363 };
    layout(box);
    const scrolled = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrolled,
      configurable: true,
    });
    try {
      await render({ skills: SKILLS });
      await type('/');
      expect(listbox().dataset.side).toBe('below');
      box.top = 600;
      box.bottom = 700;
      await act(async () => window.dispatchEvent(new Event('resize')));
      expect(listbox().dataset.side).toBe('above');

      await press('ArrowUp');
      const selected = container.querySelector('[aria-selected="true"]')!;
      expect(selected.textContent).toBe('/skill-13Skill 13');
      expect(scrolled.mock.contexts.at(-1)).toBe(selected);
      expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest' });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('ChatComposer: attached files (W1-13)', () => {
  const MB = 1024 * 1024;
  const file = (name: string, type: string, size: number) => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  async function pick(...files: File[]) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  }
  const fileChips = () =>
    [...container.querySelectorAll<HTMLElement>('[data-slot="composer-file"]')].map((c) => [
      c.dataset.status,
      c.textContent,
    ]);
  const alert = () => container.querySelector('[role="alert"]')?.textContent ?? null;

  it('shows each file as a chip while it goes up, and sends the ready ones with the message', async () => {
    let finish: (value: { ok: true; id: string }) => void = () => {};
    const upload = vi.fn(
      () => new Promise<{ ok: true; id: string }>((resolve) => (finish = resolve)),
    );
    await render({ uploader: { upload, remove: vi.fn() } });
    await type('Read this brief');
    await pick(file('brief.pdf', 'application/pdf', 2 * MB));
    expect(fileChips()).toEqual([['uploading', 'PDFbrief.pdfUploading…×']]);
    // Send waits for the file.
    expect(button('Send')!.disabled).toBe(true);
    expect(under()).toContain('Send waits for your files');

    await act(async () => finish({ ok: true, id: 'up-1' }));
    expect(fileChips()).toEqual([['ready', 'PDFbrief.pdf×']]);
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Read this brief', {
      context: [],
      references: [],
      attachments: ['up-1'],
    });
    expect(fileChips()).toEqual([]);
  });

  it('says why a file can’t go: its type, over 10 MB, or a sixth', async () => {
    const upload = vi.fn(async () => ({ ok: true as const, id: 'up' }));
    await render({ uploader: { upload, remove: vi.fn() } });
    await pick(file('setup.exe', 'application/x-msdownload', MB));
    expect(alert()).toBe("This file type isn't supported.");
    await pick(file('big.pdf', 'application/pdf', 12 * MB));
    expect(alert()).toBe('Files must be 10 MB or smaller.');
    await pick(...['a', 'b', 'c', 'd', 'e', 'f'].map((n) => file(`${n}.csv`, 'text/csv', 100)));
    expect(alert()).toBe('You can attach up to 5 files.');
    expect(fileChips()).toHaveLength(5);
    expect(upload).toHaveBeenCalledTimes(5);
  });

  it('offers Retry for a file that failed, and takes a file away with ×', async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, failure: 'failed' })
      .mockResolvedValueOnce({ ok: true, id: 'up-2' });
    const remove = vi.fn();
    await render({ uploader: { upload, remove } });
    await pick(file('data.csv', 'text/csv', 100));
    expect(alert()).toBe('Upload failed.Retry');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="composer.retryUpload"]')!.click(),
    );
    expect(fileChips()).toEqual([['ready', 'CSVdata.csv×']]);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="composer.removeFile"]')!.click(),
    );
    expect(fileChips()).toEqual([]);
    expect(remove).toHaveBeenCalledWith('up-2');
  });

  it('attaches nothing without the page’s uploader', async () => {
    await render();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
