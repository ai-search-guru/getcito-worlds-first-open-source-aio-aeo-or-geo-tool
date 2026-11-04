import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

/**
 * The dashboard's subscription gate on GetCito Cloud: a workspace whose plan
 * isn't active opens read-only (the page, with the band across the top);
 * only an admin of a new account that never subscribed goes back to
 * onboarding's plan step.
 */

// An in-memory localStorage for the brand store: the test environment has none.
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

let profile: Record<string, unknown> | null;
let org: Record<string, unknown> | null;
let orgError: { message: string } | null;
let owner: { full_name: string | null } | null;
let chatSettings: { full_auto_for_members: boolean } | null;
let chatPrefs: Record<string, unknown> | null;
const reads: string[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      reads.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        single: async () =>
          table === 'profiles' ? { data: profile } : { data: org, error: orgError },
        maybeSingle: async () =>
          table === 'chat_settings'
            ? { data: chatSettings, error: null }
            : table === 'chat_user_prefs'
              ? { data: chatPrefs, error: null }
              : { data: owner },
      };
      return query;
    },
  }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard/insights',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/demo/demoClient', () => ({
  ensureDemoBrand: vi.fn(),
  prepareDemoBrand: vi.fn(async () => ({ ok: false, status: 0 })),
  demoPreparation: () => null,
  setDemoHidden: vi.fn(),
}));

const pass = ({ children }: { children: ReactNode }) => <>{children}</>;
const none = () => null;
vi.mock('@/components/layout/sidebar', () => ({ Sidebar: none }));
vi.mock('@/components/layout/SidebarErrorBoundary', () => ({ SidebarErrorBoundary: pass }));
vi.mock('@/components/layout/MobileNav', () => ({ MobileNav: none }));
vi.mock('@/components/layout/TrackingJobHandoff', () => ({ TrackingJobHandoff: none }));
vi.mock('@/components/layout/FirstRunReady', () => ({ FirstRunReady: none }));
// Chat's side panel has its own tests; here, only where the layout puts it,
// the setup the layout hands it, and that its code isn't loaded with the page.
const panel = vi.hoisted(() => ({
  setup: null as Record<string, unknown> | null,
  codeLoaded: false,
}));
vi.mock('@/components/chat/panel/ChatSidePanel', () => {
  panel.codeLoaded = true;
  return { ChatSidePanel: none };
});
vi.mock('@/components/chat/panel/ChatSidePanelSlot', async () => {
  const { useChatPanel } = await import('@/components/chat/panel/chatPanelContext');
  return {
    ChatSidePanelSlot: () => {
      panel.setup = (useChatPanel()?.setup as unknown as Record<string, unknown>) ?? null;
      return null;
    },
  };
});
const legacy = vi.hoisted(() => ({ importLegacyChats: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/chat/legacyImport', () => legacy);
vi.mock('@/lib/actions/chatPrefs', () => ({ saveChatPanelSize: vi.fn() }));
const ownKey = vi.hoisted(() => ({ chatRunsOnOwnKey: vi.fn(async () => false) }));
vi.mock('@/lib/chat/key', () => ownKey);
vi.mock('@/lib/chat/keyHealth', () => ({ failingKeyFor: vi.fn(async () => null) }));
vi.mock('@/lib/chat/skills/store', () => ({ skillMenuFor: vi.fn(async () => []) }));
vi.mock('@/components/context/SessionProvider', () => ({ SessionProvider: none }));
// The layout's plan dialog asks the AI usage whether the new Chat is on.
vi.mock('@/components/context/AiUsageProvider', () => ({
  AiUsageProvider: pass,
  useAiUsage: () => ({ usage: null, refresh: () => {} }),
}));
vi.mock('@/components/ai-usage/GetMore', () => ({ GetMoreProvider: pass }));
// The brands the layout hands the brand store (the store is marked loaded
// in beforeEach, as BrandLoader leaves it).
let loaded: { id: string }[] = [];
vi.mock('@/components/context/BrandLoader', () => ({
  BrandLoader: ({ brands }: { brands: { id: string }[] }) => {
    loaded = brands;
    return null;
  },
}));
vi.mock('@/components/context/BrandGuard', () => ({ BrandGuard: pass }));
vi.mock('@/components/getting-started/PageOpened', () => ({ GettingStartedPageOpened: none }));
let orgBrands: { id: string; isDemo?: boolean; demoHiddenAt?: string | null }[] = [];
vi.mock('@/lib/actions/brand', () => ({
  getBrands: async () => orgBrands,
  getBrandById: vi.fn(),
}));

const { default: DashboardLayout } = await import('./layout');
const { useBrandStore } = await import('@/state/useBrandStore');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

/** The layout around a page, drawn; or the address it redirected to. */
async function open(): Promise<string | null> {
  let tree: ReactNode;
  try {
    tree = await DashboardLayout({ children: <p>Page content</p> });
  } catch (err) {
    const match = /^NEXT_REDIRECT (.+)$/.exec((err as Error).message);
    if (match) return match[1];
    throw err;
  }
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {tree}
      </NextIntlClientProvider>,
    );
  });
  return null;
}

