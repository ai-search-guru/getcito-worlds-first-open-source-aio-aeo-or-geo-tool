import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import type { PresetLock } from '@/lib/chat/agents/catalog';
import { NOW, listResult } from '@/lib/chat/testing/agentFixtures';
import { useBrandStore } from '@/state/useBrandStore';
import type { Brand } from '@/types';

// An in-memory localStorage for the brand store, before it loads: the test environment has none.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

/**
 * Agent Center › Ready to use (AGENTS plan §1, §3; CHAT-21 §D item 15),
 * the tab Agent Center opens on: the eight ready-to-use agents first, each
 * with its skills, triggers and mode and Use this agent, which opens New
 * agent filled with it; then the Soon cards, which say what they wait for
 * and open nothing. A mode the plan keeps closed shows its lock; readers
 * see the list's line instead of Use this agent. Filters: the goals, the
 * business types and the work areas the presets have. The packs for the
 * brand's site type and the person's work areas come first, marked. The
 * tab is kept in the address.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true, id: 'request-1' })),
}));

const { AgentCenter } = await import('./AgentCenter');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn(async () => Response.json({ ok: true, ...listResult([]) }));

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render(
  role: TeamRole = 'manager',
  locks: Record<string, PresetLock> = {},
  initialTab?: 'ready' | 'yours',
  workAreas: string[] = [],
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <AgentCenter
            initialTab={initialTab}
            locks={locks}
            workAreas={workAreas}
            now={NOW}
            timeZone="UTC"
          />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const action = (name: string) => all(`[data-action="${name}"]`);
const cards = () => all('[data-slot="preset-card"]');
const card = (id: string) => container.querySelector<HTMLElement>(`[data-preset="${id}"]`)!;
const ids = () => cards().map((c) => c.getAttribute('data-preset'));
const chips = (filter: string) =>
  all(`[data-action="agents.readyFilter"][data-filter="${filter}"]`);
const chip = (filter: string, label: string) => chips(filter).find((c) => c.textContent === label)!;
/** The brand on screen, as the brand switcher keeps it. */
function onBrand(siteType: string | undefined) {
  const brand = { id: 'brand-1', name: 'GetCito', siteType, shoppingModeEnabled: false } as Brand;
  useBrandStore.setState({ brands: [brand], activeBrandId: brand.id, loaded: true });
}
const panel = (tab: string) =>
  container.querySelector<HTMLElement>(`[data-slot="agent-center-${tab}"]`)!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/dashboard/agents');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  useBrandStore.setState({ brands: [], activeBrandId: null, loaded: false });
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Agent Center tabs', () => {
  it('open on Ready to use, keep the tab in the address, and keep Your agents a click away', async () => {
    await render();
    const tabs = action('agents.tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Ready to use', 'Your agents']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(panel('ready').hidden).toBe(false);
    expect(panel('yours').hidden).toBe(true);
    // Your agents is read already: its count shows beside the title from the start.
    expect(container.querySelector('[data-slot="agents-count"]')?.textContent).toBe('4');

    await click(tabs[1]);
    expect(window.location.search).toBe('?tab=yours');
    expect(panel('ready').hidden).toBe(true);
    expect(panel('yours').hidden).toBe(false);
    await click(action('agents.tab')[0]);
    expect(window.location.search).toBe('?tab=ready');
  });

  it('open on Your agents when the address says so', async () => {
    await render('manager', {}, 'yours');
    expect(action('agents.tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(panel('yours').hidden).toBe(false);
  });
});

