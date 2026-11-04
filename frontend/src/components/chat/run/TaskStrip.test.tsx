import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatTaskStrip } from '@/lib/chat/events';

/**
 * The task strip under a /tasks answer (CHAT-09 §B, mockup #s-work): its
 * header with the tasks due and how many are ready, a row per task with
 * "Priority 86 · Fix" and Chat's status, and once the run ended the line
 * saying the person closes the tasks in Action Center, with the way there.
 * Screen readers hear its changes once, and its bar reads "2 of 4 ready".
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { TaskStrip, TaskStripRows } = await import('./TaskStrip');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** The mockup's four tasks, one of them ready. */
const strip: ChatTaskStrip = {
  tasks: [
    {
      at: 1,
      title: 'Add FAQ block + schema to /pricing',
      priority: 86,
      category: 'fix',
      status: 'ready_for_review',
      due: '2026-10-30',
    },
    {
      at: 2,
      title: 'Fix wrong platform claim on /pricing',
      priority: 86,
      category: 'fix',
      status: 'writing',
    },
    { at: 3, title: 'Add FAQPage schema', priority: 71, category: 'growth', status: 'queued' },
    { at: 4, title: '', priority: null, category: null, status: 'done' },
  ],
  ready: 2,
  total: 4,
  due: 4,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const $ = (selector: string) => host.querySelector(selector) as HTMLElement | null;
const rows = () =>
  [...host.querySelectorAll('[data-task]')].map((row) => [
    row.querySelector('.truncate')?.textContent,
    row.querySelector('.text-muted-foreground')?.textContent ?? null,
    row.getAttribute('data-status'),
    row.lastElementChild?.textContent,
  ]);

describe('TaskStrip', () => {
  it('reads as the mockup: the tasks due, how many are ready, and a row per task', async () => {
    await render(<TaskStrip strip={strip} ended={false} />);
    const section = $('[data-slot="task-strip"]')!;
    expect(section.querySelector('h3')?.textContent).toBe('Action Center tasks · 4 due');
    expect(section.getAttribute('aria-labelledby')).toBe(section.querySelector('h3')?.id);
    const bar = $('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-label')).toBe('Tasks ready');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
    expect(bar.getAttribute('aria-valuetext')).toBe('2 of 4 ready');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('50%');
    expect(host.textContent).toContain('2 of 4 ready');
    expect(rows()).toEqual([
      [
        'Add FAQ block + schema to /pricing',
        'Priority 86 · Fix',
        'ready_for_review',
        'Ready for review',
      ],
      ['Fix wrong platform claim on /pricing', 'Priority 86 · Fix', 'writing', 'Writing'],
      ['Add FAQPage schema', 'Priority 71 · Growth', 'queued', 'Queued'],
      // A task with no words reads as one, and an unscored action shows no line.
      ['An Action Center task', null, 'done', 'Done'],
    ]);
    // While the run works, nothing says to close them yet.
    expect($('[data-action="done.closeTasksInActionCenter"]')).toBeNull();
  });

  it('says the person closes the tasks in Action Center once the run ended', async () => {
    await render(<TaskStrip strip={strip} ended />);
    expect(host.textContent).toContain('You close tasks in Action Center. I never mark them done.');
    const close = $('[data-action="done.closeTasksInActionCenter"]')!;
    expect(close.textContent).toBe('Close tasks in Action Center');
    expect(close.getAttribute('href')).toBe('/dashboard/action-center/actions');
  });

  it('names no due count when none of its tasks is due this week, and draws nothing empty', async () => {
    await render(<TaskStrip strip={{ ...strip, due: 0 }} ended={false} />);
    expect($('h3')?.textContent).toBe('Action Center tasks');
    await render(<TaskStrip strip={{ tasks: [], ready: 0, total: 0, due: 0 }} ended />);
    expect($('[data-slot="task-strip"]')).toBeNull();
  });

  it('gives each status its own pill, in both themes', async () => {
    await render(<TaskStripRows tasks={strip.tasks} />);
    const pill = (status: string) =>
      host.querySelector(`[data-status="${status}"]`)!.lastElementChild!.className;
    expect(pill('writing')).toContain('dark:text-blue-300');
    expect(pill('ready_for_review')).toContain('dark:text-amber-300');
    expect(pill('done')).toContain('dark:text-green-300');
    expect(pill('queued')).toContain('text-muted-foreground');
  });

  it('says once what changed, and nothing as it first draws', async () => {
    const news = () => $('[data-slot="task-strip-news"]')!;
    await render(<TaskStrip strip={strip} ended={false} />);
    expect(news().getAttribute('aria-live')).toBe('polite');
    expect(news().className).toContain('sr-only');
    expect(news().textContent).toBe('');
    // A row's status moves, and how many are ready with it.
    const reviewed: ChatTaskStrip = {
      ...strip,
      tasks: strip.tasks.map((task) =>
        task.at === 2 ? { ...task, status: 'ready_for_review' } : task,
      ),
      ready: 3,
    };
    await render(<TaskStrip strip={reviewed} ended={false} />);
    expect(news().textContent).toBe(
      'Fix wrong platform claim on /pricing: Ready for review. 3 of 4 ready',
    );
    // The same strip again says nothing new.
    await render(<TaskStrip strip={{ ...reviewed, tasks: [...reviewed.tasks] }} ended={false} />);
    expect(news().textContent).toBe(
      'Fix wrong platform claim on /pricing: Ready for review. 3 of 4 ready',
    );
    // A status alone, with the count as it was.
    const writing: ChatTaskStrip = {
      ...reviewed,
      tasks: reviewed.tasks.map((task) => (task.at === 3 ? { ...task, status: 'writing' } : task)),
    };
    await render(<TaskStrip strip={writing} ended={false} />);
    expect(news().textContent).toBe('Add FAQPage schema: Writing');
  });

  it('says nothing as its first tasks come in', async () => {
    await render(<TaskStrip strip={{ tasks: [], ready: 0, total: 0, due: 0 }} ended={false} />);
    await render(<TaskStrip strip={strip} ended={false} />);
    expect($('[data-slot="task-strip-news"]')?.textContent).toBe('');
  });
});
