import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ContentOpportunity } from '@/types';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { keywordVolumeEstimate } from '@/lib/volumeEstimate';

/**
 * The opportunity panel on a read-only workspace (plan not active): its
 * actions open the upgrade dialog instead, named; on an active plan they run.
 */

const content = vi.hoisted(() => ({
  getOpportunity: vi.fn(),
  getBriefQuota: vi.fn(),
  generateBrief: vi.fn(),
  updateOpportunityStatus: vi.fn(),
  sendToWebhook: vi.fn(),
  sendOpportunityToActionCenter: vi.fn(),
  suggestAlternative: vi.fn(),
  getGenerationJobStatus: vi.fn(),
}));
vi.mock('@/lib/actions/content', () => content);
vi.mock('@/lib/actions/fanout', () => ({
  getPromptFanout: vi.fn(async () => ({ subQueries: [] })),
}));
vi.mock('@/lib/actions/contentDrafts', () => ({
  getOpportunityDrafts: vi.fn(async () => ({})),
}));
const plan = vi.hoisted(() => ({
  getPlanPriorities: vi.fn(async () => []),
  setPlanRowPriority: vi.fn(async () => undefined),
}));
vi.mock('@/lib/actions/contentPlan', () => plan);
const NO_VOLUME = { basket: null, basketFailed: false, volume: null, question: null, prompts: 1 };
const volumeRead = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/hooks/useOpportunityVolume', () => ({
  useOpportunityVolume: () => volumeRead.value ?? NO_VOLUME,
}));
// An admin or a manager unless a test says otherwise.
const viewer = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ canManage: viewer.canManage }),
}));
const brandState = vi.hoisted(() => ({
  activeBrandId: 'b1',
  brands: [{ id: 'b1', name: 'Acme', siteType: 'b2b' }],
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (select: (state: typeof brandState) => unknown) => select(brandState),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ai-usage/AiUsageBanner', () => ({ AiUsageBanner: () => null }));
const newContent = vi.hoisted(() => ({ open: false }));
vi.mock('@/components/content/NewContentDialog', () => ({
  NewContentDialog: ({ open }: { open: boolean }) => {
    newContent.open = open;
    return null;
  },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const { OpportunityDetail } = await import('./OpportunityDetail');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const OPPORTUNITY = {
  id: 'o1',
  brandId: 'b1',
  title: 'Office coffee subscriptions',
  type: 'owned',
  impact: 'high',
  opportunityScore: 74,
  status: 'new',
  source: 'system',
  sourceData: {},
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
} as ContentOpportunity;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <OpportunityDetail id="o1" inDrawer />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const buttonNamed = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
const moreItem = async (item: string) => {
  await act(async () =>
    container.querySelector<HTMLElement>('[aria-label="More actions"]')!.click(),
  );
  const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent === item,
  )!;
  await act(async () => found.click());
};

beforeEach(() => {
  vi.clearAllMocks();
  volumeRead.value = null;
  viewer.canManage = true;
  newContent.open = false;
  content.getOpportunity.mockResolvedValue(OPPORTUNITY);
  content.getBriefQuota.mockResolvedValue({ limit: -1, remaining: -1 });
  content.generateBrief.mockResolvedValue({
    brief: {
      suggestedTitle: 'Office coffee subscriptions',
      contentType: 'how-to',
      targetWordCount: 1200,
      outline: [],
      targetKeywords: [],
      competitorInsights: '',
      callToAction: '',
    },
    quota: null,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the opportunity panel on a read-only workspace', () => {
  it('opens the upgrade dialog from its actions, and runs none', async () => {
    await render(true);
    await act(async () => buttonNamed('Send to Actions').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Sending actions needs a plan');
    await act(async () => buttonNamed('Generate Brief').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Generating a brief needs a plan');
    await act(async () => buttonNamed('Send to Editor').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Creating content needs a plan');
    await moreItem('Mark as reviewed');
    expect(openUpgrade).toHaveBeenLastCalledWith('Marking an opportunity reviewed needs a plan');
    await moreItem('Another angle');
    expect(openUpgrade).toHaveBeenLastCalledWith('Generating opportunities needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(5);
    expect(content.sendOpportunityToActionCenter).not.toHaveBeenCalled();
    expect(content.generateBrief).not.toHaveBeenCalled();
    expect(content.updateOpportunityStatus).not.toHaveBeenCalled();
    expect(newContent.open).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('generates the brief on an active plan', async () => {
    await render(false);
    await act(async () => buttonNamed('Generate Brief').click());
    expect(content.generateBrief).toHaveBeenCalledWith('o1');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

describe('the brief quota without an active plan', () => {
  it('says "No active plan", not the limit, and Generate opens the upgrade dialog', async () => {
    // The server reads 0 of 0 with `noPlan` once the plan has ended.
    content.getBriefQuota.mockResolvedValue({ used: 4, limit: 0, remaining: 0, noPlan: true });
    await render(true);
    expect(container.textContent).toContain('No active plan');
    expect(container.textContent).not.toContain('Monthly Brief Limit Reached');
    expect(container.textContent).not.toContain('0/0');
    const generate = buttonNamed('Generate Content Brief');
    expect(generate.disabled).toBe(false);
    expect(buttonNamed('Generate Brief').disabled).toBe(false);
    await act(async () => generate.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Generating a brief needs a plan');
    expect(content.generateBrief).not.toHaveBeenCalled();
  });

  it('still says the limit is reached once an active plan is used up', async () => {
    content.getBriefQuota.mockResolvedValue({ used: 10, limit: 10, remaining: 0 });
    await render(false);
    expect(container.textContent).toContain('Monthly Brief Limit Reached');
    expect(container.textContent).not.toContain('No active plan');
    expect(buttonNamed('Generate Brief').disabled).toBe(true);
  });
});

describe("the opportunity panel's costly AI work", () => {
  const labels = () =>
    [...document.body.querySelectorAll('button, [role="menuitem"]')].map((el) =>
      el.textContent?.trim(),
    );
  const openMore = () =>
    act(async () => container.querySelector<HTMLElement>('[aria-label="More actions"]')!.click());

  it('offers an admin or a manager Generate Brief and Another angle', async () => {
    await render(false);
    expect(labels()).toContain('Generate Brief');
    expect(labels()).toContain('Generate Content Brief');
    await openMore();
    expect(labels()).toContain('Another angle');
  });

  it('leaves them out for an analyst or an agency partner, saying who generates a brief', async () => {
    viewer.canManage = false;
    await render(false);
    expect(labels()).not.toContain('Generate Brief');
    expect(labels()).not.toContain('Generate Content Brief');
    expect(container.textContent).toContain('Ask an admin or a manager to generate a brief.');
    await openMore();
    expect(labels()).not.toContain('Another angle');
  });
});

describe("the opportunity panel's Dismiss", () => {
  const menuItems = async () => {
    await act(async () =>
      container.querySelector<HTMLElement>('[aria-label="More actions"]')!.click(),
    );
    return [...document.body.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
  };

  it('is offered to an admin or a manager', async () => {
    await render(false);
    expect(await menuItems()).toContain('Dismiss');
  });

  it('is left out for an analyst or an agency partner, who keep Mark as reviewed', async () => {
    viewer.canManage = false;
    await render(false);
    const items = await menuItems();
    expect(items).toContain('Mark as reviewed');
    expect(items).not.toContain('Dismiss');
  });
});

describe("the opportunity's volume (2026-11-01)", () => {
  it("is its question's, one of its prompts, from head terms with the closest measured phrase", async () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const question = 'What are the best coffee subscription services in 2026?';
    volumeRead.value = {
      ...NO_VOLUME,
      volume: keywordVolumeEstimate(6751, 0.45, '2026-10-20T00:00:00Z', now),
      question: {
        question,
        estimate: keywordVolumeEstimate(6751, 0.45, '2026-10-20T00:00:00Z', now),
        fromHeadTerms: true,
        closest: {
          phrase: 'best coffee subscription 2026',
          estimate: keywordVolumeEstimate(1300, 0.45, '2026-10-20T00:00:00Z', now),
        },
      },
      prompts: 3,
    };
    await render(false);
    const text = container.textContent ?? '';
    expect(text).toContain('Estimate');
    expect(text).toContain(`For “${question}”, one of 3 prompts`);
    expect(text).toContain(
      'From head terms. Closest measured phrase: “best coffee subscription 2026”',
    );
  });
});
