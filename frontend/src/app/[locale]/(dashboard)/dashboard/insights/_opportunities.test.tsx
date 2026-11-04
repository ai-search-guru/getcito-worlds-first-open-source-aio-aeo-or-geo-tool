import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { trackSuggestions } from '@/lib/actions/promptSuggestions';
import { sendTopicOpportunityToActionCenter } from '@/lib/actions/topic';
import { Opportunities } from './_opportunities';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/actions/promptSuggestions', () => ({ trackSuggestions: vi.fn() }));
vi.mock('@/lib/actions/topic', () => ({ sendTopicOpportunityToActionCenter: vi.fn() }));
vi.mock('@/lib/actions/content', () => ({
  generateOpportunitiesOnDemand: vi.fn(),
  getGenerationJobStatus: vi.fn(),
}));
// The viewer: a manager unless a test says otherwise.
const viewer = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ canManage: viewer.canManage }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  viewer.canManage = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const suggestion = (id: string, topic: string | null, estVolume: number) => ({
  id,
  text: `Prompt ${id}`,
  topicId: topic ? `t-${topic}` : null,
  topicName: topic,
  estVolume,
  relevance: 0.9,
});

describe('Opportunities — estimated volume (PROMPT-013)', () => {
  it("shows the suggestions' AI-guessed volume as a grey range, never a bare number", () => {
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Opportunities
            brandId="b1"
            suggestions={[
              suggestion('s1', 'Espresso', 800),
              suggestion('s2', 'Espresso', 400),
              suggestion('s3', null, 350),
            ]}
            trackedTopicIds={[]}
            topics={null}
            entities={null}
            slotsLeft={null}
            contentUsage={null}
            onTracked={() => {}}
          />
        </NextIntlClientProvider>,
      ),
    );
    const ranges = [
      ...container.querySelectorAll<HTMLButtonElement>('button[aria-label*="a month, estimated"]'),
    ];
    // The topic's 1,200 and the lone prompt's 350, each half to twice, low.
    expect(ranges.map((r) => r.textContent)).toEqual(['600–2.4k/mo', '170–700/mo']);
    expect(ranges.every((r) => r.className.includes('text-muted-foreground'))).toBe(true);
    expect(container.textContent).toContain('2 prompts\u00a0·\u00a0600–2.4k/mo');
    expect(container.textContent).not.toContain('~');
  });
});

describe("Opportunities' Track and Suggest content by role", () => {
  const render = (suggestions: ReturnType<typeof suggestion>[]) =>
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Opportunities
            brandId="b1"
            suggestions={suggestions}
            trackedTopicIds={[]}
            topics={null}
            entities={null}
            slotsLeft={null}
            contentUsage={null}
            onTracked={() => {}}
          />
        </NextIntlClientProvider>,
      ),
    );
  const labels = () => [...container.querySelectorAll('button')].map((b) => b.textContent);
  const prompt = [suggestion('s3', null, 350)];
  const topic = [suggestion('s1', 'Espresso', 800), suggestion('s2', 'Espresso', 400)];

  it('offers an admin or a manager Track and Suggest content', () => {
    render(prompt);
    expect(labels()).toContain('Track');
    expect(labels()).toContain('Suggest content');
    expect(container.textContent).not.toContain('Ask an admin or a manager');
  });

  it('leaves both out for an analyst or an agency partner, who read who can', () => {
    viewer.canManage = false;
    render(prompt);
    expect(labels()).not.toContain('Track');
    expect(labels()).not.toContain('Suggest content');
    expect(container.textContent).toContain(
      'Ask an admin or a manager to track these prompts or suggest content for them.',
    );
  });

  it("keeps a topic's Send action for an analyst, without Track", () => {
    viewer.canManage = false;
    render(topic);
    expect(labels()).toContain('Send action');
    expect(labels()).not.toContain('Track 2');
    expect(container.textContent).toContain('Ask an admin or a manager to add prompts.');
  });
});

describe('Opportunities on a read-only workspace (plan not active)', () => {
  const openUpgrade = vi.fn();
  const render = (isLocked: boolean) =>
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <Opportunities
              brandId="b1"
              suggestions={[suggestion('s1', 'Espresso', 800), suggestion('s2', 'Espresso', 400)]}
              trackedTopicIds={[]}
              topics={null}
              entities={null}
              slotsLeft={null}
              contentUsage={null}
              onTracked={() => {}}
            />
          </UpgradeDialogContext.Provider>
        </NextIntlClientProvider>,
      ),
    );
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === name,
    )!;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    vi.mocked(trackSuggestions).mockResolvedValue({ trackedIds: ['s1', 's2'], skippedIds: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the upgrade dialog from a topic’s Track and Send action, and runs neither', async () => {
    render(true);
    await act(async () => button('Track 2').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Tracking prompts needs a plan');
    await act(async () => button('Send action').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Sending actions needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(trackSuggestions).not.toHaveBeenCalled();
    expect(sendTopicOpportunityToActionCenter).not.toHaveBeenCalled();
    // No tab is opened for a Track that doesn't run.
    expect(window.open).not.toHaveBeenCalled();
  });

  it('tracks on an active plan', async () => {
    render(false);
    await act(async () => button('Track 2').click());
    expect(trackSuggestions).toHaveBeenCalledWith(['s1', 's2']);
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

/**
 * Track on a brand without topics: prompts are grouped under topics, so it
 * asks for one first, with a way to the Topics tab, and tracks nothing.
 */
describe('Opportunities on a brand without topics', () => {
  const render = () =>
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Opportunities
            brandId="b1"
            suggestions={[suggestion('s1', 'Espresso', 800), suggestion('s2', 'Espresso', 400)]}
            trackedTopicIds={[]}
            topics={null}
            entities={null}
            slotsLeft={null}
            contentUsage={null}
            onTracked={() => {}}
          />
        </NextIntlClientProvider>,
      ),
    );
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === name,
    );
  const addTopicLink = () =>
    [...document.querySelectorAll('a')].find((a) => a.textContent === 'Add a topic');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    vi.mocked(trackSuggestions).mockResolvedValue({
      trackedIds: [],
      skippedIds: [],
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for a topic first, with a way to the Topics tab, and keeps the topic on the card', async () => {
    render();
    await act(async () => button('Track 2')!.click());
    expect(document.body.textContent).toContain('Add a topic first');
    expect(addTopicLink()?.getAttribute('href')).toBe('/dashboard/prompts/topics?new=1');
    expect(button('Track 2')).toBeDefined();
  });
});
