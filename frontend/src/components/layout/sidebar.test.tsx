import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-image={alt} />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
const nav = vi.hoisted(() => ({ pathname: '/dashboard/action-center' }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const getTrackedPromptCount = vi.hoisted(() => vi.fn(async () => 0));
vi.mock('@/lib/actions/prompt', () => ({ getTrackedPromptCount }));
// Every feature, self-hosted, unless a test narrows the plan on the cloud.
const gate = vi.hoisted(() => ({ isCloud: false, features: null as string[] | null }));
vi.mock('@/hooks/useFeatureGate', () => ({
  useFeatureGate: () => ({
    canUse: (feature: string) => gate.features === null || gate.features.includes(feature),
    requiredPlanFor: () => null,
    isCloud: gate.isCloud,
  }),
}));
// The org's provider key for Chat: there, unless a test says otherwise.
const agentKey = vi.hoisted(() => ({ status: 'configured' as 'configured' | 'missing' }));
const useAgentKeyStatus = vi.hoisted(() =>
  vi.fn((probe: boolean) => (probe ? agentKey.status : 'configured')),
);
vi.mock('@/hooks/useAgentKeyStatus', () => ({ useAgentKeyStatus }));
const saveChatRailOpen = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/lib/actions/chatPrefs', () => ({ saveChatRailOpen }));
vi.mock('@/components/layout/BrandSwitcher', () => ({ BrandSwitcher: () => null }));
vi.mock('@/components/layout/UserProfileNavItem', () => ({ UserProfileNavItem: () => null }));
vi.mock('@/components/layout/ThemeToggle', () => ({ ThemeToggle: () => null }));
// A menu of its own, so the test pins how the sidebar shows a badge, not
// which items the product marks new today.
vi.mock('@/config/dashboard', () => {
  const Icon = () => <svg />;
  return {
    dashboardNav: [
      {
        items: [
          { title: 'Chat', href: '/dashboard/agent', icon: Icon, requiredFeature: 'ai_agent' },
          {
            title: 'Agent Center',
            href: '/dashboard/agents',
            icon: Icon,
            requiredFeature: 'ai_agent',
            requiresChatAgentic: true,
          },
        ],
      },
      {
        title: 'Execution',
        items: [
          { title: 'Action Center', href: '/dashboard/action-center', icon: Icon, badge: 'New' },
          {
            title: 'Content',
            href: '/dashboard/content',
            icon: Icon,
            badge: 'New',
            children: [
              { title: 'Opportunities', href: '/dashboard/content' },
              { title: 'Plan', href: '/dashboard/content/plan' },
            ],
          },
        ],
      },
      {
        title: 'Analytics',
        items: [
          {
            title: 'Prompts',
            href: '/dashboard/prompts',
            icon: Icon,
            children: [{ title: 'Tracked Prompts', href: '/dashboard/prompts/tracked' }],
          },
          { title: 'Mentions', href: '/dashboard/mentions', icon: Icon },
        ],
      },
    ],
  };
});

// The sidebar's store keeps its state in localStorage, which this jsdom lacks.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { Sidebar } = await import('./sidebar');
const { MenuAccessProvider } = await import('@/components/context/MenuAccessProvider');
const { useSidebarStore } = await import('@/state/useSidebarStore');
const { useChatRailStore } = await import('@/state/useChatRailStore');
const { ChatAgenticProvider } = await import('@/components/context/ChatAgenticProvider');
const { useBrandStore } = await import('@/state/useBrandStore');
const { DemoBrandContext } = await import('@/components/context/DemoBrandProvider');

/** The dashboard sidebar, expanded (it opens collapsed). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom has none: the sidebar scrolls the current item into view.
  Element.prototype.scrollIntoView = vi.fn();
  // Expanded: a collapsed sidebar shows icons alone.
  useSidebarStore.setState({ isCollapsed: false });
  useBrandStore.setState({ activeBrandId: null });
  useChatRailStore.setState({ open: false });
  nav.pathname = '/dashboard/action-center';
  gate.isCloud = false;
  gate.features = null;
  agentKey.status = 'configured';
  useAgentKeyStatus.mockClear();
  saveChatRailOpen.mockClear();
  getTrackedPromptCount.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Sidebar', () => {
  it('marks a submenu’s parent new, as a plain item, inside its button (#1603)', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Sidebar />
        </NextIntlClientProvider>,
      );
    });
    const content = container.querySelector('button[data-submenu="/dashboard/content"]');
    expect(content).not.toBeNull();
    expect(content!.querySelector('[data-slot="badge"]')?.textContent).toBe('New');
    // A plain item keeps its own.
    const actions = container.querySelector('a[href="/dashboard/action-center"]');
    expect(actions!.querySelector('[data-slot="badge"]')?.textContent).toBe('New');
  });

  it('leaves the viewer’s hidden sections off, and says where to change it', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MenuAccessProvider hidden={['content']} canManageMenus={false}>
            <Sidebar />
          </MenuAccessProvider>
        </NextIntlClientProvider>,
      );
    });
    expect(container.querySelector('[data-submenu="/dashboard/content"]')).toBeNull();
    expect(container.querySelector('a[href="/dashboard/action-center"]')).not.toBeNull();
    expect(container.textContent).toContain('1 section off your menu. Change');
    expect(container.querySelector('a[href="/dashboard/settings/account"]')?.textContent).toBe(
      'Change',
    );
  });

  it('drops a group whose sections are all off the menu, title and all', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MenuAccessProvider hidden={['prompts', 'mentions']} canManageMenus={false}>
            <Sidebar />
          </MenuAccessProvider>
        </NextIntlClientProvider>,
      );
    });
    expect(container.textContent).toContain('Execution');
    expect(container.textContent).not.toContain('Analytics');
    expect(container.querySelector('a[href="/dashboard/mentions"]')).toBeNull();
  });

  it('shows the whole menu without a menu to go by', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Sidebar />
        </NextIntlClientProvider>,
      );
    });
    expect(container.querySelector('[data-submenu="/dashboard/content"]')).not.toBeNull();
    expect(container.querySelector('a[href="/dashboard/mentions"]')).not.toBeNull();
    expect(container.textContent).not.toContain('off your menu');
  });

  it('reads the tracked prompts’ count only while Prompts is on the menu', async () => {
    useBrandStore.setState({ activeBrandId: 'brand-1' });
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MenuAccessProvider hidden={['prompts']} canManageMenus={false}>
            <Sidebar />
          </MenuAccessProvider>
        </NextIntlClientProvider>,
      );
    });
    expect(getTrackedPromptCount).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Sidebar />
        </NextIntlClientProvider>,
      );
    });
    expect(getTrackedPromptCount).toHaveBeenCalledWith('brand-1');
  });

  it("is the rail on Chat's screens until the logo expands it, kept on the person; elsewhere as pinned", async () => {
    nav.pathname = '/dashboard/chat/all';
    const render = async (chatOn: boolean) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <ChatAgenticProvider enabled={chatOn}>
              <Sidebar />
            </ChatAgenticProvider>
          </NextIntlClientProvider>,
        );
      });
    // Pinned open elsewhere (beforeEach), the rail here.
    await render(true);
    const logo = container.querySelector<HTMLButtonElement>('[data-action="rail.toggle"]')!;
    expect(logo.getAttribute('aria-expanded')).toBe('false');
    expect(logo.getAttribute('aria-label')).toBe('Expand the GetCito menu');
    expect(container.querySelector('aside')?.className).toContain('w-16');

    await act(async () => logo.click());
    expect(saveChatRailOpen).toHaveBeenCalledWith(true);
    expect(useChatRailStore.getState().open).toBe(true);
    expect(logo.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('aside')?.className).toContain('w-60');
    // The pinned state elsewhere is untouched.
    expect(useSidebarStore.getState().isCollapsed).toBe(false);

    await act(async () => logo.click());
    expect(saveChatRailOpen).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('aside')?.className).toContain('w-16');

    // With the new Chat off, the logo goes home as before.
    await render(false);
    expect(container.querySelector('[data-action="rail.toggle"]')).toBeNull();
    expect(container.querySelector('a[href="/dashboard"]')).not.toBeNull();
  });
  describe('Agent Center', () => {
    const render = (chatOn: boolean, hidden: string[] = []) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <MenuAccessProvider hidden={hidden} canManageMenus={false}>
              <ChatAgenticProvider enabled={chatOn}>
                <Sidebar />
              </ChatAgenticProvider>
            </MenuAccessProvider>
          </NextIntlClientProvider>,
        );
      });
    const link = (href: string) => container.querySelector<HTMLElement>(`a[href="${href}"]`);

    it('sits right under Chat, there only with the new Chat on', async () => {
      await render(false);
      expect(link('/dashboard/agents')).toBeNull();
      expect(container.textContent).not.toContain('Agent Center');

      await render(true);
      const items = [...container.querySelectorAll('a[data-nav-item]')].map((a) =>
        a.getAttribute('href'),
      );
      expect(items.slice(0, 2)).toEqual(['/dashboard/chat', '/dashboard/agents']);
      expect(link('/dashboard/agents')?.textContent).toBe('Agent Center');
    });

    it('is its own page: current on its pages, and the sidebar no rail there', async () => {
      nav.pathname = '/dashboard/agents/aaaaaaaa-0000-4000-8000-000000000001';
      await render(true);
      expect(link('/dashboard/agents')?.getAttribute('aria-current')).toBe('page');
      expect(link('/dashboard/chat')?.getAttribute('aria-current')).toBeNull();
      expect(container.querySelector('[data-action="rail.toggle"]')).toBeNull();
      expect(container.querySelector('aside')?.className).toContain('w-60');
    });

    it('is locked as Chat is, on a plan without Chat', async () => {
      gate.isCloud = true;
      gate.features = [];
      await render(true);
      expect(link('/dashboard/agents')).toBeNull();
      expect(link('/dashboard/chat')).toBeNull();
      expect(container.textContent).toContain('Agent Center');
      gate.features = ['ai_agent'];
      await render(true);
      expect(link('/dashboard/agents')).not.toBeNull();
    });

    it('leaves the menu when the viewer’s menu hides it, Chat staying', async () => {
      await render(true, ['agents']);
      expect(link('/dashboard/agents')).toBeNull();
      expect(link('/dashboard/chat')).not.toBeNull();
    });
  });

  describe("Chat's Set up badge", () => {
    const render = (chatOn: boolean) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <ChatAgenticProvider enabled={chatOn}>
              <Sidebar />
            </ChatAgenticProvider>
          </NextIntlClientProvider>,
        );
      });
    const chatLink = (href: string) => container.querySelector<HTMLElement>(`a[href="${href}"]`);

    it('says Chat needs setting up without a key while the new Chat is off', async () => {
      gate.isCloud = true;
      agentKey.status = 'missing';
      await render(false);
      expect(useAgentKeyStatus).toHaveBeenCalledWith(true);
      expect(chatLink('/dashboard/agent')?.textContent).toBe('ChatSet up');
    });

    it('shows none with the new Chat on, and never asks for the key', async () => {
      gate.isCloud = true;
      agentKey.status = 'missing';
      await render(true);
      expect(chatLink('/dashboard/chat')?.textContent).toBe('Chat');
      expect(useAgentKeyStatus).not.toHaveBeenCalledWith(true);
    });
  });

  // The demo brand's Chat is the real one, locked as the rest of the demo:
  // its menu item is the one any brand has, with the new Chat off (the old
  // Agent Chat's page, Set up without a key) or on (/dashboard/chat).
  describe('Chat on the demo brand', () => {
    const render = (chatOn: boolean) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <DemoBrandContext.Provider
              value={{ isDemo: true, demoBrand: null, offer: 'trial', neverSubscribed: true }}
            >
              <ChatAgenticProvider enabled={chatOn}>
                <Sidebar />
              </ChatAgenticProvider>
            </DemoBrandContext.Provider>
          </NextIntlClientProvider>,
        );
      });
    const chatLink = (href: string) => container.querySelector<HTMLElement>(`a[href="${href}"]`);

    it('is the same item as on any brand, with the new Chat off or on', async () => {
      await render(false);
      expect(chatLink('/dashboard/agent')?.textContent).toBe('Chat');
      gate.isCloud = true;
      agentKey.status = 'missing';
      await render(false);
      expect(chatLink('/dashboard/agent')?.textContent).toBe('ChatSet up');
      await render(true);
      expect(chatLink('/dashboard/chat')?.textContent).toBe('Chat');
      expect(container.textContent).not.toContain('Soon');
    });
  });

  describe('a titled group', () => {
    const renderSidebar = () =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <Sidebar />
          </NextIntlClientProvider>,
        );
      });
    const header = (title: string) =>
      container.querySelector<HTMLButtonElement>(`button[data-nav-group="${title}"]`)!;
    afterEach(() => {
      stored.delete('getcito.sidebar.group.analyticsOpen');
    });

    it('folds under its title with the chevron, and is remembered in this browser', async () => {
      await renderSidebar();
      expect(header('Analytics').getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelector('a[href="/dashboard/mentions"]')).not.toBeNull();

      await act(async () => header('Analytics').click());
      expect(header('Analytics').getAttribute('aria-expanded')).toBe('false');
      expect(container.querySelector('a[href="/dashboard/mentions"]')).toBeNull();
      expect(stored.get('getcito.sidebar.group.analyticsOpen')).toBe('0');
      // The other group stays open.
      expect(container.querySelector('a[href="/dashboard/action-center"]')).not.toBeNull();
    });

    it('comes back folded, and opens when one of its pages shows', async () => {
      stored.set('getcito.sidebar.group.analyticsOpen', '0');
      await renderSidebar();
      expect(header('Analytics').getAttribute('aria-expanded')).toBe('false');

      act(() => root.unmount());
      root = createRoot(container);
      nav.pathname = '/dashboard/mentions';
      await renderSidebar();
      expect(header('Analytics').getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelector('a[href="/dashboard/mentions"]')).not.toBeNull();
    });

    it('shows every item as icons alone, where there are no titles to fold', async () => {
      stored.set('getcito.sidebar.group.analyticsOpen', '0');
      useSidebarStore.setState({ isCollapsed: true });
      await renderSidebar();
      expect(container.querySelector('button[data-nav-group]')).toBeNull();
      expect(container.querySelector('a[href="/dashboard/mentions"]')).not.toBeNull();
    });
  });
});
