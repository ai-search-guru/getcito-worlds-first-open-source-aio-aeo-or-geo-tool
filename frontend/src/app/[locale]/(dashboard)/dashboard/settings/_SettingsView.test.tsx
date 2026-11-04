import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/**
 * Settings' list of sections: Menu access is listed for admins and the
 * managers they let change menus, and nobody else.
 */

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
let isCloud = false;
vi.mock('@/components/context/PlanProvider', () => ({
  usePlanContext: () => ({ isCloud }),
}));
let canManageMenus = false;
vi.mock('@/components/context/MenuAccessProvider', () => ({
  useCanManageMenus: () => canManageMenus,
}));
let chatAgentic = false;
vi.mock('@/components/context/ChatAgenticProvider', () => ({
  useChatAgentic: () => chatAgentic,
}));
vi.mock('@/lib/actions/organization', () => ({ updateAccountName: vi.fn() }));
let pendingRequests = 0;
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  countPendingAccessRequests: async () => ({ ok: true, count: pendingRequests }),
}));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
for (const [path, name] of [
  ['@/components/settings/BillingSection', 'BillingSection'],
  ['@/components/settings/TeamSection', 'TeamSection'],
  ['@/components/settings/AuthorsSection', 'AuthorsSection'],
  ['@/components/settings/ContentSection', 'ContentSection'],
  ['@/components/settings/ApiKeysSection', 'ApiKeysSection'],
  ['@/components/settings/AiProvidersSection', 'AiProvidersSection'],
  ['@/components/settings/NotificationsSection', 'NotificationsSection'],
  ['@/components/settings/IntegrationsSection', 'IntegrationsSection'],
  ['@/components/settings/OrganizationSection', 'OrganizationSection'],
  ['@/components/settings/WhiteLabelSection', 'WhiteLabelSection'],
  ['@/components/settings/MenuAccessSection', 'MenuAccessSection'],
  ['@/components/settings/WorkAreasCard', 'WorkAreasCard'],
  ['@/components/chat-access/RolesAccessSection', 'RolesAccessSection'],
  ['@/components/chat-access/YourAccessCard', 'YourAccessSlot'],
  ['@/components/chat-access/ChatSettingsSection', 'ChatSettingsSection'],
]) {
  vi.doMock(path, () => ({ [name]: () => null }));
}

const { SettingsView } = await import('./_SettingsView');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function sections() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SettingsView section="account" />
      </NextIntlClientProvider>,
    );
  });
  return [...container.querySelectorAll('nav button')].map((b) => b.textContent);
}

describe('SettingsView', () => {
  it('lists Menu access, marked new, for someone who can change menus', async () => {
    canManageMenus = true;
    expect(await sections()).toContain('Menu accessNew');
  });

  it('leaves it off for everyone else', async () => {
    canManageMenus = false;
    const list = await sections();
    expect(list).toContain('Team');
    expect(list.some((s) => s?.startsWith('Menu access'))).toBe(false);
  });

  it('lists Roles & access, after Team, only while the new Chat is on', async () => {
    chatAgentic = true;
    const list = await sections();
    expect(list.indexOf('Roles & access')).toBe(list.indexOf('Team') + 1);
    expect(list.at(-1)).toBe('Chat');
    chatAgentic = false;
    const off = await sections();
    expect(off).not.toContain('Roles & access');
    expect(off).not.toContain('Chat');
  });

  it('lists White label after Organization, on the cloud and on a self-host', async () => {
    for (const cloud of [true, false]) {
      isCloud = cloud;
      const list = await sections();
      expect(list.indexOf('White label'), String(cloud)).toBe(list.indexOf('Organization') + 1);
    }
    isCloud = false;
  });

  it("counts an Admin's waiting access requests on Roles & access", async () => {
    chatAgentic = true;
    pendingRequests = 2;
    expect(await sections()).toContain('Roles & access2');
    chatAgentic = false;
    pendingRequests = 0;
  });
});
