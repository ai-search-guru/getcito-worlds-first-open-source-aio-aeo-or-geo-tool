import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brand } from '@/types';

/**
 * The dashboard's pages wait for the brand on screen: until the layout's
 * brands are in the store, a new browser's empty list isn't "No brands yet"
 * and the demo brand or the workspace's own isn't known, so every page shows
 * the skeleton, not another brand's state for a moment.
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

let pathname = '/dashboard/agent';
vi.mock('@/i18n/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/components/dashboard/AddBrandLink', () => ({
  AddBrandLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { useBrandStore } = await import('@/state/useBrandStore');
const { BrandGuard } = await import('./BrandGuard');
const { BrandLoader } = await import('./BrandLoader');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const demo = {
  id: 'demo',
  name: 'Brewline Coffee',
  isDemo: true,
  domains: [],
} as unknown as Brand;

function render(ui: React.ReactNode) {
  act(() => root.render(ui));
}

const page = <BrandGuard>page</BrandGuard>;
const text = () => container.textContent ?? '';
const skeleton = () => container.querySelector('[data-slot="skeleton"]');

beforeEach(() => {
  pathname = '/dashboard/agent';
  useBrandStore.setState({ brands: [], activeBrandId: null, loaded: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BrandGuard', () => {
  it('shows the skeleton, not "No brands yet", until the brands are loaded', () => {
    render(page);
    expect(skeleton()).not.toBeNull();
    expect(text()).not.toContain('No brands yet');
    expect(text()).not.toContain('page');
  });

  it('shows no page on the last visit’s brand before the list is loaded', () => {
    useBrandStore.setState({ brands: [demo], activeBrandId: 'demo' });
    render(page);
    expect(text()).not.toContain('page');
  });

  it('opens the page on the brand the loaded list selects', () => {
    render(
      <>
        <BrandLoader brands={[demo]} />
        {page}
      </>,
    );
    expect(text()).toBe('page');
    expect(useBrandStore.getState().activeBrandId).toBe('demo');
  });

  it('says "No brands yet" only once the list is loaded and empty', () => {
    render(
      <>
        <BrandLoader brands={[]} />
        {page}
      </>,
    );
    expect(text()).toContain('No brands yet');
  });

  // Settings and the brands pages open with no brand, but wait for the one
  // on screen like the rest (Settings › Integrations shows the demo's).
  it('keeps a page that needs no brand waiting until the list is loaded too', () => {
    pathname = '/dashboard/settings/integrations';
    render(page);
    expect(text()).not.toContain('page');

    render(
      <>
        <BrandLoader brands={[]} />
        {page}
      </>,
    );
    expect(text()).toBe('page');
  });

  it('waits again once the dashboard is left, for the next visit’s list', () => {
    render(<BrandLoader brands={[demo]} />);
    expect(useBrandStore.getState().loaded).toBe(true);

    render(null);
    expect(useBrandStore.getState().loaded).toBe(false);
  });
});
