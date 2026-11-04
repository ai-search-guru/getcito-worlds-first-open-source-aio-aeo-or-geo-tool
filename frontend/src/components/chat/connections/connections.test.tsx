import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ConnectionRecord } from '@/lib/chat/connections';

/**
 * Connections in Chat (W4-25, agentic plan §6): the chat menu's row, its
 * list closed until opened and read only then, connected first; and the
 * Connections page with its tabs and counts, the category chips and the
 * search, each card's state, Connect for Admins and Ask your Admin for the
 * others, Soon with nothing to click, and Disconnect asking first and
 * naming the agents that would stop.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true })),
}));
const calls = vi.hoisted(() => ({
  webflow: vi.fn(async (brand: string) => ({ ok: brand.length > 0 })),
  gsc: vi.fn(async (brand: string, property: string | null) => void [brand, property]),
}));
vi.mock('@/lib/webflowClient', () => ({ disconnectWebflow: calls.webflow }));
vi.mock('@/lib/wordpressClient', () => ({ disconnectWordPress: vi.fn() }));
vi.mock('@/lib/framerClient', () => ({ disconnectFramer: vi.fn() }));
vi.mock('@/lib/wixClient', () => ({ disconnectWix: vi.fn() }));
vi.mock('@/lib/actions/integrations', () => ({
  setBrandGscProperty: calls.gsc,
  setBrandGaProperty: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const brands = vi.hoisted(() => ({
  activeBrandId: '11111111-1111-4111-8111-111111111111' as string | null,
  brands: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Acme' }],
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (pick: (s: typeof brands) => unknown) => pick(brands),
}));
vi.mock('sonner', () => ({ toast: toasts }));

const { ConnectionsMenu } = await import('./ConnectionsMenu');
const { ChatConnections, CATEGORIES } = await import('./ChatConnections');
const { CONNECTION_CATEGORIES, CONNECTION_TOOLS } = await import('@/lib/chat/connections');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '11111111-1111-4111-8111-111111111111';
const record = (key: string, extra: Partial<ConnectionRecord> = {}): ConnectionRecord => ({
  key,
  category: 'cms',
  status: 'not_connected',
  account: null,
  connectedBy: null,
  connectedAt: null,
  access: 'read_write_drafts',
  uses: [],
  stops: [],
  suggested: false,
  settingsHref: `/dashboard/settings/integrations#${key}`,
  disconnect: null,
  ...extra,
});

const CONNECTIONS: ConnectionRecord[] = [
  record('google_search_console', {
    category: 'search',
    status: 'not_connected',
    access: 'read_only',
    suggested: true,
    uses: ['/winback', '/report'],
    settingsHref: '/dashboard/settings/integrations#google-search-console',
    disconnect: 'property',
  }),
  record('webflow', {
    status: 'connected',
    account: 'Acme site',
    connectedBy: 'Sam Lee',
    connectedAt: `${new Date().getFullYear()}-10-09T10:00:00Z`,
    uses: ['/publish', 'Publisher'],
    stops: ['Publisher'],
    disconnect: 'cms',
  }),
  record('wix', { status: 'failing', account: 'Acme Wix', disconnect: 'cms' }),
  record('hubspot', {
    category: 'crm',
    status: 'soon',
    access: null,
    settingsHref: null,
  }),
];

let root: Root;
let host: HTMLDivElement;
let answer: { connections: ConnectionRecord[]; canConnect: boolean } | null;
const fetched: string[] = [];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  answer = { connections: CONNECTIONS, canConnect: true };
  fetched.length = 0;
  calls.webflow.mockClear();
  calls.gsc.mockClear();
  toasts.success.mockClear();
  toasts.error.mockClear();
  brands.activeBrandId = BRAND;
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    fetched.push(String(url));
    return answer
      ? new Response(JSON.stringify({ ok: true, ...answer }), { status: 200 })
      : new Response(JSON.stringify({ ok: false }), { status: 500 });
  }) as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
  // The read's answer, and the render after it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
  host.querySelector<T>(selector);
const all = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const click = async (el: HTMLElement | null) => {
  await act(async () => {
    el!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('ConnectionsMenu', () => {
  it('reads nothing while folded, and lists the brand’s tools, connected first, once open', async () => {
    await render(<ConnectionsMenu open={false} onToggle={() => undefined} active={false} />);
    expect(fetched).toEqual([]);
    expect(q('#chat-menu-connections')).toBeNull();
    expect(q('[data-action="chatMenu.manageConnections"]')?.getAttribute('href')).toBe(
      '/dashboard/chat/connections',
    );
    expect(q('[data-action="chatMenu.toggleConnections"]')?.getAttribute('aria-expanded')).toBe(
      'false',
    );

    await render(<ConnectionsMenu open onToggle={() => undefined} active={false} />);
    expect(fetched).toEqual([`/api/chat/connections?brand=${BRAND}`]);
    const rows = all('#chat-menu-connections li[data-connection]');
    expect(rows.map((row) => [row.dataset.connection, row.dataset.status])).toEqual([
      ['webflow', 'connected'],
      ['wix', 'failing'],
      ['google_search_console', 'not_connected'],
      ['hubspot', 'soon'],
    ]);
    expect(rows[0].textContent).toContain('✓');
    expect(rows[1].querySelector('a')?.textContent).toBe('Reconnect');
    expect(rows[2].querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/settings/integrations#google-search-console',
    );
    expect(rows[3].textContent).toContain('Soon');
    expect(rows[3].querySelector('a, button')).toBeNull();
    // 20 tools or fewer: no search box.
    expect(q('[data-action="chatMenu.searchConnections"]')).toBeNull();
  });

  it('asks the Admin instead of Connect for anyone else, and searches over 20 tools', async () => {
    answer = {
      canConnect: false,
      connections: CONNECTION_TOOLS.map(
        (tool) => CONNECTIONS.find((c) => c.key === tool.key) ?? record(tool.key),
      ),
    };
    await render(<ConnectionsMenu open onToggle={() => undefined} active={false} />);
    const gsc = q('li[data-connection="google_search_console"]')!;
    expect(gsc.querySelector('a')).toBeNull();
    expect(gsc.querySelector('button')?.textContent).toBe('Ask');
    expect(gsc.querySelector('button')?.getAttribute('title')).toBe('Ask your Admin to connect');
    const box = q<HTMLInputElement>('[data-action="chatMenu.searchConnections"]');
    expect(box).not.toBeNull();
  });

  it('says when the list can’t be read, with Try again', async () => {
    answer = null;
    await render(<ConnectionsMenu open onToggle={() => undefined} active={false} />);
    expect(host.textContent).toContain('Couldn’t load connections.');
    answer = { connections: CONNECTIONS, canConnect: true };
    await click(all('#chat-menu-connections button').find((b) => b.textContent === 'Try again')!);
    expect(all('li[data-connection]')).toHaveLength(4);
  });
});

describe('ChatConnections', () => {
  it('shows the tabs with their counts, each card’s state, and Connect for an Admin', async () => {
    await render(<ChatConnections />);
    expect(host.querySelector('h1')?.textContent).toBe('Connections');
    expect(host.textContent).toContain('What Acme has connected.');
    expect(all('[role="tab"]').map((tab) => tab.textContent)).toEqual([
      'All 4',
      'Connected 2',
      'Not connected 2',
    ]);
    const webflow = q('article[data-connection="webflow"]')!;
    expect(webflow.textContent).toContain('Acme site · by Sam Lee · Oct 9 · read + write drafts');
    expect(webflow.textContent).toContain('Used by /publish · Publisher');
    expect(
      webflow.querySelector('[data-action="integrations.settings"]')?.getAttribute('href'),
    ).toBe('/dashboard/settings/integrations#webflow');
    const gsc = q('article[data-connection="google_search_console"]')!;
    expect(gsc.textContent).toContain('Suggested');
    expect(gsc.textContent).toContain('Would unlock /winback · /report');
    expect(gsc.querySelector('[data-action="integrations.connect"]')?.textContent).toBe('Connect');
    expect(q('article[data-connection="wix"]')?.textContent).toContain('Sign-in failed');
    const hubspot = q('article[data-connection="hubspot"]')!;
    expect(hubspot.textContent).toContain('Soon');
    expect(hubspot.querySelector('a, button')).toBeNull();
    expect(q('[data-action="integrations.request"]')?.getAttribute('target')).toBe('_blank');
  });

  it('filters by tab, group and search, with Clear filters when nothing matches', async () => {
    await render(<ChatConnections />);
    await click(all('[role="tab"]')[1]);
    expect(all('article').map((a) => a.dataset.connection)).toEqual(['webflow', 'wix']);
    await click(all('[role="tab"]')[0]);
    await click(q('[data-action="integrations.filter"][data-filter="crm"]'));
    expect(all('article').map((a) => a.dataset.connection)).toEqual(['hubspot']);
    const box = q<HTMLInputElement>('[data-action="integrations.search"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(box, 'webflow');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(all('article')).toHaveLength(0);
    expect(host.textContent).toContain('No connections match.');
    await click(q('[data-action="emptyState.clearFilters"]'));
    expect(all('article')).toHaveLength(4);
  });

  it('asks before Disconnect, names the agents that would stop, and reads the list again', async () => {
    await render(<ChatConnections />);
    // Only where Chat can let go of it for the brand.
    expect(
      q('article[data-connection="google_search_console"] [data-action="integrations.disconnect"]'),
    ).toBeNull();
    await click(q('article[data-connection="webflow"] [data-action="integrations.disconnect"]'));
    const dialog = document.querySelector<HTMLElement>('[data-slot="disconnect-connection"]')!;
    expect(dialog.textContent).toContain('Disconnect Webflow from Acme?');
    expect(dialog.textContent).toContain('This agent needs it and will pause:');
    expect(dialog.textContent).toContain('Publisher');
    fetched.length = 0;
    await click(
      document.querySelector<HTMLElement>('[data-action="integrations.confirmDisconnect"]'),
    );
    expect(calls.webflow).toHaveBeenCalledWith(BRAND);
    expect(toasts.success).toHaveBeenCalledWith('Webflow disconnected.');
    expect(fetched).toEqual([`/api/chat/connections?brand=${BRAND}`]);
  });

  it('gives others Ask your Admin, and no Disconnect', async () => {
    answer = { connections: CONNECTIONS, canConnect: false };
    await render(<ChatConnections />);
    expect(all('[data-action="integrations.disconnect"]')).toHaveLength(0);
    expect(all('[data-action="integrations.connect"]')).toHaveLength(0);
    expect(q('article[data-connection="google_search_console"]')?.textContent).toContain(
      'Ask your Admin to connect',
    );
    // Settings stays: the page there says what they may do.
    expect(
      q('article[data-connection="webflow"] [data-action="integrations.settings"]'),
    ).not.toBeNull();
  });

  it('filters by the same groups the server keeps', () => {
    expect(CATEGORIES).toEqual(CONNECTION_CATEGORIES);
  });
});
