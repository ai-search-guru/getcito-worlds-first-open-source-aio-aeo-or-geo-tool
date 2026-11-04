import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { Timer } from 'lucide-react';
import type { IntegrationProvider, SourceState } from '@/lib/actions/integrations';

/**
 * AT-016: a section that needs Google Analytics or Google Search Console
 * says so, and is never blank: it shows what's missing and what happens next.
 */

const hook = vi.hoisted(() => ({
  connect: vi.fn(),
  options: null as null | { onStatus: (status: string) => void },
}));
vi.mock('@/hooks/useIntegrationConnect', () => ({
  useIntegrationConnect: (_provider: string, options: { onStatus: (s: string) => void }) => {
    hook.options = options;
    return { connecting: false, connect: hook.connect };
  },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { NeedsTag, SourceKpiCard, SourceNoData, SourceUnavailable } = await import('./_SourceGate');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const source = (over: Partial<SourceState> = {}): SourceState => ({
  configured: true,
  connected: false,
  mapped: false,
  firstDataAt: null,
  lastDataAt: null,
  property: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onConnected = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

function renderState(
  state: SourceState,
  { provider = 'google-analytics', canConnect = true } = {} as {
    provider?: IntegrationProvider;
    canConnect?: boolean;
  },
) {
  render(
    <SourceUnavailable
      provider={provider}
      state={state}
      domain="acme.example"
      canConnect={canConnect}
      onConnected={onConnected}
    />,
  );
}

const text = () => container.textContent ?? '';
const button = () => container.querySelector('button');

describe('SourceUnavailable', () => {
  it('offers Connect in place, says what it shows, and what it unlocks', () => {
    renderState(source());
    expect(text()).toContain('Connect Google Analytics to see this');
    expect(text()).toContain('Read-only access, takes about a minute.');
    expect(text()).toContain(
      'Needed for: AI share of traffic, engaged visits, key events from AI, where AI visitors ' +
        'convert, and which valuable pages get no AI traffic',
    );

    act(() => button()!.click());
    expect(hook.connect).toHaveBeenCalled();
    // Once the account connects, the page reads the sources again.
    act(() => hook.options!.onStatus('connected'));
    expect(onConnected).toHaveBeenCalled();
  });

  it("keeps Connect off, with a reason, for members who can't connect", () => {
    renderState(source(), { canConnect: false });
    expect(button()!.disabled).toBe(true);
    expect(button()!.parentElement!.title).toBe('Only admins and managers can connect a source.');
  });

  it('says how long the first sync takes, and what is connected', () => {
    renderState(source({ connected: true, mapped: true, property: '123456789' }));
    expect(text()).toContain('Importing your Google Analytics data');
    expect(text()).toContain('First numbers in about 15 minutes.');
    expect(text()).toContain('Connected to acme.example (GA4)');
    expect(button()).toBeNull();
  });

  it("names Search Console's wait and property its own way", () => {
    renderState(source({ connected: true, mapped: true, property: 'sc-domain:acme.example' }), {
      provider: 'google-search-console',
    });
    expect(text()).toContain('Google Search Console data is on its way');
    expect(text()).toContain('up to 48 hours');
    expect(text()).toContain('Connected to acme.example (GSC)');
  });

  it('sends a connection with no property for the brand to Manage', () => {
    renderState(source({ connected: true }));
    expect(text()).toContain('Choose a property for this brand');
    expect(text()).toContain('Google Analytics is connected');
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/dashboard/settings?tab=integrations',
    );
  });

  it('offers nothing to click on a server without the connection keys', () => {
    renderState(source({ configured: false }));
    expect(text()).toContain('Not set up on this server');
    expect(button()).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('lists what Search Console unlocks', () => {
    renderState(source(), { provider: 'google-search-console' });
    expect(text()).toContain('Connect Google Search Console to see this');
    expect(text()).toContain('Needed for: Google clicks');
  });

  it('renders nothing once the source has data', () => {
    renderState(source({ connected: true, mapped: true, lastDataAt: '2026-10-18T06:00:00Z' }));
    expect(container.innerHTML).toBe('');
  });
});

describe('NeedsTag', () => {
  it('names the source a section needs', () => {
    render(<NeedsTag provider="google-search-console" />);
    expect(text()).toBe('Needs Google Search Console');
  });
});

describe('SourceNoData', () => {
  it('says the source has no data for the range, with a way to widen it', () => {
    const onShowAllTime = vi.fn();
    render(<SourceNoData provider="google-analytics" onShowAllTime={onShowAllTime} />);
    expect(text()).toContain('No data for this range in Google Analytics');
    act(() => button()!.click());
    expect(onShowAllTime).toHaveBeenCalled();
  });
});

describe('SourceKpiCard', () => {
  function renderCard(
    state: SourceState,
    { provider = 'google-analytics', canConnect = true } = {} as {
      provider?: IntegrationProvider;
      canConnect?: boolean;
    },
  ) {
    render(
      <SourceKpiCard
        label="Engaged visits"
        tooltip="Engaged AI sessions."
        icon={Timer}
        provider={provider}
        state={state}
        canConnect={canConnect}
        onConnected={onConnected}
      />,
    );
  }

  it('keeps the label, shows "—", and offers Connect in place (AT-017)', () => {
    renderCard(source());
    expect(text()).toBe('Engaged visits—Needs Google AnalyticsConnect');
    act(() => button()!.click());
    expect(hook.connect).toHaveBeenCalled();
    act(() => hook.options!.onStatus('connected'));
    expect(onConnected).toHaveBeenCalled();
  });

  it("keeps Connect off, with a reason, for members who can't connect", () => {
    renderCard(source(), { canConnect: false });
    expect(button()!.disabled).toBe(true);
    expect(button()!.parentElement!.title).toBe('Only admins and managers can connect a source.');
  });

  it("gives each source's wait while it syncs", () => {
    renderCard(source({ connected: true, mapped: true }));
    expect(text()).toContain('Syncing… · about 15 min');
    renderCard(source({ connected: true, mapped: true }), { provider: 'google-search-console' });
    expect(text()).not.toContain('Needs');
    expect(text()).toContain('Syncing… · up to 48 h');
  });

  it('sends a connection without a property to Manage, and offers nothing on a server without keys', () => {
    renderCard(source({ connected: true }));
    expect(text()).toContain('Choose a property for this brand');
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/dashboard/settings?tab=integrations',
    );

    renderCard(source({ configured: false }));
    expect(text()).toContain('Not set up on this server');
    expect(button()).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders nothing once the source has data', () => {
    renderCard(source({ connected: true, mapped: true, lastDataAt: '2026-10-18T06:00:00Z' }));
    expect(container.innerHTML).toBe('');
  });
});
