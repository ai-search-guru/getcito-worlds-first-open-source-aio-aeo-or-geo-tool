import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { Brand, Topic } from '@/types';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A brand tracking more topics than one prompts call takes, its description longer. */
const brand: Brand = {
  id: 'brand-id',
  organizationId: 'organization-id',
  name: 'Acme',
  slug: 'acme',
  industry: 'Coffee',
  description: 'd'.repeat(2500),
  language: 'en',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [{ id: 'd1', brandId: 'brand-id', domain: 'acme.com', isPrimary: true }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const topics: Topic[] = Array.from({ length: 21 }, (_, i) => ({
  id: `t${i + 1}`,
  brandId: 'brand-id',
  name: `topic ${i + 1}`,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}));

/** What the page loads: each describe sets its own topics and session. */
const loaded = vi.hoisted(() => ({
  topics: [] as unknown[],
  session: null as { access_token: string } | null,
}));

const actions = vi.hoisted(() => ({
  getPromptSets: vi.fn(),
  savePromptSet: vi.fn(),
  addPromptToSet: vi.fn(),
  setPromptActive: vi.fn(),
  updatePrompt: vi.fn(),
  updatePromptLocations: vi.fn(),
  bulkUpdatePromptLocations: vi.fn(),
  getLocationQuota: vi.fn(async () => null),
  deletePrompt: vi.fn(),
}));
vi.mock('@/lib/actions/prompt', () => actions);
vi.mock('@/lib/actions/brand', () => ({ getBrandById: async () => brand }));
vi.mock('@/lib/actions/topic', () => ({ getTopics: async () => loaded.topics }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'brand-id' }) }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: loaded.session } }) },
  }),
}));
vi.mock('@/components/context/PlanProvider', () => ({
  usePlanContext: () => ({ planId: 'growth', allowedModelIds: null }),
}));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canManage: true }) }));
vi.mock('@/lib/trackingJobStore', () => ({ saveTrackingJob: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { default: PromptsPage } = await import('./page');

/** The API: /prompts/from-topics answers 400 past its limits, as the server's schema does. */
const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
  if (!url.endsWith('/api/prompts/from-topics')) {
    return { ok: true, json: async () => ({ prompts: [] }) };
  }
  const body = JSON.parse(init?.body ?? '{}');
  const ok =
    body.topics.length <= 20 &&
    body.brandName.length <= 200 &&
    (body.industry ?? '').length <= 200 &&
    (body.description ?? '').length <= 2000;
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () =>
      ok
        ? {
            topicPrompts: body.topics.map((topic: string) => ({
              topic,
              prompts: [`best ${topic}`],
            })),
          }
        : { error: 'Invalid request' },
  };
});

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
          <PromptsPage />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
const include = () =>
  container.querySelector<HTMLButtonElement>(
    '[role="checkbox"][aria-label="Include this prompt"]',
  )!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("a brand's Prompts page", () => {
  beforeEach(() => {
    loaded.topics = topics;
    loaded.session = { access_token: 'token' };
    actions.getPromptSets.mockResolvedValue([]);
  });

  it('generates prompts for every topic of a brand with more than one call takes', async () => {
    await render(false);
    expect(container.textContent).toContain('21 topics selected');

    const generate = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Generate Prompts',
    );
    await act(async () => generate?.click());

    const calls = fetchMock.mock.calls
      .filter(([url]) => url.endsWith('/api/prompts/from-topics'))
      .map(([, init]) => JSON.parse(init?.body ?? '{}'));
    expect(calls.map((body) => body.topics.length)).toEqual([20, 1]);
    for (const body of calls) {
      expect(body.description).toHaveLength(2000);
      expect(body.industry).toBe('Coffee');
    }
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('21 prompt suggestions generated!');
    expect(container.textContent).toContain('best topic 1');
    expect(container.textContent).toContain('best topic 21');
  });
});

/**
 * Manage prompts on a read-only workspace (plan not active): AI Generate and
 * a prompt's Include toggle open the upgrade dialog instead of running.
 */
describe('Manage prompts on a read-only workspace', () => {
  beforeEach(() => {
    loaded.topics = [
      { id: 't1', brandId: 'brand-id', name: 'Coffee', isActive: true, createdAt: '2026-10-01' },
    ];
    loaded.session = null;
    actions.getPromptSets.mockResolvedValue([
      {
        id: 'set-1',
        prompts: [
          {
            id: 'p1',
            promptSetId: 'set-1',
            text: 'Best coffee subscription?',
            category: 'Coffee',
            platforms: ['chatgpt'],
            regions: ['US'],
            models: [],
            isActive: true,
            workStatus: null,
            targetUrlCount: 0,
            citedUrlCount: 0,
            createdAt: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
    ]);
    actions.setPromptActive.mockResolvedValue({ success: true });
  });

  it('generates nothing and pauses nothing, and says why', async () => {
    await render(true);
    await act(async () => button('Generate Prompts').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Generating prompts needs a plan');
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => include().click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Pausing prompts needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(actions.setPromptActive).not.toHaveBeenCalled();
  });

  it('pauses a prompt on an active plan', async () => {
    await render(false);
    await act(async () => include().click());
    expect(actions.setPromptActive).toHaveBeenCalledWith('p1', false);
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

/**
 * A brand without topics: prompts are grouped under topics, so both cards say
 * to add one first, with a way to the Topics tab, and Add Prompt asks for one
 * instead of adding a prompt without a topic.
 */
describe('Manage prompts on a brand without topics', () => {
  beforeEach(() => {
    loaded.topics = [];
    loaded.session = null;
    actions.getPromptSets.mockResolvedValue([{ id: 'set-1', prompts: [] }]);
  });

  const addTopicLinks = () =>
    [...document.body.querySelectorAll('a')].filter((a) => a.textContent === 'Add a topic');

  it('says to add a topic first in Add Prompt and AI Generate', async () => {
    await render(false);
    expect(container.textContent).toContain('Add a topic first');
    expect(container.textContent).not.toContain('Add topics in brand settings');
    const links = addTopicLinks();
    expect(links).toHaveLength(2);
    // This brand's own topics: the active brand may be another one.
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/dashboard/brands/brand-id/topics#add-topic',
      '/dashboard/brands/brand-id/topics#add-topic',
    ]);
  });

  it('asks for a topic first when Add Prompt is pressed, and adds nothing', async () => {
    await render(false);
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Best project management tools for startups"]',
    )!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'Best espresso beans?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Add Prompt').click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Add a topic first');
    expect(
      [...(dialog?.querySelectorAll('a') ?? [])]
        .find((a) => a.textContent === 'Add a topic')
        ?.getAttribute('href'),
    ).toBe('/dashboard/brands/brand-id/topics#add-topic');
    expect(actions.addPromptToSet).not.toHaveBeenCalled();
    expect(actions.savePromptSet).not.toHaveBeenCalled();
  });
});
