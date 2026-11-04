import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { CitedPage, PositionsSummary } from '@/lib/promptPositions';
import { PromptContentStep } from './PromptContentStep';

const getDraftForPrompt = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  getDraftForPrompt: (...args: unknown[]) => getDraftForPrompt(...args),
}));
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const summary = (over: Partial<PositionsSummary>): PositionsSummary => ({
  days: [],
  runs: 10,
  answers: 10,
  mentionedAnswers: 1,
  citedAnswers: 1,
  mentions: 1,
  citations: 1,
  trackedDays: 7,
  mentionedDays: 1,
  citedDays: 1,
  untrackedDays: 0,
  lastAnswerAt: null,
  mentionPosition: null,
  citationPosition: null,
  ...over,
});
const GUIDE: CitedPage = {
  url: 'https://acme.example/guides/crm',
  title: 'The CRM guide',
  answers: 1,
};

let container: HTMLDivElement;
let root: Root;
const onStart = vi.fn();

async function render(s: PositionsSummary, citedPage: CitedPage | null = null, recheck = 0) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PromptContentStep
          brandId="b1"
          prompt={{ id: 'p1', text: 'best crm for realtors' }}
          summary={s}
          citedPage={citedPage}
          onStart={onStart}
          recheck={recheck}
        />
      </NextIntlClientProvider>,
    ),
  );
  await act(async () => {});
}
const button = () => container.querySelector('button')!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getDraftForPrompt.mockReset().mockResolvedValue(null);
  onStart.mockReset();
  push.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PromptContentStep', () => {
  it('optimizes the page AI cites when the brand is named rarely', async () => {
    await render(summary({}), GUIDE);
    expect(getDraftForPrompt).toHaveBeenCalledWith('b1', 'p1');
    expect(container.textContent).toContain('Mentioned in 10% of answers');
    expect(container.textContent).toContain(
      'Optimize The CRM guide, the page AI engines cite here',
    );
    await act(async () => button().click());
    expect(onStart).toHaveBeenCalledWith({
      kind: 'prompt',
      id: 'p1',
      text: 'best crm for realtors',
      method: 'optimize',
      page: { url: GUIDE.url, title: GUIDE.title },
    });
  });

  it('leaves the page to Start when none is cited, and names a late position', async () => {
    await render(
      summary({ mentionedAnswers: 6, mentionPosition: { best: 2, worst: 7, avg: 4.5, count: 6 } }),
    );
    expect(container.textContent).toContain('Mentioned at #4.5 on average');
    expect(container.textContent).toContain('pick the one to optimize');
    await act(async () => button().click());
    expect(onStart.mock.calls[0][0]).toMatchObject({ method: 'optimize', page: null });
  });

  it('opens the draft already being written instead of starting another', async () => {
    getDraftForPrompt.mockResolvedValue('d7');
    await render(summary({ mentionedAnswers: 0, citedAnswers: 0 }));
    expect(container.textContent).toContain('A draft for this prompt is already being written.');
    expect(button().textContent).toBe('Open draft');
    await act(async () => button().click());
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d7');
    expect(onStart).not.toHaveBeenCalled();
  });

  // Start sent to the Agent or the Team closes over the panel, which stays
  // open: the step must not offer a second draft.
  it('looks for the draft again once Start sent one, and opens it then', async () => {
    const lost = summary({ mentionedAnswers: 0, citedAnswers: 0 });
    await render(lost);
    expect(button().textContent).toBe('Create content');
    getDraftForPrompt.mockResolvedValue('d9');
    await render(lost, null, 1);
    expect(getDraftForPrompt).toHaveBeenCalledTimes(2);
    expect(button().textContent).toBe('Open draft');
  });

  it('shows nothing, and looks up nothing, when the prompt does well', async () => {
    await render(summary({ mentionedAnswers: 8 }));
    expect(container.textContent).toBe('');
    expect(getDraftForPrompt).not.toHaveBeenCalled();
  });
});
