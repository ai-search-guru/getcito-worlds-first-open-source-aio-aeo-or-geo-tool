import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { AiUsage } from '@/lib/billing/aiUsage';
import type { ContentOpportunity } from '@/types';
import { WriteThisDialog } from './WriteThisDialog';

const createContentDraft = vi.fn();
const importContentPage = vi.fn();
const startAgentWriting = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  createContentDraft: (...args: unknown[]) => createContentDraft(...args),
  importContentPage: (...args: unknown[]) => importContentPage(...args),
  startAgentWriting: (...args: unknown[]) => startAgentWriting(...args),
}));
// What the agent is given is agentWrite.test.ts's; here, that Write this hands it over.
const agentWriteRequest = vi.fn();
const describeRule = vi.fn();
vi.mock('@/lib/content/agentWrite', () => ({
  agentWriteRequest: (...args: unknown[]) => agentWriteRequest(...args),
  useRuleDescriber: () => describeRule,
}));
let usage: AiUsage | null | undefined;
vi.mock('@/components/context/AiUsageProvider', () => ({
  useAiUsage: () => ({ usage, refresh: () => {} }),
}));
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const opportunity = (over: Partial<ContentOpportunity> = {}): ContentOpportunity =>
  ({
    id: 'o1',
    brandId: 'b1',
    clusterId: 'c1',
    decision: 'create',
    title: 'Create an office coffee subscription page for teams',
    type: 'owned',
    status: 'new',
    impact: 'medium',
    opportunityScore: 75,
    sourceData: { prompts: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }] },
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-30T00:00:00Z',
    ...over,
  }) as ContentOpportunity;

const STARTER: AiUsage = {
  plan: 'starter',
  planName: 'Starter',
  periodStart: '2026-10-20T00:00:00Z',
  periodEnd: '2026-11-20T00:00:00Z',
  unlimited: false,
  percentUsed: 41.2,
  features: [],
  estimates: { writeThis: 3.4 },
};

let container: HTMLDivElement;
let root: Root;
const onOpenChange = vi.fn();

async function render(opp: ContentOpportunity | null) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WriteThisDialog opportunity={opp} onOpenChange={onOpenChange} siteType="b2b" />
      </NextIntlClientProvider>,
    ),
  );
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  usage = STARTER;
  createContentDraft.mockReset().mockResolvedValue('d9');
  importContentPage.mockReset();
  startAgentWriting.mockReset().mockResolvedValue({ started: true });
  agentWriteRequest.mockReset().mockResolvedValue({ sources: 'kept', rules: [] });
  push.mockReset();
  onOpenChange.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('WriteThisDialog', () => {
  it('says what happens, from how many prompts, and what it takes of the month’s AI usage', async () => {
    await render(opportunity());
    const text = dialog()!.textContent;
    expect(text).toContain('Write this page');
    expect(text).toContain('Create an office coffee subscription page for teams');
    expect(text).toContain(
      "From the opportunity's 4 prompts, their fan-outs and the pages AI cites for them.",
    );
    expect(text).toContain('The Content Agent writes the page from the brief');
    expect(text).toContain(
      'The editor opens as it writes, with a free estimate of its Site Audit score. Nothing is published.',
    );
    expect(text).toContain('Uses about 3% of your monthly AI usage · 41.2% used so far');
  });

  it('says a trial’s credit, a sliver as under 1%, and nothing where AI isn’t metered', async () => {
    usage = { ...STARTER, trial: true, estimates: { writeThis: 0.6 } };
    await render(opportunity());
    expect(dialog()!.textContent).toContain(
      'Uses under 1% of your trial AI credit · 41.2% used so far',
    );
    await render(null);
    usage = { ...STARTER, unlimited: true, percentUsed: null };
    await render(opportunity());
    expect(dialog()!.textContent).not.toContain('AI usage');
    usage = null;
    await render(opportunity({ id: 'o2' }));
    expect(dialog()!.textContent).not.toContain('AI usage');
  });

  it('starts the draft as Start would, has the agent build the brief first, and opens the editor', async () => {
    await render(
      opportunity({
        brief: { suggestedTitle: 'Office coffee subscriptions for teams' } as never,
      }),
    );
    await click(button('Write this'));
    expect(importContentPage).not.toHaveBeenCalled();
    expect(createContentDraft).toHaveBeenCalledWith('b1', {
      method: 'create',
      title: 'Office coffee subscriptions for teams',
      pageType: expect.any(String),
      typePicked: false,
      source: { kind: 'opportunity', id: 'o1' },
      bodyHtml: undefined,
      sourceUrl: undefined,
    });
    expect(agentWriteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd9', brandId: 'b1', method: 'create', bodyHtml: '' }),
      describeRule,
    );
    expect(startAgentWriting).toHaveBeenCalledWith('d9', 'b1', {
      sources: 'kept',
      rules: [],
      buildBrief: true,
    });
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d9');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reads an existing page first, and has the agent suggest changes to it', async () => {
    importContentPage.mockResolvedValue({
      page: { html: '<h1>Espresso guide</h1><p>Our picks.</p>', title: 'Espresso guide' },
    });
    await render(
      opportunity({
        decision: 'refresh',
        sourceData: {
          prompts: [{ id: 'p1' }],
          targetPages: [{ url: 'https://acme.example/guides/espresso', title: 'Espresso guide' }],
        } as never,
      }),
    );
    expect(dialog()!.textContent).toContain(
      'The Content Agent suggests changes to /guides/espresso from the brief',
    );
    await click(button('Write this'));
    expect(importContentPage).toHaveBeenCalledWith('b1', 'https://acme.example/guides/espresso');
    expect(createContentDraft).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        method: 'optimize',
        title: 'Espresso guide',
        bodyHtml: expect.stringContaining('Our picks.'),
        sourceUrl: 'https://acme.example/guides/espresso',
      }),
    );
    expect(startAgentWriting).toHaveBeenCalledWith(
      'd9',
      'b1',
      expect.objectContaining({ buildBrief: true }),
    );
  });

  it('starts nothing when the existing page can’t be read', async () => {
    importContentPage.mockResolvedValue({ error: 'failed' });
    await render(
      opportunity({
        decision: 'optimize',
        sourceData: {
          targetPages: [{ url: 'https://acme.example/espresso', title: null }],
        } as never,
      }),
    );
    await click(button('Write this'));
    expect(createContentDraft).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "/espresso couldn't be read, so there's nothing to suggest changes to yet. Send to Editor starts it from its title.",
    );
    expect(button('Write this').disabled).toBe(false);
  });

  it('keeps the draft in the Library, to open, when the agent can’t start', async () => {
    startAgentWriting.mockResolvedValue({ error: 'ai_budget' });
    await render(opportunity());
    await click(button('Write this'));
    expect(push).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.error).toHaveBeenCalledWith(
      "This month's AI usage is spent, so the agent didn't start. The draft is in the Library for you to write.",
      expect.objectContaining({ action: expect.objectContaining({ label: 'Open draft' }) }),
    );
  });

  it('says it couldn’t start when the draft can’t be made', async () => {
    createContentDraft.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render(opportunity());
    await click(button('Write this'));
    expect(startAgentWriting).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(messages.contentEditor.newContent.start.failed);
  });
});