const band = () => container.querySelector('[role="status"]');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  profile = { organization_id: 'org1', onboarding_completed: true, role: 'admin' };
  org = {
    plan: 'starter',
    subscription_status: 'active',
    plan_overrides: null,
    stripe_subscription_id: 'sub_1',
  };
  orgError = null;
  owner = null;
  chatSettings = null;
  chatPrefs = null;
  panel.setup = null;
  reads.length = 0;
  orgBrands = [];
  loaded = [];
  useBrandStore.setState({ loaded: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe('the dashboard layout', () => {
  it('draws the page with no band while the plan is active', async () => {
    expect(await open()).toBeNull();
    expect(container.textContent).toContain('Page content');
    expect(band()).toBeNull();
  });

  it('opens read-only for an admin whose plan ended, with the band and See plans', async () => {
    org = { ...org, subscription_status: 'canceled' };
    expect(await open()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Page content');
    expect(band()?.textContent).toContain(
      'Your workspace is read-only. You can look around; adding, running and AI need a plan.',
    );
    expect(band()?.querySelector('button')?.textContent).toBe('See plans');
  });

  it('opens read-only for another member, naming the admin to ask', async () => {
    profile = { ...profile, role: 'analyst' };
    org = { ...org, subscription_status: 'past_due' };
    owner = { full_name: 'Jane Owner' };
    expect(await open()).toBeNull();
    expect(container.textContent).toContain('Page content');
    expect(band()?.textContent).toContain(
      'Ask Jane Owner, your workspace admin, to update the payment method.',
    );
    expect(band()?.textContent).toContain("Your last payment didn't go through");
    expect(band()?.querySelector('button')).toBeNull();
  });

  it("sends an admin of a new account that never subscribed to onboarding's plan step", async () => {
    org = { ...org, subscription_status: 'incomplete', stripe_subscription_id: null };
    expect(await open()).toBe('/dashboard/onboarding');
  });

  it('neither redirects nor locks when the organization could not be read', async () => {
    org = null;
    orgError = { message: 'canceling statement due to statement timeout' };
    expect(await open()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Page content');
    expect(band()).toBeNull();
  });

  it('sends anyone who has not finished onboarding to it', async () => {
    profile = { ...profile, onboarding_completed: false };
    expect(await open()).toBe('/dashboard/onboarding');
  });

  it('brings Agent Chat conversations over on the first visit with the new Chat, as Chat does', async () => {
    legacy.importLegacyChats.mockClear();
    expect(await open()).toBeNull();
    expect(legacy.importLegacyChats).not.toHaveBeenCalled();
    vi.stubEnv('CHAT_AGENTIC', 'true');
    expect(await open()).toBeNull();
    expect(legacy.importLegacyChats).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', organizationId: profile!.organization_id }),
    );
  });

  it("offers the panel's composer Full auto only where the server runs it", async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    org = { ...org, plan: 'growth' };
    chatPrefs = { default_mode: 'full_auto', legacy_imported_at: '2026-10-30T09:00:00.000Z' };
    // A member, with the Admin's "Full auto for members" off: closed, and said why.
    profile = { ...profile, role: 'manager' };
    chatSettings = { full_auto_for_members: false };
    expect(await open()).toBeNull();
    expect(panel.setup).toMatchObject({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: true,
    });
    // The Admin, whatever the switch says.
    profile = { ...profile, role: 'admin' };
    expect(await open()).toBeNull();
    expect(panel.setup).toMatchObject({
      defaultMode: 'full_auto',
      fullAutoOpen: true,
      fullAutoOffByAdmin: false,
    });
    // A member with no settings row: the default, open.
    profile = { ...profile, role: 'manager' };
    chatSettings = null;
    expect(await open()).toBeNull();
    expect(panel.setup).toMatchObject({ fullAutoOpen: true, fullAutoOffByAdmin: false });
  });

  it("keeps the panel's composer on at the AI limit when Chat runs on the workspace's own key", async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    chatPrefs = { legacy_imported_at: '2026-10-30T09:00:00.000Z' };
    ownKey.chatRunsOnOwnKey.mockResolvedValueOnce(true);
    expect(await open()).toBeNull();
    expect(panel.setup).toMatchObject({ onOwnKey: true });
    expect(ownKey.chatRunsOnOwnKey).toHaveBeenCalledWith('org1');
  });

  it('reads nothing of Chat and draws no panel while the new Chat is off', async () => {
    expect(await open()).toBeNull();
    expect(panel.setup).toBeNull();
    expect(reads.filter((table) => table.startsWith('chat_'))).toEqual([]);
    expect(ownKey.chatRunsOnOwnKey).not.toHaveBeenCalled();
    // The panel's own code (thread, composer, runs) isn't part of the layout's.
    expect(panel.codeLoaded).toBe(false);
    expect(container.querySelector('[data-action="panel.open"]')).toBeNull();
  });

  it('never locks self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    org = { ...org, subscription_status: 'canceled', stripe_subscription_id: null };
    expect(await open()).toBeNull();
    expect(container.textContent).toContain('Page content');
    expect(band()).toBeNull();
  });
});

describe('the dashboard layout and the demo brand', () => {
  it('lists the demo brand with the others', async () => {
    orgBrands = [{ id: 'b1' }, { id: 'demo', isDemo: true, demoHiddenAt: null }];
    expect(await open()).toBeNull();
    expect(loaded.map((b) => b.id)).toEqual(['b1', 'demo']);
  });

  it('leaves a hidden demo brand out of the brand list', async () => {
    orgBrands = [{ id: 'b1' }, { id: 'demo', isDemo: true, demoHiddenAt: '2026-10-28T00:00:00Z' }];
    expect(await open()).toBeNull();
    expect(loaded.map((b) => b.id)).toEqual(['b1']);
  });

  it('lets an admin who never subscribed explore the demo brand instead of the plan step', async () => {
    org = { ...org, subscription_status: null, stripe_subscription_id: null };
    orgBrands = [{ id: 'b1' }, { id: 'demo', isDemo: true, demoHiddenAt: null }];
    expect(await open()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Page content');
    // Read-only on the own brand, with its free trial and the way to the demo.
    expect(band()?.textContent).toContain(
      "Your brand isn't tracked yet. Start a 14-day free trial, or get 50% off your first month.",
    );
    expect([...band()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'See plans',
      'See the demo',
    ]);
  });
});