describe('Ready to use', () => {
  it('shows the eight launch agents first, then the ready packs, then the Soon ones', async () => {
    await render();
    const shown = cards();
    expect(shown.slice(0, 8).map((c) => c.getAttribute('data-preset'))).toEqual([
      'visibility-watch',
      'citation-winback',
      'competitor-watch',
      'content-freshness',
      'ready-to-publish',
      'task-finisher',
      'weekly-report',
      'brand-facts-guardian',
    ]);
    expect(shown.slice(8, 18).every((c) => c.getAttribute('data-status') === 'ready')).toBe(true);
    expect(shown.slice(18).every((c) => c.getAttribute('data-status') === 'soon')).toBe(true);
    expect(shown).toHaveLength(39);
    // No brand on screen and no work areas: nothing is marked.
    expect(all('[data-slot="preset-fit"]')).toHaveLength(0);
  });

  it('gives a ready card its line, skills, mode and triggers, and Use this agent into New agent', async () => {
    await render();
    const watch = card('citation-winback');
    expect(watch.querySelector('h3')?.textContent).toBe('Citation Win-back');
    expect(watch.textContent).toContain('drafts a refresh and an FAQ block');
    expect(watch.querySelector('[data-slot="agent-formula"]')?.textContent).toBe(
      '/winback/faqAuto, ask before changes',
    );
    expect(watch.querySelector('[data-cell="trigger"]')?.textContent).toBe(
      'TriggerNew Recover signal',
    );
    const use = watch.querySelector<HTMLElement>('[data-action="agents.usePreset"]')!;
    expect(use.textContent).toBe('Use this agent');
    expect(use.getAttribute('href')).toBe('/dashboard/agents/new?preset=citation-winback');
    expect(use.getAttribute('aria-label')).toBe('Use this agent: Citation Win-back');

    expect(card('visibility-watch').querySelector('[data-cell="trigger"]')?.textContent).toBe(
      'TriggerEvery day 08:00 · AI Visibility ±10% in a day',
    );
    expect(card('ready-to-publish').querySelector('[data-cell="trigger"]')?.textContent).toBe(
      'TriggerManual only',
    );
    expect(action('agents.usePreset')).toHaveLength(18);
  });

  it('says what a Soon card waits for, and opens nothing from it', async () => {
    await render();
    const help = card('onboarding-help');
    expect(help.querySelector('[data-slot="preset-soon"]')?.textContent).toBe(
      'SoonNeeds approved Help articles and the /setup skill',
    );
    expect(help.querySelector('a')).toBeNull();
    expect(help.querySelector('button')).toBeNull();
    expect(card('aeo-operator').textContent).toContain('Needs sub-agents');
    expect(card('revenue-attribution').textContent).toContain('Needs HubSpot');
    for (const soon of cards().filter((c) => c.getAttribute('data-status') === 'soon')) {
      expect(soon.querySelector('[data-action="agents.usePreset"]')).toBeNull();
    }
  });

  it('shows the plan a mode needs where the workspace’s plan keeps it closed', async () => {
    await render('manager', {
      'weekly-report': { kind: 'plan', plan: 'Growth', current: 'Starter' },
    });
    const report = card('weekly-report');
    expect(report.querySelector('[data-slot="agent-formula"]')?.textContent).toContain('Full auto');
    const lock = report.querySelector<HTMLElement>('[data-slot="preset-lock"]')!;
    expect(lock.textContent).toBe('Needs Growth · you’re on Starter');
    expect(lock.title).toBe('Use this agent opens it on Auto, ask before changes');
    // Still usable: it opens on a mode the plan has.
    expect(report.querySelector('[data-action="agents.usePreset"]')).not.toBeNull();
    expect(all('[data-slot="preset-lock"]')).toHaveLength(1);
  });

  it('says when an Admin turned Full auto off', async () => {
    await render('manager', { 'weekly-report': { kind: 'policy' } });
    expect(card('weekly-report').querySelector('[data-slot="preset-lock"]')?.textContent).toBe(
      'Your Admin turned Full auto off',
    );
  });

  it('gives Analysts and Agency partners the cards with the list’s line, not Use this agent', async () => {
    for (const role of ['analyst', 'agency_partner'] as const) {
      await render(role);
      expect(action('agents.usePreset')).toHaveLength(0);
      expect(action('agents.new')).toHaveLength(0);
      expect(
        card('weekly-report').querySelector('[data-slot="preset-read-only"]')?.textContent,
      ).toBe('Only Admins and Managers create, run and change agents');
      expect(container.querySelector('[data-slot="agents-read-only"]')?.textContent).toContain(
        'Ask your Admin',
      );
      await act(async () => root.unmount());
      root = createRoot(container);
    }
  });

  it('filters by goal, with only the goals the agents have', async () => {
    await render();
    expect(chips('goal').map((c) => c.textContent)).toEqual([
      'All',
      'Visibility',
      'Citations',
      'Content',
      'Competitors',
      'Technical',
      'Shopping',
      'Tasks',
      'Reporting',
      'Help',
    ]);
    expect(chips('goal')[0].getAttribute('aria-pressed')).toBe('true');

    await click(chip('goal', 'Reporting'));
    expect(ids()).toEqual([
      'weekly-report',
      'ceo-brief',
      'revenue-attribution',
      'agency-reporter',
      'ai-traffic-signups',
    ]);
    await click(chips('goal')[0]);
    expect(cards()).toHaveLength(39);
  });

  it('filters by business type and by role beside the goal, each with the values the agents have', async () => {
    await render();
    const groups = all('[data-slot="agent-center-ready"] [role="group"]');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Goal',
      'Business type',
      'For your role',
    ]);
    expect(chips('businessType').map((c) => c.textContent)).toEqual([
      'All',
      'E-commerce',
      'Mobile app',
      'B2B',
      'B2C',
    ]);
    expect(chips('role').map((c) => c.textContent)).toEqual([
      'All',
      'Founders & leaders',
      'AEO/GEO & Audit',
      'Content',
      'Brand & PR',
      'Growth',
      'Product Development',
      'Business Development',
      'Developers',
    ]);

    await click(chip('businessType', 'B2C'));
    expect(ids()).toEqual(['social-proof-pages', 'reviews-ugc-watch', 'local-store-locator']);
    expect(card('reviews-ugc-watch').textContent).toContain(
      'Needs review site data and Reddit and YouTube',
    );
    // Two filters at once keep what both match.
    await click(chip('goal', 'Content'));
    expect(ids()).toEqual(['social-proof-pages']);
    await click(chips('goal')[0]);
    await click(chips('businessType')[0]);

    await click(chip('role', 'Content'));
    expect(ids()).toEqual(['content-freshness', 'content-plan-builder']);
    await click(chip('role', 'AEO/GEO & Audit'));
    expect(ids()).toEqual(['prompt-portfolio', 'technical-fixer']);
  });

  it('puts the agents for the brand’s site type and the person’s work areas first, marked', async () => {
    onBrand('b2b');
    await render('manager', {}, undefined, ['product', 'content']);
    expect(ids().slice(0, 5)).toEqual([
      'content-freshness',
      'alternatives-comparison-pages',
      'integration-questions',
      'unmet-needs-miner',
      'visibility-watch',
    ]);
    const fit = (id: string) => card(id).querySelector('[data-slot="preset-fit"]')?.textContent;
    expect(fit('alternatives-comparison-pages')).toBe('For your site type');
    expect(fit('unmet-needs-miner')).toBe('For your role');
    expect(fit('content-freshness')).toBe('For your role');
    expect(fit('visibility-watch')).toBeUndefined();
    expect(fit('product-answer-pages')).toBeUndefined();
    // The Soon ones still come last, theirs first among them.
    const soon = cards().filter((c) => c.getAttribute('data-status') === 'soon');
    expect(soon.slice(0, 2).map((c) => c.getAttribute('data-preset'))).toEqual([
      'review-site-presence',
      'content-plan-builder',
    ]);
    expect(cards()).toHaveLength(39);
  });

  it('reads a brand without a site type as its guess, and an e-commerce brand gets its pack', async () => {
    onBrand(undefined);
    await render();
    // Unset and nothing else to go by: guessed B2B, as Content's page types are.
    expect(ids().slice(0, 2)).toEqual(['alternatives-comparison-pages', 'integration-questions']);
    await act(async () => root.unmount());
    root = createRoot(container);
    onBrand('ecommerce');
    await render();
    expect(ids()[0]).toBe('product-answer-pages');
    expect(card('product-answer-pages').getAttribute('data-fit')).toBe('siteType');
    // Mobile app isn't a site type a brand has yet: its pack is never marked.
    expect(card('feature-question-coverage').getAttribute('data-fit')).toBeNull();
  });
});
