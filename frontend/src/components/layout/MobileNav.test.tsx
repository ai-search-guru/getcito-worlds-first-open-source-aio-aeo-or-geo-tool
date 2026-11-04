import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-image={alt} />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard/action-center',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const gate = vi.hoisted(() => ({ isCloud: false }));
vi.mock('@/hooks/useFeatureGate', () => ({
  useFeatureGate: () => ({
    canUse: () => true,
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
vi.mock('@/components/layout/BrandSwitcher', () => ({ BrandSwitcher: () => null }));
vi.mock('@/components/layout/UserProfileNavItem', () => ({ UserProfileNavItem: () => null }));
vi.mock('@/components/layout/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/config/dashboard', () => {
  const Icon = () => <svg />;
  return {
    dashboardNav: [
      {
        items: [
          { title: 'Chat', href: '/dashboard/agent', icon: Icon },
          {
            title: 'Agent Center',
            href: '/dashboard/agents',
            icon: Icon,
            requiresChatAgentic: true,
          },
        ],
      },
      {
        title: 'Analytics',
        items: [
          { title: 'Action Center', href: '/dashboard/action-center', icon: Icon },
          { title: 'Prompts', href: '/dashboard/prompts', icon: Icon },
          { title: 'Mentions', href: '/dashboard/mentions', icon: Icon },
        ],
      },
    ],
  };
});

// The brand store keeps its state in localStorage, which this jsdom lacks.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { MobileNav } = await import('./MobileNav');
const { MenuAccessProvider } = await import('@/components/context/MenuAccessProvider');
const { ChatAgenticProvider } = await import('@/components/context/ChatAgenticProvider');
const { useBrandStore } = await import('@/state/useBrandStore');
const { DemoBrandContext } = await import('@/components/context/DemoBrandProvider');

/**
 * The mobile menu leaves the viewer's hidden sections off, the active brand's
 * Prompts link with the Prompts section.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gate.isCloud = false;
  agentKey.status = 'configured';
  useAgentKeyStatus.mockClear();
  useBrandStore.setState({ activeBrandId: 'brand-1', brands: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

async function open(hidden: string[], chatOn = false, isDemo = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DemoBrandContext.Provider
          value={{ isDemo, demoBrand: null, offer: 'trial', neverSubscribed: true }}
        >
          <MenuAccessProvider hidden={hidden} canManageMenus={false}>
            <ChatAgenticProvider enabled={chatOn}>
              <MobileNav />
            </ChatAgenticProvider>
          </MenuAccessProvider>
        </DemoBrandContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  const toggle = document.querySelector('button[aria-label="Toggle navigation menu"]');
  await act(async () => (toggle as HTMLButtonElement).click());
}

const link = (href: string) => document.querySelector(`a[href="${href}"]`);

describe('MobileNav', () => {
  it('shows every section, and the brand’s prompts, when nothing is hidden', async () => {
    await open([]);
    expect(link('/dashboard/prompts')).not.toBeNull();
    expect(link('/dashboard/mentions')).not.toBeNull();
    expect(link('/dashboard/brands/brand-1/prompts')).not.toBeNull();
  });

  it('leaves hidden sections off, the brand’s prompts with Prompts', async () => {
    await open(['prompts', 'mentions']);
    expect(link('/dashboard/action-center')).not.toBeNull();
    expect(link('/dashboard/prompts')).toBeNull();
    expect(link('/dashboard/mentions')).toBeNull();
    expect(link('/dashboard/brands/brand-1/prompts')).toBeNull();
  });

  it('lists Agent Center under Chat with the new Chat on', async () => {
    await open([], true);
    expect(link('/dashboard/chat')).not.toBeNull();
    expect(link('/dashboard/agents')?.textContent).toBe('Agent Center');
  });

  it('leaves Agent Center off with the new Chat off', async () => {
    await open([]);
    expect(link('/dashboard/agent')).not.toBeNull();
    expect(link('/dashboard/agents')).toBeNull();
  });

  it('leaves Agent Center off when the viewer’s menu hides it', async () => {
    await open(['agents'], true);
    expect(link('/dashboard/chat')).not.toBeNull();
    expect(link('/dashboard/agents')).toBeNull();
  });

  it('says Chat needs setting up without a key, with the new Chat off', async () => {
    gate.isCloud = true;
    agentKey.status = 'missing';
    await open([]);
    expect(useAgentKeyStatus).toHaveBeenCalledWith(true);
    expect(link('/dashboard/agent')?.textContent).toBe('ChatSet up');
  });

  it('gives Chat no Set up badge with the new Chat on, and never asks for the key', async () => {
    gate.isCloud = true;
    agentKey.status = 'missing';
    await open([], true);
    expect(link('/dashboard/chat')?.textContent).toBe('Chat');
    expect(useAgentKeyStatus).not.toHaveBeenCalledWith(true);
  });

  // The demo brand's Chat is the real one, locked as the rest of the demo.
  it.each([
    [false, '/dashboard/agent'],
    [true, '/dashboard/chat'],
  ])('gives the demo brand the Chat item any brand has (new Chat %s)', async (chatOn, href) => {
    await open([], chatOn, true);
    expect(link(href)?.textContent).toBe('Chat');
    expect(document.body.textContent).not.toContain('Soon');
  });
});
