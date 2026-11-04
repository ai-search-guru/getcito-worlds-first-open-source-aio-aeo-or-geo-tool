import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { TrayResponse } from '@/lib/chat/runsTray';
import { RunsTray, RunsTrayView, TRAY_POLL_CLOSED_MS, TRAY_POLL_OPEN_MS } from './RunsTray';

/**
 * The runs pill and its tray (CHAT-23 G4 `runs.toggleTray`, `runs.open`):
 * what runs and what needs the person at a glance; open, every run with
 * Review, its progress, or Open; read again every few seconds.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const TRAY: TrayResponse = {
  running: 1,
  needsYou: 1,
  runs: [
    {
      source: 'chat',
      state: 'needsYou',
      title: 'Action Center tasks',
      step: 4,
      steps: 6,
      stepLabel: 'Change one cited passage',
      startedAt: '2026-10-26T13:02:00Z',
      finishedAt: null,
      href: '/dashboard/chat/a',
    },
    {
      source: 'chat',
      state: 'running',
      title: null,
      step: 2,
      steps: 5,
      stepLabel: 'Comparing cited pages',
      startedAt: '2026-10-26T12:40:00Z',
      finishedAt: null,
      href: '/dashboard/chat/b',
    },
    {
      source: 'content',
      state: 'done',
      title: 'Pricing FAQ',
      step: 3,
      steps: 3,
      stepLabel: 'Checking sources',
      startedAt: '2026-10-26T04:58:00Z',
      finishedAt: '2026-10-26T05:02:00Z',
      href: '/dashboard/content/editor/c',
    },
    {
      source: 'chat',
      state: 'failed',
      title: 'Merchant feed fix',
      step: 2,
      steps: 3,
      stepLabel: 'Update titles',
      startedAt: '2026-10-26T04:30:00Z',
      finishedAt: '2026-10-26T04:31:00Z',
      href: '/dashboard/chat/d',
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(ui: ReactNode) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {ui}
      </NextIntlClientProvider>,
    ),
  );
}

const pill = () => container.querySelector<HTMLButtonElement>('[data-action="runs.toggleTray"]')!;
const popup = () => document.querySelector<HTMLElement>('[data-slot="popover-content"]');
const openTray = async () => {
  await act(async () => pill().click());
  await act(async () => {});
};

describe('RunsTrayView', () => {
  it('says what runs and what needs the person on its pill', async () => {
    await render(<RunsTrayView data={TRAY} />);
    expect(pill().textContent).toBe('1 running1');
    expect(pill().getAttribute('aria-label')).toBe('Your runs: 1 running · 1 needs you');
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    const count = pill().querySelector('[title]')!;
    expect(count.getAttribute('title')).toBe('1 needs you');
    expect(count.getAttribute('class')).toContain('dark:bg-amber-500');
    // The bouncing dots stop with reduced motion.
    const dots = [...pill().querySelectorAll('i')];
    expect(dots).toHaveLength(3);
    for (const dot of dots)
      expect(dot.getAttribute('class')).toContain('motion-reduce:animate-none');
  });

  it('lists every run with Review, its progress, or Open, each opening its run', async () => {
    await render(<RunsTrayView data={TRAY} />);
    await openTray();
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    const tray = popup()!;
    expect(tray.className).toContain('motion-reduce:animate-none!');
    expect(tray.textContent).toContain('Your runs');
    const rows = [...tray.querySelectorAll<HTMLAnchorElement>('[data-action="runs.open"]')];
    expect(rows.map((a) => [a.getAttribute('href'), a.dataset.state])).toEqual([
      ['/dashboard/chat/a', 'needsYou'],
      ['/dashboard/chat/b', 'running'],
      ['/dashboard/content/editor/c', 'done'],
      ['/dashboard/chat/d', 'failed'],
    ]);
    expect(rows[0].textContent).toBe('Action Center tasksNeeds your OK · step 4 of 6Review');
    expect(rows[1].textContent).toBe('New chatStep 2 of 5 · Comparing cited pages');
    expect(rows[1].querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('20');
    expect(rows[2].textContent).toMatch(/^Pricing FAQDone \d\d:\d\dOpen$/);
    expect(rows[3].textContent).toBe('Merchant feed fixStopped · step 2 of 3Open');
    // The avatar in each run's state; the words already say it.
    expect(
      rows.map((a) => a.querySelector<HTMLElement>('[data-slot="agent-avatar"]')!.dataset.state),
    ).toEqual(['waiting', 'working', 'done', 'failed']);

    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    await act(async () => {});
    expect(popup()).toBeNull();
  });

  it('says when nothing runs, and when the runs could not be read', async () => {
    await render(<RunsTrayView data={{ runs: [], running: 0, needsYou: 0 }} />);
    expect(pill().textContent).toBe('Runs');
    expect(pill().querySelectorAll('i')).toHaveLength(0);
    await openTray();
    expect(popup()!.textContent).toContain('No runs yet. Runs keep going when you leave a page.');
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(<RunsTrayView data={null} load="error" />);
    await openTray();
    expect(popup()!.querySelector('[role="alert"]')!.textContent).toBe('Couldn’t load your runs.');
  });
});

describe('RunsTray', () => {
  it('reads the runs for the brand, and again every few seconds, more often while open', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true, ...TRAY }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await render(<RunsTray brandId="brand-1" />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/chat/runs/tray?brand=brand-1',
      { cache: 'no-store' },
    ]);
    expect(pill().textContent).toBe('1 running1');

    await act(async () => vi.advanceTimersByTimeAsync(TRAY_POLL_CLOSED_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Opening reads at once, then every few seconds.
    await act(async () => pill().click());
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(TRAY_POLL_OPEN_MS));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('reads at once when the page says a run started or ended, not at its next poll', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, ...TRAY }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await render(<RunsTray brandId="brand-1" readAgain="false:" />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await render(<RunsTray brandId="brand-1" readAgain="true:" />);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await render(<RunsTray brandId="brand-1" readAgain="true:run-1" />);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The same value: no extra read, only the poll's.
    await render(<RunsTray brandId="brand-1" readAgain="true:run-1" />);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(TRAY_POLL_CLOSED_MS));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('reads nothing while the tab is hidden, and says when it couldn’t read', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ ok: false, failure: 'failed', error: 'x' }), {
          status: 500,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await render(<RunsTray />);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/runs/tray');
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => vi.advanceTimersByTimeAsync(TRAY_POLL_CLOSED_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
    await act(async () => pill().click());
    await act(async () => {});
    expect(popup()!.querySelector('[role="alert"]')!.textContent).toBe('Couldn’t load your runs.');
  });

  it.each([
    [
      'the route’s failure',
      () =>
        Response.json({ ok: false, failure: 'session', error: 'Unauthorized' }, { status: 401 }),
      'Your session expired. Sign in again.',
    ],
    [
      'one read from the status and body',
      () => Response.json({ code: 'not_in_workspace' }, { status: 403 }),
      "This brand isn't in your workspace. Switch to one of your brands.",
    ],
  ])('says why in the app’s words: %s', async (_, answer, why) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer()),
    );
    await render(<RunsTray />);
    await act(async () => pill().click());
    await act(async () => {});
    expect(popup()!.querySelector('[role="alert"]')!.textContent).toBe(
      `Couldn’t load your runs.${why}`,
    );
  });

  it('keeps the runs it has when a later read fails, and says nothing went wrong once one works', async () => {
    vi.useFakeTimers();
    const answers = [
      new Response(JSON.stringify({ ok: true, ...TRAY })),
      new Response('<html>Bad gateway</html>', { status: 502 }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answers.shift()!),
    );
    await render(<RunsTray />);
    await act(async () => vi.advanceTimersByTimeAsync(TRAY_POLL_CLOSED_MS));
    await act(async () => pill().click());
    await act(async () => {});
    expect(popup()!.querySelector('[role="alert"]')).toBeNull();
    expect(popup()!.querySelectorAll('[data-action="runs.open"]')).toHaveLength(4);
  });
});
