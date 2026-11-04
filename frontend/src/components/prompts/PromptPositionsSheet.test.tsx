import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { summarizePositions, type PositionAnswer } from '@/lib/promptPositions';
import type { PromptPositionsData } from '@/lib/actions/promptPositions';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * The positions panel over a week: its cards carry the table's answer,
 * mention and citation counts beside the days, and a day block shows its
 * positions in a tooltip when hovered.
 */

const { getPromptPositions } = vi.hoisted(() => ({ getPromptPositions: vi.fn() }));
vi.mock('@/lib/actions/promptPositions', () => ({ getPromptPositions }));
vi.mock('./PromptImproveTab', () => ({
  ImproveTab: () => null,
  useImprove: () => ({ count: null, dirty: false }),
}));
vi.mock('@/components/filters/DateRangeFilter', () => ({ DateRangeFilter: () => null }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/actions/contentDrafts', () => ({ getDraftForPrompt: async () => null }));

const { PromptPositionsSheet } = await import('./PromptPositionsSheet');

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK = { from: '2026-10-04T00:00:00.000Z', to: '2026-10-10T23:59:59.999Z' };

const answer = (over: Partial<PositionAnswer> & { createdAt: string }): PositionAnswer => ({
  platform: 'chatgpt-web',
  region: 'US',
  mentioned: false,
  mentions: 0,
  mentionPosition: null,
  mentionTotal: null,
  sentiment: null,
  cited: false,
  citations: 0,
  citation: null,
  ...over,
});

function data({ locked = false, unanswered = false } = {}): PromptPositionsData {
  const { summary, platforms } = summarizePositions(
    [
      answer({
        createdAt: '2026-10-08T02:00:00Z',
        mentioned: true,
        mentions: 3,
        mentionPosition: 2,
        mentionTotal: 3,
        cited: true,
        citations: 2,
        citation: { rank: 1, total: 4 },
      }),
      answer({ createdAt: '2026-10-09T02:00:00Z' }),
    ],
    [
      { id: 'chatgpt-web', label: 'ChatGPT', access: { state: 'included' } },
      ...(unanswered
        ? [
            {
              id: 'copilot-web' as const,
              label: 'Microsoft Copilot',
              access: { state: 'included' as const },
            },
          ]
        : []),
      ...(locked
        ? [
            {
              id: 'google-aio' as const,
              label: 'Google AI Overviews',
              access: { state: 'locked' as const, requiredPlan: 'growth' as const },
            },
          ]
        : []),
    ],
    WEEK,
  );
  return {
    prompt: { id: 'p1', text: 'Best coffee subscription?', topicName: null, isActive: true },
    planId: 'enterprise',
    window: WEEK,
    summary,
    platforms,
    improving: null,
    citedPage: null,
  };
}

/** Two answers that neither name nor cite the brand. */
function unnamed(): PromptPositionsData {
  const { summary, platforms } = summarizePositions(
    [answer({ createdAt: '2026-10-08T02:00:00Z' }), answer({ createdAt: '2026-10-09T02:00:00Z' })],
    [{ id: 'chatgpt-web', label: 'ChatGPT', access: { state: 'included' } }],
    WEEK,
  );
  return { ...data(), summary, platforms };
}

let container: HTMLDivElement;
let root: Root;
// The workspace's plan: active unless a test says it's read-only.
let isLocked = false;
const openUpgrade = vi.fn();

async function open(
  preset: '7d' | '24h' = '7d',
  more: Partial<React.ComponentProps<typeof PromptPositionsSheet>> = {},
) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <PromptPositionsSheet
            prompt={{ id: 'p1', text: 'Best coffee subscription?' }}
            range={{ preset, from: '', to: '' }}
            window={WEEK}
            onRangeChange={() => {}}
            region=""
            onClose={() => {}}
            {...more}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    ),
  );
}

beforeEach(() => {
  isLocked = false;
  openUpgrade.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getPromptPositions.mockResolvedValue(data());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PromptPositionsSheet', () => {
  it('offers content first in the Improve tab when no answer names the brand', async () => {
    getPromptPositions.mockResolvedValue(unnamed());
    const onStartContent = vi.fn();
    await open('7d', { initialTab: 'improve', brandId: 'b1', onStartContent });
    await act(async () => {});
    expect(document.body.textContent).toContain('No answer mentions or cites you here');
    const create = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Create content',
    )!;
    await act(async () => create.click());
    expect(onStartContent).toHaveBeenCalledWith({
      kind: 'prompt',
      id: 'p1',
      text: 'Best coffee subscription?',
      method: 'create',
    });
  });

  it('opens the upgrade dialog from Create content on a read-only workspace', async () => {
    isLocked = true;
    getPromptPositions.mockResolvedValue(unnamed());
    const onStartContent = vi.fn();
    await open('7d', { initialTab: 'improve', brandId: 'b1', onStartContent });
    await act(async () => {});
    const create = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Create content',
    )!;
    await act(async () => create.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Creating content needs a plan');
    expect(onStartContent).not.toHaveBeenCalled();
  });

  it('offers no content step where the page gives no way to start', async () => {
    getPromptPositions.mockResolvedValue(unnamed());
    await open('7d', { initialTab: 'improve' });
    expect(document.body.textContent).not.toContain('Create content');
  });

  it("puts the table's answer, mention and citation counts beside the days", async () => {
    await open();
    const text = document.body.textContent ?? '';
    expect(text).toContain('2 answers');
    expect(text).toContain('In 1 of 2 answers · 3 mentions');
    expect(text).toContain('In 1 of 2 answers · 2 citations');
    expect(text).not.toContain('your plan includes');
  });

  it("says the 24h cards' answer counts cover the period, not the latest run", async () => {
    await open('24h');
    const text = document.body.textContent ?? '';
    expect(text).toContain('2 answers in this period');
    expect(text).toContain('In 1 of 2 answers in this period · 3 mentions');
  });

  it("lists each platform's latest answer in 24h, mention first, then citation", async () => {
    getPromptPositions.mockResolvedValue(data({ unanswered: true }));
    await open('24h');
    const rows = [...document.querySelectorAll<HTMLElement>('[data-platform]')];
    expect(rows.map((r) => r.dataset.platform)).toEqual(['chatgpt-web', 'copilot-web']);

    // The latest answer (Oct 9) named and cited nothing; the one before did.
    const blocks = [...rows[0].querySelectorAll('dl > div')].map((b) => b.textContent);
    expect(blocks).toEqual([
      'MentionNot mentionedDetected earlier in this period',
      'CitationNot citedDetected earlier in this period',
    ]);
    expect(rows[1].textContent).toContain('No completed tracking runs in this period');
  });

  it('says the counts leave out a platform the plan locks', async () => {
    getPromptPositions.mockResolvedValue(data({ locked: true }));
    await open();
    expect(document.body.textContent).toContain(
      'Answer counts cover the platforms your plan includes.',
    );
  });

  it("shows a day's positions in a tooltip when its block is hovered", async () => {
    await open();
    const block = document.querySelector<HTMLElement>('[data-day="2026-10-08"]')!;
    // The browser's own tooltip is gone: it lagged and couldn't be styled.
    expect(block.hasAttribute('title')).toBe(false);

    await act(async () => {
      block.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      block.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    });
    const tooltip = document.querySelector('[data-slot="tooltip-content"]');
    expect(tooltip?.textContent).toContain('Oct 8, 2026 · 1 run');
    expect(tooltip?.textContent).toContain('Mentioned · Mid · #2 of 3');
    expect(tooltip?.textContent).toContain('Cited · Early · #1 of 4');
  });
});
